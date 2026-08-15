"""Election calendar — drives both the scraper wake policy and the UI countdown.

The `Mode` returned by `decide_mode()` is consumed by `daemon.py` and exposed via
`/api/calendar/next` for the frontend countdown.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ElectionCalendar

Mode = Literal["live", "preflight", "idle"]

# Nigeria is UTC+1 year-round.
WAT = ZoneInfo("Africa/Lagos")


@dataclass(frozen=True)
class WakeDecision:
    mode: Mode
    interval_seconds: int
    state_ids: frozenset[int]
    next_event: ElectionCalendar | None


def upcoming_events(session: Session, *, limit: int = 10) -> list[ElectionCalendar]:
    now = datetime.now(WAT).date()
    stmt = (
        select(ElectionCalendar)
        .where(ElectionCalendar.election_date >= now)
        .where(ElectionCalendar.status.in_(("scheduled", "live")))
        .order_by(ElectionCalendar.election_date.asc())
        .limit(limit)
    )
    return list(session.scalars(stmt))


def next_event(session: Session) -> ElectionCalendar | None:
    events = upcoming_events(session, limit=1)
    return events[0] if events else None


def live_events(session: Session) -> list[ElectionCalendar]:
    stmt = select(ElectionCalendar).where(ElectionCalendar.status == "live")
    return list(session.scalars(stmt))


def decide_mode(
    session: Session,
    *,
    now: datetime | None = None,
    live_interval: int = 120,
    preflight_interval: int = 300,
    idle_interval: int = 86_400,
    preflight_window_hours: int = 6,
    live_trailing_days: int = 3,
) -> WakeDecision:
    now = now or datetime.now(UTC)
    # Election day is a Nigerian calendar day. Between 23:00Z and 00:00Z the
    # UTC date is still "yesterday" in Lagos, which is exactly the hour polls
    # are being collated — so decide against the WAT calendar.
    today = now.astimezone(WAT).date()

    # LIVE — an election is live for the whole of its election day (and a
    # trailing window, since INEC keeps uploading result forms for hours/days
    # after polls close). This also picks up rows explicitly flagged status=live.
    #
    # The previous logic only matched the preflight window (the 6h *before*
    # midnight of election day) and relied on something flipping status to
    # "live" — which nothing did. So on election day itself the delta to
    # midnight went negative and the scraper fell through to idle (24h),
    # never aggressively syncing the live election. That gap is the bug.
    # The trailing window matters as much as the day itself: INEC keeps
    # uploading result forms for days after polls close, so a 1-day tail let
    # the scraper drop back to a 24h sleep while collation was still running.
    live = live_events(session)
    window_start = today - timedelta(days=max(0, live_trailing_days))
    todays = list(
        session.scalars(
            select(ElectionCalendar)
            .where(ElectionCalendar.election_date >= window_start)
            .where(ElectionCalendar.election_date <= today)
            .where(ElectionCalendar.status.in_(("scheduled", "live")))
            .order_by(ElectionCalendar.election_date.desc())
        )
    )
    seen = {e.calendar_id for e in live}
    active = live + [e for e in todays if e.calendar_id not in seen]
    if active:
        state_ids = frozenset(e.state_id for e in active if e.state_id is not None)
        return WakeDecision(
            mode="live",
            interval_seconds=live_interval,
            state_ids=state_ids,
            next_event=active[0],
        )

    # PREFLIGHT — an upcoming election within the preflight window before its date.
    upcoming = next_event(session)
    if upcoming is not None:
        delta = datetime.combine(upcoming.election_date, datetime.min.time(), tzinfo=WAT) - now
        if 0 <= delta.total_seconds() <= preflight_window_hours * 3600:
            state_ids = frozenset({upcoming.state_id}) if upcoming.state_id else frozenset()
            return WakeDecision(
                mode="preflight",
                interval_seconds=preflight_interval,
                state_ids=state_ids,
                next_event=upcoming,
            )
    return WakeDecision(
        mode="idle",
        interval_seconds=idle_interval,
        state_ids=frozenset(),
        next_event=upcoming,
    )


def seconds_until(event: ElectionCalendar | None, *, now: datetime | None = None) -> int | None:
    if event is None:
        return None
    now = now or datetime.now(UTC)
    # Countdown targets midnight in Lagos, which is what the UI is counting to.
    target = datetime.combine(event.election_date, datetime.min.time(), tzinfo=WAT)
    return max(0, int((target - now).total_seconds()))
