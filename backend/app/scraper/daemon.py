"""Background scraper daemon — wake-policy + opportunistic sync.

Two responsibilities:

  1. Live event handling. When the calendar says an election is live or in the
     pre-flight window, sync those state's elections aggressively.
  2. Opportunistic background sync. When idle, drain the sync queue at a polite
     rate — historical backfill spread across days, not hours of burst.

Header discovery runs once a day no matter what — cheap (~7 calls) and keeps
us aware of newly-published election rows.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.config import Config
from app.db import init_engine, session_scope
from app.models import Election
from app.scraper import sync
from app.scraper.calendar import decide_mode
from app.scraper.irev_client import IrevClient
from app.scraper.phases import LIVE_SOURCE_NAME, ensure_source

log = logging.getLogger(__name__)

_running = True
_last_header_sync: datetime | None = None
HEADER_REFRESH_INTERVAL = timedelta(hours=24)


def _handle_signal(signum: int, frame) -> None:  # type: ignore[no-untyped-def]
    global _running
    _running = False
    log.info("signal %s received, shutting down", signum)


def main() -> int:
    cfg = Config.from_env()
    init_engine(cfg.database_url)
    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log.info("scraper daemon starting (enabled=%s)", cfg.scraper_enabled)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    if not cfg.scraper_enabled:
        log.warning("SCRAPER_ENABLED=false — sleeping indefinitely")
        while _running:
            time.sleep(60)
        return 0

    client = IrevClient(cfg.irev_api_base, cfg.irev_api_key)
    with session_scope() as session:
        ensure_source(session, LIVE_SOURCE_NAME)

    while _running:
        interval = cfg.scraper_interval_idle_seconds
        try:
            interval = _run_iteration(client, cfg)
        except Exception:  # noqa: BLE001
            log.exception("scraper loop iteration failed")

        _interruptible_sleep(interval)
    return 0


def _run_iteration(client: IrevClient, cfg: Config) -> int:
    global _last_header_sync
    now = datetime.now(UTC)

    # Header discovery once per day, no matter what mode.
    if _last_header_sync is None or now - _last_header_sync > HEADER_REFRESH_INTERVAL:
        with session_scope() as session:
            try:
                touched = sync.discover_election_headers(session, client)
                _last_header_sync = now
                log.info("daemon: header discovery touched %s", touched)
            except Exception:
                log.exception("daemon: header discovery failed")

    # Reconcile the calendar against discovered elections on every iteration,
    # not just after discovery. It is a pure DB pass (no API calls) and it is
    # what stops a stale hand-seeded date from idling us through polling day.
    with session_scope() as session:
        try:
            changed = sync.reconcile_calendar(session)
            if changed:
                log.info("daemon: calendar reconciled, %s row(s) changed", changed)
        except Exception:
            log.exception("daemon: calendar reconciliation failed")

    with session_scope() as session:
        decision = decide_mode(
            session,
            live_interval=cfg.scraper_interval_live_seconds,
            preflight_interval=cfg.scraper_interval_preflight_seconds,
            idle_interval=cfg.scraper_interval_idle_seconds,
            preflight_window_hours=cfg.scraper_preflight_window_hours,
            live_trailing_days=cfg.scraper_live_trailing_days,
        )
        depth = sync.queue_depth(session)

    log.info(
        "daemon: mode=%s interval=%ss queue=%s",
        decision.mode,
        decision.interval_seconds,
        depth,
    )

    burst = max(1.0, cfg.scraper_burst_factor)

    # A tick is one transaction — nothing lands until it returns. Cap it well
    # inside the cycle so a degraded upstream can't hold uncommitted work for
    # tens of minutes while the dashboard reports a frozen "last run".
    def _budget_seconds(interval: int) -> float:
        return max(45.0, interval * 0.75)

    if decision.mode == "live":
        budget = int(30 * burst)
        with session_scope() as session:
            counters = sync.tick(
                session,
                client,
                max_api_calls=budget,
                max_seconds=_budget_seconds(decision.interval_seconds),
            )
        log.info("daemon: live tick %s (burst=%s)", counters, burst)
        _read_sheets(decision)
    elif decision.mode == "preflight":
        budget = int(15 * burst)
        with session_scope() as session:
            counters = sync.tick(
                session,
                client,
                max_api_calls=budget,
                max_seconds=_budget_seconds(decision.interval_seconds),
            )
        log.info("daemon: preflight tick %s (burst=%s)", counters, burst)
    else:
        # Idle — drain the queue. Defaults to 20 calls per 30 min cycle
        # (~960 calls/day). With SCRAPER_BURST_FACTOR=5 → 100 calls per 6 min
        # cycle = 24,000 calls/day, draining all ~400 elections × 10 calls
        # in <1 day.
        if depth["pending_total"] > 0:
            budget = int(20 * burst)
            with session_scope() as session:
                counters = sync.tick(
                    session, client, max_api_calls=budget, max_seconds=600.0
                )
            log.info("daemon: idle tick %s (burst=%s)", counters, burst)
            # Shorten sleep proportional to burst factor.
            sleep = max(60, int(1800 / burst))
            return min(decision.interval_seconds, sleep)

    return decision.interval_seconds


#: Sheets read per live tick. Each costs one vision call, and readings are
#: cached permanently, so this is a rate — not a repeated bill. Kept modest so
#: a polling day drains steadily rather than spending thousands of calls in the
#: first few minutes; raise via OCR_SHEETS_PER_TICK when a race needs catching
#: up. Zero (the default) leaves machine reading off entirely.
def _sheets_per_tick() -> int:
    try:
        return max(0, int(os.environ.get("OCR_SHEETS_PER_TICK", "0")))
    except ValueError:
        return 0


def _read_sheets(decision) -> None:
    """Machine-read a bounded batch of published sheets for the live races.

    Off unless both a key and a per-tick budget are configured: reading costs
    money, so it must be switched on deliberately rather than by deploying.
    """
    limit = _sheets_per_tick()
    if limit == 0 or not os.environ.get("ANTHROPIC_API_KEY"):
        return
    try:
        from app.ocr.worker import read_pending_forms

        with session_scope() as session:
            live_ids = list(
                session.scalars(
                    select(Election.election_id).where(Election.status == "live")
                )
            )
        # A concluded race can be fully scanned and still have no published
        # totals — Osun's 2022 governorship has an EC8A for all 3,763 polling
        # units and no vote figures anywhere, which left the state page with
        # nothing of its own to show. Naming an election here drains its
        # sheets too, so a back-catalogue can be recovered without waiting for
        # INEC to transcribe anything.
        backfill = os.environ.get("OCR_BACKFILL_ELECTION_ID", "").strip()
        if backfill.isdigit():
            eid = int(backfill)
            if eid not in live_ids:
                live_ids.append(eid)
            # Reading a sheet needs the sheet to have been discovered, and
            # discovery happens in the ward walk — which orders by priority and
            # puts historical races last. Promote the backfill target just
            # behind live so its wards are actually reached, otherwise the
            # reader sits on an empty queue while the walk is elsewhere.
            with session_scope() as session:
                elec = session.get(Election, eid)
                if elec is not None and (elec.sync_priority or 9) > 2:
                    elec.sync_priority = 2
                    elec.sync_complete = False
                    log.info("daemon: promoted election %s for OCR backfill", eid)
        # Deliberately outside the session above: the reader manages its own
        # short transactions around slow network work, and holding one here
        # would reintroduce exactly the stall it was restructured to avoid.
        for eid in live_ids:
            counters = read_pending_forms(session_scope, eid, limit=limit)
            log.info("daemon: ec8a read e=%s %s", eid, counters)
    except Exception:  # noqa: BLE001 — reading must never take the daemon down
        log.exception("daemon: ec8a reading failed")


def _interruptible_sleep(seconds: int) -> None:
    end = time.monotonic() + seconds
    while _running and time.monotonic() < end:
        time.sleep(min(1.0, end - time.monotonic()))


if __name__ == "__main__":
    sys.exit(main())
