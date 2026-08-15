"""Regression tests for the Osun 2026 election-day sync failure.

On Saturday 2026-08-15 the scraper sat in `idle` (24h sleep) straight through
the Osun governorship poll. Three defects combined:

  1. IReV returns the poll date as `2026-08-14T23:00:00.000Z` — WAT midnight on
     the 15th. Slicing the first 10 chars stored Friday the 14th.
  2. `election_calendar` was hand-seeded (Osun as 2026-07-11) and never
     reconciled against what IReV actually published.
  3. Header discovery hardcoded `status="historical"`, so nothing was ever live.

`decide_mode()` reads only the calendar, so it never saw the election.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.integration


# ── 1. date parsing ────────────────────────────────────────────────────────

def test_wat_midnight_timestamp_resolves_to_nigerian_day():
    """The exact payload IReV served for Osun 2026."""
    from app.scraper.sync import _extract_date

    got = _extract_date({"election_date": "2026-08-14T23:00:00.000Z"})
    assert got == date(2026, 8, 15), "23:00Z is midnight WAT on the *next* day"
    assert got.strftime("%A") == "Saturday", "Nigerian polls fall on Saturdays"


def test_utc_midnight_timestamp_keeps_its_day():
    """Ekiti 2026 came through as a clean 00:00Z and must not shift."""
    from app.scraper.sync import _extract_date

    assert _extract_date({"election_date": "2026-06-20T00:00:00.000Z"}) == date(2026, 6, 20)


def test_bare_date_and_junk_values():
    from app.scraper.sync import _extract_date

    assert _extract_date({"election_date": "2026-08-15"}) == date(2026, 8, 15)
    assert _extract_date({"election_date": ""}) is None
    assert _extract_date({}) is None
    assert _extract_date({"election_date": "not-a-date"}) is None


def test_cycle_follows_the_corrected_date():
    """A 31 Dec 23:00Z poll belongs to the *next* year's cycle in Lagos."""
    from app.scraper.sync import _extract_cycle

    assert _extract_cycle({"election_date": "2026-12-31T23:00:00.000Z"}) == 2027


# ── 2. status derivation ───────────────────────────────────────────────────

def test_status_is_derived_not_hardcoded_historical():
    from app.scraper.sync import _derive_status

    today = date(2026, 8, 15)
    assert _derive_status(date(2026, 8, 15), today) == "live"
    assert _derive_status(date(2026, 8, 22), today) == "scheduled"
    assert _derive_status(date(2026, 6, 20), today) == "historical"
    assert _derive_status(None, today) == "historical"


# ── 3. calendar reconciliation ─────────────────────────────────────────────

def test_reconcile_corrects_a_stale_hand_seeded_date(db_engine):
    """The Osun case end to end: seeded 2026-07-11, IReV says today."""
    from app.db import session_scope
    from app.models import Election, ElectionCalendar, State
    from app.scraper.calendar import decide_mode
    from app.scraper.sync import reconcile_calendar, today_wat

    today = today_wat()

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        # What seed.py wrote — a date that never happened.
        session.add(
            ElectionCalendar(
                election_date=date(2026, 7, 11),
                election_type="governorship",
                state_id=30,
                status="scheduled",
                notes="Osun gubernatorial 2026",
            )
        )
        # What IReV actually published, post date-fix.
        session.add(
            Election(
                cycle=today.year,
                election_type="governorship",
                state_id=30,
                irev_election_id="6a7f788adcbc755a763f082a",
                election_date=today,
                status="live",
            )
        )

    with session_scope() as session:
        assert decide_mode(session).mode == "idle", "precondition: the bug"

    with session_scope() as session:
        assert reconcile_calendar(session) == 1

    with session_scope() as session:
        cal = session.query(ElectionCalendar).one()
        assert cal.election_date == today
        assert cal.status == "live"

        decision = decide_mode(session)
        assert decision.mode == "live"
        assert 30 in decision.state_ids


def test_reconcile_is_idempotent(db_engine):
    from app.db import session_scope
    from app.models import Election, ElectionCalendar, State
    from app.scraper.sync import reconcile_calendar, today_wat

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        session.add(
            Election(
                cycle=today_wat().year,
                election_type="governorship",
                state_id=30,
                irev_election_id="abc",
                election_date=today_wat(),
                status="live",
            )
        )

    with session_scope() as session:
        assert reconcile_calendar(session) == 1
    with session_scope() as session:
        assert reconcile_calendar(session) == 0, "second pass must be a no-op"
    with session_scope() as session:
        assert session.query(ElectionCalendar).count() == 1


def test_reconcile_ignores_old_history(db_engine):
    """Backfilling 200+ historical rows would bloat the calendar for nothing."""
    from app.db import session_scope
    from app.models import Election, ElectionCalendar, State
    from app.scraper.sync import reconcile_calendar, today_wat

    with session_scope() as session:
        session.add(State(state_id=13, code="EK", name="Ekiti", zone="SW"))
        session.flush()
        session.add(
            Election(
                cycle=2019,
                election_type="governorship",
                state_id=13,
                irev_election_id="old",
                election_date=today_wat() - timedelta(days=400),
                status="historical",
            )
        )

    with session_scope() as session:
        assert reconcile_calendar(session) == 0
    with session_scope() as session:
        assert session.query(ElectionCalendar).count() == 0


# ── 4. collation tail ──────────────────────────────────────────────────────

def test_live_mode_persists_while_inec_is_still_uploading(db_engine):
    """Polls closed two days ago; INEC is still pushing forms. Stay live."""
    from app.db import session_scope
    from app.models import ElectionCalendar, State
    from app.scraper.calendar import decide_mode
    from app.scraper.sync import today_wat

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        session.add(
            ElectionCalendar(
                election_date=today_wat() - timedelta(days=2),
                election_type="governorship",
                state_id=30,
                status="scheduled",
            )
        )

    with session_scope() as session:
        assert decide_mode(session, live_trailing_days=3).mode == "live"
        # The old 1-day tail is what dropped us to a 24h sleep mid-collation.
        assert decide_mode(session, live_trailing_days=1).mode == "idle"
