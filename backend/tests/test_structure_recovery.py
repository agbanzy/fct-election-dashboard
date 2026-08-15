"""A falsely-stamped structure sync must repair itself.

The broken parser set `structure_synced_at` while ingesting zero LGAs. Both
the 30-day freshness window and `tick()`'s target gate trusted that
timestamp, so every affected election was locked out of re-syncing for a
month by a success that never happened. Fixing the parser alone would have
left production stuck until someone hand-cleared timestamps.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

FIXTURE = Path(__file__).parent / "fixtures_irev_lga_osun.json"


class FakeIrevClient:
    def __init__(self, payload):
        self.payload = payload
        self.lga_calls = 0

    def lga_state(self, election_id, state_id):
        self.lga_calls += 1
        return self.payload

    def election_stats(self, election_id):
        return {"data": {"pus": 3763, "expected": 3763, "documents": 0}}

    def pus_for_ward(self, election_id, ward):
        return {"data": []}


def _seed_falsely_synced(session_scope):
    """An election that claims synced structure but has no geography."""
    from app.models import Election, State

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        session.add(
            Election(
                cycle=2026,
                election_type="governorship",
                state_id=30,
                irev_election_id="6a7f788adcbc755a763f082a",
                election_date=datetime.now(UTC).date(),
                status="live",
                sync_priority=1,
                # The lie: stamped a minute ago, well inside the 30-day window.
                structure_synced_at=datetime.now(UTC),
            )
        )


def test_structure_resyncs_despite_a_fresh_but_false_timestamp(db_engine):
    from app.db import session_scope
    from app.models import Election, Lga, Ward
    from app.scraper.sync import sync_election_structure

    _seed_falsely_synced(session_scope)
    client = FakeIrevClient(json.loads(FIXTURE.read_text()))

    with session_scope() as session:
        election = session.query(Election).one()
        sync_election_structure(session, client, election)

    assert client.lga_calls == 1, "the freshness window must not skip an empty state"
    with session_scope() as session:
        assert session.query(Lga).count() == 2
        assert session.query(Ward).count() == 4


def test_freshness_window_still_applies_once_geography_exists(db_engine):
    """The repair must not turn into a permanent re-sync loop."""
    from app.db import session_scope
    from app.models import Election
    from app.scraper.sync import sync_election_structure

    _seed_falsely_synced(session_scope)
    client = FakeIrevClient(json.loads(FIXTURE.read_text()))

    with session_scope() as session:
        election = session.query(Election).one()
        sync_election_structure(session, client, election)  # repairs
    with session_scope() as session:
        election = session.query(Election).one()
        sync_election_structure(session, client, election)  # should now skip

    assert client.lga_calls == 1, "second call must be skipped by freshness"


def test_tick_attempts_structure_when_geography_is_missing(db_engine):
    """`tick` gated on the timestamp alone, so the repair never ran."""
    from app.db import session_scope
    from app.models import Election, Ward
    from app.scraper.sync import tick

    _seed_falsely_synced(session_scope)
    client = FakeIrevClient(json.loads(FIXTURE.read_text()))

    with session_scope() as session:
        counters = tick(session, client, max_api_calls=10)

    assert counters["structure"] == 1
    with session_scope() as session:
        assert session.query(Ward).count() == 4
        # And the timestamp is now backed by real rows.
        assert session.query(Election).one().structure_synced_at is not None
