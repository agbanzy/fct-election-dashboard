"""One-shot CLI to kick the sync.

Phase A: this used to do the entire historical crawl synchronously, which
burned API quota and stalled deploys. Now it just runs `discover_election_headers`
once (cheap — ~7 API calls). The daemon picks up the rest opportunistically.

Usage:
    python -m app.scraper.backfill                    # discover headers
    python -m app.scraper.backfill --full             # also tick structure/stats
"""

from __future__ import annotations

import argparse
import logging

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.config import Config
from app.db import init_engine, session_scope
from app.scraper import sync
from app.scraper.irev_client import IrevClient
from app.scraper.phases import BACKFILL_SOURCE_NAME, ensure_source

log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="IReV header discovery + optional sync ticks")
    parser.add_argument(
        "--full",
        action="store_true",
        help="After header discovery, run up to --ticks of structure/stats sync.",
    )
    parser.add_argument("--ticks", type=int, default=0, help="Number of sync ticks (--full only)")
    parser.add_argument("--ticks-per-call", type=int, default=20, help="API calls per tick")
    args = parser.parse_args()

    cfg = Config.from_env()
    init_engine(cfg.database_url)
    logging.basicConfig(level=getattr(logging, cfg.log_level.upper(), logging.INFO))

    client = IrevClient(cfg.irev_api_base, cfg.irev_api_key)

    # Header discovery is a warm-up, and it runs as a POST_DEPLOY job. The
    # daemon rediscovers headers on its own schedule, so failing here must not
    # fail the release — least of all on election night, when the scraper holds
    # `elections` rows in long transactions, this job's 201-row update loses
    # the lock race, and a deploy is exactly what we most need to land.
    #
    # A short lock_timeout turns a multi-minute block into a fast, legible
    # skip. Narrow to OperationalError: contention is expected, but a genuine
    # bug should still fail loudly.
    try:
        with session_scope() as session:
            session.execute(text("SET LOCAL lock_timeout = '10s'"))
            ensure_source(session, BACKFILL_SOURCE_NAME)
            touched = sync.discover_election_headers(session, client)
            log.info("backfill: header discovery touched %s", touched)
            depth = sync.queue_depth(session)
            log.info("backfill: queue depth %s", depth)
    except OperationalError as exc:
        log.warning(
            "backfill: skipping header discovery — database busy (%s). "
            "The daemon will rediscover on its next tick.",
            str(exc).splitlines()[0],
        )
        return

    if not args.full:
        return

    for i in range(args.ticks):
        with session_scope() as session:
            counters = sync.tick(session, client, max_api_calls=args.ticks_per_call)
            depth = sync.queue_depth(session)
        log.info("backfill: tick %d -> %s depth=%s", i, counters, depth)


if __name__ == "__main__":
    main()
