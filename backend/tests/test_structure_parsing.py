"""Structure-sync parsing, pinned to a real IReV payload.

`fixtures_irev_lga_osun.json` is a trimmed capture of
`/elections/6a7f788adcbc755a763f082a/lga/state/30` taken on polling day,
2026-08-15. It is the shape that broke the original parser:

  * The LGA name lives at `lga.name`, not at the top level. The old code read
    `lga_name`/`name` off the join row, matched nothing, and `continue`d past
    every LGA — leaving 7 LGAs and 13 wards in the entire national database
    while 238 elections reported "structure synced".
  * Wards carry both an integer `ward_id` and a Mongo `_id`. The `/pus`
    endpoint keys on the `_id`; passing the integer returns HTTP 400.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

FIXTURE = Path(__file__).parent / "fixtures_irev_lga_osun.json"


class FakeIrevClient:
    """Returns the captured payload; records what it was asked for."""

    def __init__(self, payload):
        self.payload = payload
        self.calls: list[tuple] = []

    def lga_state(self, election_id, state_id):
        self.calls.append(("lga_state", election_id, state_id))
        return self.payload


def _fixture():
    return json.loads(FIXTURE.read_text())


def test_fixture_matches_the_shape_we_debugged():
    """Guard the fixture itself — if it drifts, the test below proves nothing."""
    row = _fixture()["data"][0]
    assert "name" not in row, "the join row must NOT carry a flat name"
    assert row["lga"]["name"] == "IFE NORTH"
    assert row["lga"]["lga_id"] == 3718
    assert row["_id"] != row["lga"]["_id"], "top-level _id is the join, not the LGA"
    ward = row["wards"][0]
    assert isinstance(ward["ward_id"], int)
    assert isinstance(ward["_id"], str) and len(ward["_id"]) == 24


def test_nested_lga_shape_is_ingested(db_engine):
    from app.db import session_scope
    from app.models import Election, Lga, State, Ward
    from app.scraper.phases import scrape_lga_structure

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        session.add(
            Election(
                cycle=2026,
                election_type="governorship",
                state_id=30,
                irev_election_id="6a7f788adcbc755a763f082a",
                status="live",
            )
        )

    client = FakeIrevClient(_fixture())
    with session_scope() as session:
        election = session.query(Election).one()
        count = scrape_lga_structure(
            client, session, election=election, state_id=30
        )
        assert count == 2, "both LGAs in the fixture must be ingested"

    with session_scope() as session:
        names = {lga.name for lga in session.query(Lga).all()}
        assert names == {"IFE NORTH", "IREPODUN"}

        ife = session.query(Lga).filter_by(name="IFE NORTH").one()
        assert ife.irev_lga_id == 3718
        assert ife.irev_lga_oid == "5f0f39a44d89fc3a883de327"

        wards = session.query(Ward).all()
        assert len(wards) == 4
        # Every ward must carry the object-id, or /pus rejects it with a 400.
        assert all(w.irev_ward_oid and len(w.irev_ward_oid) == 24 for w in wards)
        oyere = session.query(Ward).filter_by(name="OYERE I").one()
        assert oyere.irev_ward_id == 24545
        assert oyere.irev_ward_oid == "5f0f3e4d8f77bb3acad0a904"


def test_structure_sync_does_not_claim_success_on_zero_rows(db_engine):
    """A parser that matches nothing must look different from a real sync."""
    from app.db import session_scope
    from app.models import Election, State
    from app.scraper.sync import sync_election_structure

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        session.add(
            Election(
                cycle=2026,
                election_type="governorship",
                state_id=30,
                irev_election_id="abc",
                status="live",
            )
        )

    # Shape the old parser expected, which upstream never actually sends.
    client = FakeIrevClient({"success": True, "data": [{"unexpected": "shape"}]})
    with session_scope() as session:
        election = session.query(Election).one()
        sync_election_structure(session, client, election, force=True)

    with session_scope() as session:
        assert session.query(Election).one().structure_synced_at is None


def test_pu_walk_skips_wards_with_no_object_id(db_engine):
    """Legacy rows predate the oid column; they must not 400 the client."""
    from app.db import session_scope
    from app.models import Election, Lga, State, Ward
    from app.scraper.sync import sync_election_pus

    with session_scope() as session:
        session.add(State(state_id=30, code="OS", name="Osun", zone="SW"))
        session.flush()
        lga = Lga(state_id=30, irev_lga_id=3718, name="IFE NORTH")
        session.add(lga)
        session.flush()
        session.add(Ward(lga_id=lga.lga_id, irev_ward_id=24545, name="OYERE I"))
        session.add(
            Election(
                cycle=2026,
                election_type="governorship",
                state_id=30,
                irev_election_id="abc",
                status="live",
            )
        )

    class ExplodingClient:
        def pus_for_ward(self, *_args, **_kwargs):
            raise AssertionError("must not call /pus without an object-id")

    with session_scope() as session:
        election = session.query(Election).one()
        processed, rows = sync_election_pus(session, ExplodingClient(), election)
        assert (processed, rows) == (0, 0)
