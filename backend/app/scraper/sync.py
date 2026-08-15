"""Incremental sync engine.

Four idempotent operations driven by the daemon:

  1. discover_election_headers() — list each election type ONCE (≈7 calls),
     upsert election headers. Sets headers_synced_at.
  2. sync_election_structure(election) — pull LGAs + wards. Sets
     structure_synced_at. Skipped if already done within freshness window.
  3. sync_election_stats(election) — pull /result/stats. Updates
     expected_pus / uploaded_pus. Marks sync_complete on completion.
  4. sync_election_pus(election) — walk /pus?ward=<id> per ward, parse the
     `votes` array (present for 2026+ data), upsert PollingUnit rows and
     ElectionResult rows with aggregation='pu'. One ward per tick keeps
     it polite. This is the PU → ward → LGA → state → national pipeline.

The daemon calls `tick(client, max_api_calls)` to drain the queue at a polite
rate. Historical elections (sync_priority=5) tick at idle pace; live ones
(priority=1) get full sync every cycle.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.importer.normalizers import resolve_party
from app.models import (
    Election,
    ElectionCalendar,
    ElectionResult,
    Lga,
    PollingUnit,
    State,
    Ward,
)
from app.scraper.election_types import (
    ELECTION_TYPE_IDS,
)
from app.scraper.irev_client import IrevClient
from app.scraper.phases import (
    BACKFILL_SOURCE_NAME,
    LIVE_SOURCE_NAME,
    ensure_election,
    ensure_source,
    log_phase,
    scrape_lga_structure,
    upsert_polling_unit,
)

log = logging.getLogger(__name__)


STRUCTURE_FRESHNESS = timedelta(days=30)   # historical elections: re-sync structure monthly tops
RESULTS_FRESHNESS_LIVE = timedelta(minutes=2)
RESULTS_FRESHNESS_RECENT = timedelta(hours=6)
RESULTS_FRESHNESS_HISTORICAL = timedelta(days=7)

# Stop the PU walk after this many consecutive ward failures. When IReV is
# down every ward costs a full timeout, and proving that 28 times over is a
# waste of the tick.
PU_FAILURE_CIRCUIT = 4

# Nigeria is UTC+1 year-round (no DST). Every "what day is this election?"
# question is a question about the Lagos calendar, never the UTC one.
WAT = ZoneInfo("Africa/Lagos")


def today_wat() -> date:
    return datetime.now(WAT).date()


# ────────────────────────────────────────────────────────────────────────────
# Op 1: header discovery
# ────────────────────────────────────────────────────────────────────────────

def discover_election_headers(session: Session, client: IrevClient) -> dict[str, int]:
    """One API call per election type. Upserts election headers + priority.

    Total cost: 7 API calls. Returns {type: rows_touched}.
    """
    ensure_source(session, BACKFILL_SOURCE_NAME)
    valid_state_ids = {s.state_id for s in session.scalars(select(State))}
    touched: dict[str, int] = {}
    today = today_wat()

    for etype, irev_type_id in ELECTION_TYPE_IDS.items():
        if not irev_type_id:
            continue
        try:
            resp = client.list_elections(election_type_id=irev_type_id)
        except Exception:
            log.exception("sync: list_elections failed for %s", etype)
            continue
        elections = resp.get("data") if isinstance(resp, dict) else resp
        if not elections:
            touched[etype] = 0
            continue

        n = 0
        for raw in elections:
            if not isinstance(raw, dict):
                continue
            cycle = _extract_cycle(raw)
            if cycle == 0:
                continue
            edate = _extract_date(raw)
            irev_id = str(raw.get("_id") or raw.get("election_id") or "")
            if not irev_id:
                continue

            # Presidential is national; for everything else, attach to state.
            state_id: int | None
            if etype == "presidential":
                state_id = None
            else:
                sid = raw.get("state_id")
                if sid is None or sid == 0:
                    state_id = None
                else:
                    try:
                        sid = int(sid)
                    except (TypeError, ValueError):
                        continue
                    if sid not in valid_state_ids:
                        continue
                    state_id = sid

            elec = ensure_election(
                session,
                cycle=cycle,
                election_type=etype,
                state_id=state_id,
                irev_election_id=irev_id,
                election_date=edate,
                status=_derive_status(edate, today),
            )
            elec.headers_synced_at = datetime.now(UTC)
            elec.sync_priority = _compute_priority(edate, today)
            n += 1
        touched[etype] = n
        log.info("sync: discovered headers for %s -> %d rows", etype, n)

    return touched


def reconcile_calendar(session: Session) -> int:
    """Mirror discovered IReV elections into `election_calendar`.

    `decide_mode()` — the daemon's whole wake policy — reads only
    `election_calendar`, which until now was populated purely by hand in
    `seed.py`. When the hand-entered date drifted from reality the daemon had
    no way to notice: Osun 2026 was seeded as 2026-07-11, INEC actually polled
    on 2026-08-15, and the scraper sat in `idle` (24h sleep) straight through
    polling day.

    Reconciling on every discovery pass makes IReV the source of truth and
    keeps the seed to a bootstrap hint. Returns rows added or corrected.
    """
    today = today_wat()
    changed = 0

    rows = list(
        session.scalars(
            select(Election).where(Election.election_date.is_not(None))
        )
    )
    existing = list(session.scalars(select(ElectionCalendar)))
    # Key on the identity the calendar actually cares about, ignoring the date
    # so a moved/corrected poll date updates in place instead of duplicating.
    by_identity: dict[tuple[str, int | None], ElectionCalendar] = {}
    for cal in existing:
        by_identity.setdefault((cal.election_type, cal.state_id), cal)

    for elec in rows:
        # Only track the current and future window. Backfilling 200+ historical
        # rows into the calendar would bloat it without changing wake policy.
        if elec.election_date is None or (today - elec.election_date).days > 30:
            continue

        status = "live" if elec.election_date == today else (
            "scheduled" if elec.election_date > today else "completed"
        )
        key = (elec.election_type, elec.state_id)
        cal = by_identity.get(key)
        if cal is None:
            cal = ElectionCalendar(
                election_date=elec.election_date,
                election_type=elec.election_type,
                state_id=elec.state_id,
                status=status,
                notes=f"auto-reconciled from IReV ({elec.irev_election_id})",
            )
            session.add(cal)
            by_identity[key] = cal
            changed += 1
            log.info(
                "calendar: added %s state=%s on %s (%s)",
                elec.election_type, elec.state_id, elec.election_date, status,
            )
            continue

        if cal.election_date != elec.election_date or cal.status != status:
            log.info(
                "calendar: corrected %s state=%s %s/%s -> %s/%s",
                elec.election_type, elec.state_id,
                cal.election_date, cal.status, elec.election_date, status,
            )
            cal.election_date = elec.election_date
            cal.status = status
            cal.notes = f"auto-reconciled from IReV ({elec.irev_election_id})"
            changed += 1

    return changed


def _extract_cycle(raw: dict[str, Any]) -> int:
    """Cycle year, derived from the *Nigerian* poll date (see `_extract_date`)."""
    edate = _extract_date(raw)
    if edate is not None:
        return edate.year
    s = str(raw.get("election_date") or "")[:4]
    try:
        return int(s)
    except ValueError:
        return 0


def _extract_date(raw: dict[str, Any]) -> date | None:
    """Poll date as it falls in Nigeria (WAT), not in UTC.

    IReV serialises the poll date as an instant. Rows entered as WAT midnight
    come back as `...T23:00:00.000Z` on the *previous* UTC day — so naively
    slicing the first 10 characters lands a day early. Osun 2026 is the live
    example: IReV returns `2026-08-14T23:00:00.000Z`, which is Saturday
    2026-08-15 in Lagos; the old slice stored Friday 2026-08-14, and the
    daemon's calendar lookup then never matched on polling day.

    Bare `YYYY-MM-DD` values carry no instant and are taken verbatim.
    """
    s = str(raw.get("election_date") or "").strip()
    if not s:
        return None
    if "T" not in s:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    if dt.tzinfo is None:
        # No offset supplied — IReV means a Nigerian wall-clock date.
        return dt.date()
    return dt.astimezone(WAT).date()


def _derive_status(election_date: date | None, today: date) -> str:
    """Lifecycle from the poll date. Discovery used to hardcode 'historical',
    which meant no election was ever flagged live — not even on polling day."""
    if election_date is None:
        return "historical"
    if election_date > today:
        return "scheduled"
    if election_date == today:
        return "live"
    return "historical"


def _compute_priority(election_date: date | None, today: date) -> int:
    """1=live (election_date today), 2=preflight (<7d), 3=recent (<18mo), 5=historical."""
    if election_date is None:
        return 5
    delta = (election_date - today).days
    if -1 <= delta <= 1:
        return 1
    if 0 <= delta <= 7:
        return 2
    if -540 <= delta <= 0:
        return 3
    return 5


# ────────────────────────────────────────────────────────────────────────────
# Op 2: structure sync
# ────────────────────────────────────────────────────────────────────────────

def _has_geography(session: Session, state_id: int) -> bool:
    """Does this state actually hold wards?

    The freshness window trusts `structure_synced_at`, but the broken parser
    stamped that timestamp while ingesting nothing — so every affected
    election was locked out of re-syncing for 30 days by a success that never
    happened. Checking for real rows makes the repair self-healing instead of
    requiring someone to hand-clear timestamps in production.
    """
    return bool(
        session.scalar(
            select(func.count(Ward.ward_id))
            .join(Lga, Lga.lga_id == Ward.lga_id)
            .where(Lga.state_id == state_id)
        )
    )


def sync_election_structure(
    session: Session, client: IrevClient, election: Election, *, force: bool = False
) -> bool:
    """Walk LGAs + wards for one election. Idempotent. Returns True if work done."""
    if election.state_id is None:
        # Presidential national row — no per-state structure to walk.
        election.structure_synced_at = datetime.now(UTC)
        return False
    now = datetime.now(UTC)
    if (
        not force
        and election.structure_synced_at
        and now - election.structure_synced_at < STRUCTURE_FRESHNESS
        and _has_geography(session, election.state_id)
    ):
        return False
    try:
        count = scrape_lga_structure(
            client, session, election=election, state_id=election.state_id
        )
        # Only claim success if geography actually landed. Stamping the
        # timestamp unconditionally is how 238 elections reported
        # "structure synced" while the whole country held 7 LGAs — a parser
        # that silently matched nothing looked identical to a real sync.
        if count > 0:
            election.structure_synced_at = now
        else:
            log.warning(
                "structure: election %s state %s returned 0 LGAs — not marking synced",
                election.election_id, election.state_id,
            )
        log_phase(
            session,
            phase="structure",
            state_id=election.state_id,
            election_id=election.election_id,
            status="ok",
            message=f"lgas={count}",
        )
        return True
    except Exception as exc:  # noqa: BLE001 — surface and continue
        log_phase(
            session,
            phase="structure",
            state_id=election.state_id,
            election_id=election.election_id,
            status="error",
            message=str(exc)[:200],
        )
        log.exception(
            "sync: structure failed election_id=%s state=%s", election.election_id, election.state_id
        )
        return False


# ────────────────────────────────────────────────────────────────────────────
# Op 3: results sync (stats only at this phase; full PU walk is Phase C work)
# ────────────────────────────────────────────────────────────────────────────

def sync_election_stats(
    session: Session, client: IrevClient, election: Election
) -> bool:
    """Hit /result/stats. Cheap (1 call). Updates expected_pus / uploaded_pus.

    Marks `sync_complete = True` when uploaded == expected. Returns True if API
    was hit.
    """
    if not election.irev_election_id:
        return False
    try:
        resp = client.election_stats(election.irev_election_id)
    except Exception:
        log.exception("sync: stats failed for election_id=%s", election.election_id)
        return False

    data = resp.get("data") if isinstance(resp, dict) else resp
    if not isinstance(data, dict):
        # Some elections return an empty stats blob — treat as 0/0.
        data = {}

    expected = _coerce_int(data.get("expected"))
    uploaded = _coerce_int(data.get("documents") or data.get("uploaded"))
    election.expected_pus = expected
    election.uploaded_pus = uploaded
    election.results_synced_at = datetime.now(UTC)
    if expected is not None and uploaded is not None and expected > 0 and uploaded >= expected:
        election.sync_complete = True
    log_phase(
        session,
        phase="stats",
        state_id=election.state_id,
        election_id=election.election_id,
        status="ok",
        message=f"expected={expected} uploaded={uploaded}",
    )
    return True


def _coerce_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ────────────────────────────────────────────────────────────────────────────
# Queue selection + tick
# ────────────────────────────────────────────────────────────────────────────

def select_next_targets(session: Session, *, limit: int = 5) -> list[Election]:
    """Pick the next N elections to advance.

    Order:
      1. sync_complete = False
      2. ASC by sync_priority (1=live first)
      3. NULLS FIRST on results_synced_at (untouched first), else ASC (oldest sync first)
    """
    stmt = (
        select(Election)
        .where(Election.sync_complete.is_(False))
        .order_by(
            Election.sync_priority.asc(),
            Election.results_synced_at.asc().nullsfirst(),
        )
        .limit(limit)
    )
    return list(session.scalars(stmt))


def tick(
    session: Session,
    client: IrevClient,
    *,
    max_api_calls: int,
    max_seconds: float | None = None,
) -> dict[str, int]:
    """Advance the sync queue, doing at most `max_api_calls` IReV calls.

    `max_seconds` bounds wall-clock, which matters more than the call count
    when upstream is degraded. The caller wraps the whole tick in a single
    transaction, so nothing commits until it returns — on election night, with
    every /pus call burning its full timeout, that meant 35-minute ticks and a
    dashboard whose "last run" sat frozen while the daemon was in fact busy.
    Bounding time keeps progress landing in the database incrementally.
    """
    started = time.monotonic()
    deadline = started + max_seconds if max_seconds else None
    calls = 0
    counters = {
        "structure": 0,
        "stats": 0,
        "pu_wards": 0,
        "pu_results": 0,
        "elections_touched": 0,
    }
    targets = select_next_targets(session, limit=max_api_calls)
    for elec in targets:
        if calls >= max_api_calls:
            break
        if deadline is not None and time.monotonic() > deadline:
            log.info(
                "sync: tick hit its %ss budget after %s elections", max_seconds, counters["elections_touched"]
            )
            break

        # Retry whenever the geography is genuinely absent, not just when the
        # timestamp is unset — the old parser stamped success while ingesting
        # nothing, and gating on the timestamp alone made that permanent.
        if (
            elec.state_id is not None
            and (
                elec.structure_synced_at is None
                or not _has_geography(session, elec.state_id)
            )
            and sync_election_structure(session, client, elec)
        ):
            counters["structure"] += 1
            calls += 1

        if calls >= max_api_calls:
            break

        if (
            elec.irev_election_id
            and not elec.sync_complete
            and sync_election_stats(session, client, elec)
        ):
            counters["stats"] += 1
            calls += 1

        # PU walk — only after structure exists, and only when budget remains.
        if (
            calls < max_api_calls
            and elec.structure_synced_at is not None
            and elec.irev_election_id
            and elec.state_id is not None
        ):
            n_wards, n_results = sync_election_pus(
                session,
                client,
                elec,
                max_wards=max(1, max_api_calls - calls),
                deadline=deadline,
            )
            counters["pu_wards"] += n_wards
            counters["pu_results"] += n_results
            calls += n_wards

        counters["elections_touched"] += 1

    counters["api_calls"] = calls
    return counters


# ────────────────────────────────────────────────────────────────────────────
# Op 4: per-PU walk → ElectionResult(aggregation='pu')
# ────────────────────────────────────────────────────────────────────────────

PARTY_VOTE_CEILING = 100_000  # sanity guard


def sync_election_pus(
    session: Session,
    client: IrevClient,
    election: Election,
    *,
    max_wards: int = 5,
    deadline: float | None = None,
) -> tuple[int, int]:
    """Walk wards under this election's state, fetch /pus?ward=<id>, persist
    PU-level vote rows. Skips wards already covered.

    Returns (wards_processed, rows_inserted).
    """
    if not election.irev_election_id or election.state_id is None:
        return 0, 0

    # Must have the object-id: /pus rejects the integer ward_id with a 400.
    stmt = (
        select(Ward)
        .join(Lga, Lga.lga_id == Ward.lga_id)
        .where(Lga.state_id == election.state_id, Ward.irev_ward_oid.isnot(None))
        .limit(max_wards * 4)
    )
    candidates = list(session.scalars(stmt))
    if not candidates:
        return 0, 0

    source = ensure_source(session, LIVE_SOURCE_NAME)
    processed = 0
    rows_inserted = 0
    consecutive_failures = 0
    for ward in candidates:
        if processed >= max_wards:
            break
        if deadline is not None and time.monotonic() > deadline:
            log.info(
                "sync: pu walk hit its time budget after %s wards (election %s)",
                processed, election.election_id,
            )
            break
        # When IReV is down every ward costs a full timeout. Give up on the
        # phase quickly rather than spending the whole tick proving the
        # endpoint is still unavailable — the wards are still there next cycle.
        if consecutive_failures >= PU_FAILURE_CIRCUIT:
            log.warning(
                "sync: pu walk opening circuit after %s consecutive failures (election %s)",
                consecutive_failures, election.election_id,
            )
            break
        already = session.scalar(
            select(func.count(ElectionResult.result_id))
            .join(PollingUnit, PollingUnit.pu_id == ElectionResult.pu_id)
            .where(
                ElectionResult.election_id == election.election_id,
                PollingUnit.ward_id == ward.ward_id,
            )
        ) or 0
        if already > 0:
            continue
        try:
            resp = client.pus_for_ward(election.irev_election_id, str(ward.irev_ward_oid))
            n = _persist_ward_pu_results(session, election, ward, resp, source_id=source.source_id)
            rows_inserted += n
            consecutive_failures = 0
            log_phase(
                session,
                phase="pu",
                state_id=election.state_id,
                election_id=election.election_id,
                status="ok",
                message=f"ward={ward.ward_id} rows={n}",
            )
        except Exception as exc:  # noqa: BLE001
            consecutive_failures += 1
            log.warning(
                "sync: pu fetch failed e=%s w=%s: %s",
                election.election_id, ward.ward_id, exc,
            )
            log_phase(
                session,
                phase="pu",
                state_id=election.state_id,
                election_id=election.election_id,
                status="error",
                message=str(exc)[:200],
            )
        processed += 1
    return processed, rows_inserted


def _persist_ward_pu_results(
    session: Session,
    election: Election,
    ward: Ward,
    resp: Any,
    *,
    source_id: int,
) -> int:
    data = resp.get("data") if isinstance(resp, dict) else resp
    if not isinstance(data, list):
        return 0
    inserted = 0
    for pu_raw in data:
        if not isinstance(pu_raw, dict):
            continue
        pu = upsert_polling_unit(
            session,
            ward,
            irev_pu_id=_as_int_safe(pu_raw.get("polling_unit_id") or pu_raw.get("_id")),
            pu_code=pu_raw.get("pu_code") or pu_raw.get("code"),
            name=pu_raw.get("name"),
        )
        votes_field = pu_raw.get("votes")
        if isinstance(votes_field, str):
            try:
                votes_field = json.loads(votes_field)
            except json.JSONDecodeError:
                votes_field = None
        if not isinstance(votes_field, list):
            continue
        for v in votes_field:
            if not isinstance(v, dict):
                continue
            code = (v.get("party_code") or "").upper().strip()
            try:
                count = int(v.get("vote") or 0)
            except (TypeError, ValueError):
                continue
            if not code or count < 0 or count > PARTY_VOTE_CEILING:
                continue
            party = resolve_party(session, code=code, cycle=election.cycle, autocreate=True)
            if party is None:
                continue
            session.add(
                ElectionResult(
                    election_id=election.election_id,
                    pu_id=pu.pu_id,
                    state_id=election.state_id,
                    aggregation="pu",
                    party_id=party.party_id,
                    votes=count,
                    source_id=source_id,
                )
            )
            inserted += 1
    if inserted:
        session.flush()
    return inserted


def _as_int_safe(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def queue_depth(session: Session) -> dict[str, int]:
    """Visibility helper — counts by sync state."""
    total = session.scalar(select(func.count(Election.election_id))) or 0
    complete = session.scalar(
        select(func.count(Election.election_id)).where(Election.sync_complete.is_(True))
    ) or 0
    no_structure = session.scalar(
        select(func.count(Election.election_id)).where(
            Election.structure_synced_at.is_(None), Election.state_id.is_not(None)
        )
    ) or 0
    no_stats = session.scalar(
        select(func.count(Election.election_id)).where(Election.results_synced_at.is_(None))
    ) or 0
    return {
        "total": total,
        "complete": complete,
        "pending_structure": no_structure,
        "pending_stats": no_stats,
        "pending_total": total - complete,
    }
