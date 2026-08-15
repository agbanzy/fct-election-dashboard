"""Read published EC8A sheets, cache the readings, publish the confident ones.

Cost control is the whole design. A state publishes thousands of sheets and
the ward walk revisits wards continuously, so the rule is: **each image is
read exactly once.** The reading lives on the form row, keyed by the URL it
came from. A sheet already read is never sent again; a sheet INEC replaces
arrives with a new URL and is re-read, which is the only case worth paying
for twice.

`unreadable` is terminal for the same reason. A sheet whose figures and words
contradict each other will contradict itself on a second reading too, and
retrying it spends money to reach the conclusion we already have.

Published votes are marked machine-read and unverified. Nothing here is
authoritative; a human accepting a sheet in /admin is what makes it so.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

import requests
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.importer.normalizers import resolve_party
from app.models import Election, ElectionResult, PollingUnit, PollingUnitForm, Ward
from app.ocr.ec8a_vision import read_ec8a
from app.scraper.phases import ensure_source

log = logging.getLogger(__name__)

#: Minimum confidence before a reading's votes reach the public tallies.
#: Confidence here is the share of scored rows whose figures and words agree,
#: halved when the parties do not sum to the sheet's own total — so 1.0 means
#: every row was corroborated twice over and the arithmetic closed. Anything
#: less is a sheet disagreeing with itself, which is exactly what must not be
#: published as a vote count.
PUBLISH_CONFIDENCE = 1.0

OCR_SOURCE_NAME = "irev_ec8a_machine_read"


def read_pending_forms(
    session_factory,
    election_id: int,
    *,
    limit: int = 25,
    api_key: str | None = None,
    max_seconds: float = 240.0,
) -> dict[str, int]:
    """Read up to `limit` unread sheets for one election.

    Takes a session *factory*, not a session, and that is the whole point.
    Reading a sheet means two slow network calls — fetch the scan, then the
    vision request — and doing 25 of those inside one open transaction pinned
    a connection idle-in-transaction for minutes at a time. In production that
    wedged the daemon completely: it stopped logging for over an hour and the
    IReV walk stopped with it, because the next iteration's session queued
    behind the one this function was holding.

    So: claim a batch in one short transaction, do all network work with no
    transaction open, and commit each sheet in its own short transaction.
    `max_seconds` bounds the batch so a slow upstream cannot stretch it
    indefinitely.
    """
    counters = {"attempted": 0, "read": 0, "unreadable": 0, "errors": 0, "published": 0}
    deadline = time.monotonic() + max_seconds

    # ── 1. Claim a batch. Short transaction, no network. ──────────────────
    with session_factory() as session:
        election = session.get(Election, election_id)
        if election is None:
            return counters
        cycle = election.cycle
        state_id = election.state_id
        work = [
            (f.form_id, f.pu_id, f.lga_id, f.document_url)
            for f in session.scalars(
                select(PollingUnitForm)
                .where(
                    PollingUnitForm.election_id == election_id,
                    PollingUnitForm.document_url.isnot(None),
                    # Never read the same image twice: unread sheets, or ones
                    # whose image has since been replaced.
                    or_(
                        PollingUnitForm.ocr_status.is_(None),
                        PollingUnitForm.ocr_url.is_(None),
                        PollingUnitForm.ocr_url != PollingUnitForm.document_url,
                    ),
                )
                .limit(limit)
            )
        ]
    if not work:
        return counters

    # ── 2. Network work, with nothing held. ───────────────────────────────
    for form_id, pu_id, lga_id, url in work:
        if time.monotonic() > deadline:
            log.info("ocr: batch hit its %ss budget after %s sheets", max_seconds, counters["attempted"])
            break
        counters["attempted"] += 1
        try:
            img = requests.get(url or "", timeout=30)
            img.raise_for_status()
        except requests.RequestException as exc:
            log.warning("ocr: fetch failed pu=%s: %s", pu_id, exc)
            counters["errors"] += 1
            # Left unstamped on purpose — a transport failure says nothing
            # about the sheet, so it stays in the queue.
            continue

        reading = read_ec8a(img.content, api_key=api_key)
        if reading is None:
            # Reader unavailable, not sheet unreadable. Same reasoning.
            counters["errors"] += 1
            continue

        # ── 3. Persist this one sheet. Short transaction, no network. ─────
        publishable = reading.confidence >= PUBLISH_CONFIDENCE and bool(reading.party_votes)
        try:
            with session_factory() as session:
                form = session.get(PollingUnitForm, form_id)
                if form is None:
                    continue
                form.ocr_url = url
                form.ocr_confidence = reading.confidence
                form.ocr_votes = reading.party_votes or {}
                form.ocr_problems = reading.problems or []
                form.ocr_read_at = datetime.now(UTC)
                form.ocr_status = "read" if publishable else "unreadable"

                if publishable:
                    source = ensure_source(session, OCR_SOURCE_NAME)
                    counters["published"] += _publish(
                        session,
                        election_id=election_id,
                        cycle=cycle,
                        state_id=state_id,
                        pu_id=pu_id,
                        lga_id=lga_id,
                        party_votes=reading.party_votes,
                        source_id=source.source_id,
                    )
            counters["read" if publishable else "unreadable"] += 1
        except Exception:  # noqa: BLE001 — one bad sheet must not kill the batch
            log.exception("ocr: persist failed pu=%s", pu_id)
            counters["errors"] += 1

    return counters


def _publish(
    session: Session,
    *,
    election_id: int,
    cycle: int,
    state_id: int | None,
    pu_id: int,
    lga_id: int | None,
    party_votes: dict[str, int],
    source_id: int,
) -> int:
    """Write a corroborated reading into the tallies.

    Upserts on the same key the IReV walk uses, so a sheet read here and a
    figure INEC later transcribes converge on one row per party rather than
    doubling the polling unit.
    """
    if lga_id is None:
        lga_id = session.scalar(
            select(Ward.lga_id)
            .join(PollingUnit, PollingUnit.ward_id == Ward.ward_id)
            .where(PollingUnit.pu_id == pu_id)
        )

    written = 0
    for code, votes in party_votes.items():
        if not isinstance(votes, int) or votes < 0:
            continue
        party = resolve_party(session, code=code, cycle=cycle, autocreate=True)
        if party is None:
            continue
        stmt = pg_insert(ElectionResult).values(
            election_id=election_id,
            pu_id=pu_id,
            lga_id=lga_id,
            state_id=state_id,
            aggregation="pu",
            party_id=party.party_id,
            votes=votes,
            source_id=source_id,
        )
        session.execute(
            stmt.on_conflict_do_update(
                index_elements=["election_id", "pu_id", "party_id", "aggregation"],
                index_where=ElectionResult.pu_id.isnot(None),
                set_={"votes": stmt.excluded.votes, "source_id": stmt.excluded.source_id},
            )
        )
        written += 1
    return written


def ocr_progress(session: Session, election_id: int) -> dict[str, int]:
    """Counts by reading state, for the admin view and the live panel."""
    rows = session.execute(
        select(PollingUnitForm.ocr_status, func.count(PollingUnitForm.form_id))
        .where(PollingUnitForm.election_id == election_id)
        .group_by(PollingUnitForm.ocr_status)
    ).all()
    out = {"pending": 0, "read": 0, "unreadable": 0}
    for status, n in rows:
        out["pending" if status is None else status] = int(n or 0)
    return out
