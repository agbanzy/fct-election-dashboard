"""GET /api/overview — national + per-state summary for the dashboard home."""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from sqlalchemy import func, select

from app.db import session_scope
from app.models import Candidate, Election, Lga, State

bp = Blueprint("overview", __name__, url_prefix="/api/overview")


@bp.get("")
def overview():
    state_code = request.args.get("state")
    cycle = request.args.get("cycle", type=int)
    with session_scope() as session:
        states_count = session.scalar(select(func.count(State.state_id))) or 0
        lgas_count = session.scalar(select(func.count(Lga.lga_id))) or 0
        elections_count = session.scalar(select(func.count(Election.election_id))) or 0
        candidates_count = session.scalar(select(func.count(Candidate.candidate_id))) or 0

        cycles_query = session.execute(
            select(Election.cycle, func.count(Election.election_id))
            .group_by(Election.cycle)
            .order_by(Election.cycle.desc())
        ).all()

        types_query = session.execute(
            select(Election.election_type, func.count(Election.election_id))
            .group_by(Election.election_type)
        ).all()

        recent_elections = list(
            session.scalars(
                select(Election)
                .order_by(Election.election_date.desc().nullslast(), Election.cycle.desc())
                .limit(20)
            )
        )

        out: dict = {
            "scope": "national" if not state_code else state_code.upper(),
            "cycle": cycle,
            "totals": {
                "states": states_count,
                "lgas": lgas_count,
                "elections": elections_count,
                "candidates": candidates_count,
            },
            "cycles": [{"cycle": c, "elections": n} for c, n in cycles_query],
            "election_types": [{"type": t, "count": n} for t, n in types_query],
            "recent_elections": [
                {
                    "election_id": e.election_id,
                    "cycle": e.cycle,
                    "type": e.election_type,
                    "state_id": e.state_id,
                    "date": e.election_date.isoformat() if e.election_date else None,
                    "status": e.status,
                }
                for e in recent_elections
            ],
        }
        return jsonify(out)
