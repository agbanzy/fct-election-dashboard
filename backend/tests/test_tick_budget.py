"""A degraded upstream must not hold the tick open.

On Osun polling day IReV's /pus endpoint began timing out on every ward.
Because `tick()` runs inside a single transaction, nothing committed until
it returned — and with ~28 wards each burning a full timeout, that was 35
minutes. The dashboard's "last run" sat frozen while the daemon was in fact
working, and no partial progress reached the database.
"""

from __future__ import annotations

import time

import pytest

pytestmark = pytest.mark.integration


class TimeoutingClient:
    """Every PU call burns `cost` seconds then fails, as IReV did."""

    def __init__(self, cost: float = 0.2):
        self.cost = cost
        self.pu_calls = 0

    def election_stats(self, election_id):
        return {"data": {"pus": 3763, "expected": 3763, "documents": 0}}

    def lga_state(self, election_id, state_id):
        return {"success": True, "data": []}

    def pus_for_ward(self, election_id, ward):
        self.pu_calls += 1
        time.sleep(self.cost)
        raise ConnectionError("Read timed out. (read timeout=25)")


def _seed(session_scope, *, wards: int):
    from app.models import Election, Lga, State, Ward
    from app.scraper.sync import today_wat

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        lga = Lga(state_id=30, irev_lga_id=3718, name="IFE NORTH")
        session.add(lga)
        session.flush()
        for i in range(wards):
            session.add(
                Ward(
                    lga_id=lga.lga_id,
                    irev_ward_id=1000 + i,
                    irev_ward_oid=f"{i:024d}",
                    name=f"WARD {i}",
                )
            )
        session.add(
            Election(
                cycle=today_wat().year,
                election_type="governorship",
                state_id=30,
                irev_election_id="6a7f788adcbc755a763f082a",
                election_date=today_wat(),
                status="live",
                sync_priority=1,
                structure_synced_at=__import__("datetime").datetime.now(
                    __import__("datetime").UTC
                ),
            )
        )


def test_circuit_breaker_stops_a_dead_endpoint_early(db_engine):
    from app.db import session_scope
    from app.scraper.sync import PU_FAILURE_CIRCUIT, tick

    _seed(session_scope, wards=40)
    client = TimeoutingClient(cost=0.0)

    with session_scope() as session:
        tick(session, client, max_api_calls=30)

    assert client.pu_calls == PU_FAILURE_CIRCUIT, (
        "the walk must stop proving the endpoint is down, not work through "
        f"every ward (made {client.pu_calls} calls)"
    )


def test_tick_respects_its_wall_clock_budget(db_engine):
    """Time, not call count, is what runs out when upstream degrades."""
    from app.db import session_scope
    from app.scraper import sync as sync_mod

    _seed(session_scope, wards=40)
    # Never trip the circuit, so only the deadline can stop the walk.
    original = sync_mod.PU_FAILURE_CIRCUIT
    sync_mod.PU_FAILURE_CIRCUIT = 10_000
    try:
        client = TimeoutingClient(cost=0.15)
        started = time.monotonic()
        with session_scope() as session:
            sync_mod.tick(session, client, max_api_calls=30, max_seconds=0.5)
        elapsed = time.monotonic() - started
    finally:
        sync_mod.PU_FAILURE_CIRCUIT = original

    assert elapsed < 2.0, f"tick ran {elapsed:.1f}s against a 0.5s budget"
    assert client.pu_calls < 30, "the deadline must cut the walk short"


def test_partial_progress_still_commits(db_engine):
    """Whatever the walk managed must land, not roll back with the failures."""
    from app.db import session_scope
    from app.models import ScrapeLog
    from app.scraper.sync import tick

    _seed(session_scope, wards=40)
    client = TimeoutingClient(cost=0.0)

    with session_scope() as session:
        tick(session, client, max_api_calls=30)

    with session_scope() as session:
        # The stats phase succeeded even though every PU call failed.
        phases = {row.phase for row in session.query(ScrapeLog).all()}
        assert "stats" in phases, f"expected stats to commit, saw {phases}"
