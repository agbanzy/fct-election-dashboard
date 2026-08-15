"""GET /api/results — filterable result rows."""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from sqlalchemy import select

from app.db import session_scope
from app.models import ElectionResult, IngestionSource, Party, State

bp = Blueprint("results", __name__, url_prefix="/api/results")


@bp.get("")
def list_results():
    # Both spellings — see candidates.py. `?election_id=` silently no-opped
    # here too, so a request for one election's rows returned every election's.
    election_id = request.args.get("election_id", type=int) or request.args.get(
        "election", type=int
    )
    state_code = request.args.get("state")
    aggregation = request.args.get("aggregation")
    limit = min(request.args.get("limit", default=200, type=int), 5000)

    with session_scope() as session:
        stmt = (
            select(ElectionResult, Party, State, IngestionSource)
            .join(Party, Party.party_id == ElectionResult.party_id)
            .join(State, State.state_id == ElectionResult.state_id, isouter=True)
            .join(
                IngestionSource,
                IngestionSource.source_id == ElectionResult.source_id,
            )
        )
        if election_id:
            stmt = stmt.where(ElectionResult.election_id == election_id)
        if state_code:
            stmt = stmt.where(State.code == state_code.upper())
        if aggregation:
            stmt = stmt.where(ElectionResult.aggregation == aggregation)
        stmt = stmt.limit(limit)

        out = []
        for r, p, s, src in session.execute(stmt).all():
            out.append(
                {
                    "result_id": r.result_id,
                    "election_id": r.election_id,
                    "aggregation": r.aggregation,
                    "state_code": s.code if s else None,
                    "lga_id": r.lga_id,
                    "pu_id": r.pu_id,
                    "party_code": p.code,
                    "party_color": p.color_hex,
                    "votes": r.votes,
                    "accredited": r.accredited_voters,
                    "registered": r.registered_voters,
                    "source": src.name,
                    "ingested_at": r.ingested_at.isoformat() if r.ingested_at else None,
                }
            )
        return jsonify(out)
