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
import signal
import sys
import time
from datetime import UTC, datetime, timedelta

from app.config import Config
from app.db import init_engine, session_scope
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

    if decision.mode == "live":
        budget = int(30 * burst)
        with session_scope() as session:
            counters = sync.tick(session, client, max_api_calls=budget)
        log.info("daemon: live tick %s (burst=%s)", counters, burst)
    elif decision.mode == "preflight":
        budget = int(15 * burst)
        with session_scope() as session:
            counters = sync.tick(session, client, max_api_calls=budget)
        log.info("daemon: preflight tick %s (burst=%s)", counters, burst)
    else:
        # Idle — drain the queue. Defaults to 20 calls per 30 min cycle
        # (~960 calls/day). With SCRAPER_BURST_FACTOR=5 → 100 calls per 6 min
        # cycle = 24,000 calls/day, draining all ~400 elections × 10 calls
        # in <1 day.
        if depth["pending_total"] > 0:
            budget = int(20 * burst)
            with session_scope() as session:
                counters = sync.tick(session, client, max_api_calls=budget)
            log.info("daemon: idle tick %s (burst=%s)", counters, burst)
            # Shorten sleep proportional to burst factor.
            sleep = max(60, int(1800 / burst))
            return min(decision.interval_seconds, sleep)

    return decision.interval_seconds


def _interruptible_sleep(seconds: int) -> None:
    end = time.monotonic() + seconds
    while _running and time.monotonic() < end:
        time.sleep(min(1.0, end - time.monotonic()))


if __name__ == "__main__":
    sys.exit(main())
