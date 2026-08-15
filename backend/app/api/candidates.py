"""GET /api/candidates — filterable by election, party, state, cycle, type, incumbency."""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from sqlalchemy import select

from app.db import session_scope
from app.models import Candidate, Election, Lga, Party, State, Ward
from app.scraper.election_types import LABELS

bp = Blueprint("candidates", __name__, url_prefix="/api/candidates")


@bp.get("")
def list_candidates():
    # Accept both spellings. Responses carry `election_id`, so that is what
    # callers reach for — and the old name-only lookup meant `?election_id=242`
    # was silently ignored, quietly returning every candidate in the country
    # rather than an empty set or an error. A filter that no-ops is worse than
    # one that rejects: the caller believes it applied.
    election_id = request.args.get("election_id", type=int) or request.args.get(
        "election", type=int
    )
    party_code = request.args.get("party")
    state_code = request.args.get("state")
    cycle = request.args.get("cycle", type=int)
    etype = request.args.get("type")
    incumbent_only = request.args.get("incumbent")
    limit = min(request.args.get("limit", default=500, type=int), 5000)

    with session_scope() as session:
        stmt = (
            select(Candidate, Party, Election, Lga, Ward, State)
            .join(Party, Party.party_id == Candidate.party_id)
            .join(Election, Election.election_id == Candidate.election_id)
            .outerjoin(Lga, Lga.lga_id == Candidate.lga_id)
            .outerjoin(Ward, Ward.ward_id == Candidate.ward_id)
            .outerjoin(State, State.state_id == Election.state_id)
        )
        if election_id:
            stmt = stmt.where(Candidate.election_id == election_id)
        if party_code:
            stmt = stmt.where(Party.code == party_code.upper())
        if state_code:
            stmt = stmt.where(State.code == state_code.upper())
        if cycle:
            stmt = stmt.where(Election.cycle == cycle)
        if etype:
            stmt = stmt.where(Election.election_type == etype)
        if incumbent_only and incumbent_only.lower() in ("1", "true", "yes"):
            stmt = stmt.where(Candidate.is_incumbent.is_(True))
        stmt = stmt.order_by(
            Election.cycle.desc(),
            Election.election_type.asc(),
            State.code.asc(),
            Party.code.asc(),
            Candidate.full_name.asc(),
        )
        stmt = stmt.limit(limit)

        out = []
        for cand, party, election, lga, ward, state in session.execute(stmt).all():
            out.append(
                {
                    "candidate_id": cand.candidate_id,
                    "full_name": cand.full_name,
                    "is_incumbent": cand.is_incumbent,
                    "party_code": party.code,
                    "party_name": party.name,
                    "party_color": party.color_hex,
                    "election_id": election.election_id,
                    "election_type": election.election_type,
                    "election_type_label": LABELS.get(election.election_type, election.election_type),
                    "cycle": election.cycle,
                    "state_code": state.code if state else None,
                    "state_name": state.name if state else None,
                    "lga_name": lga.name if lga else None,
                    "ward_name": ward.name if ward else None,
                }
            )
        return jsonify(out)


@bp.get("/summary")
def summary():
    """Counts: total candidates, distinct elections covered, incumbent count."""
    from sqlalchemy import func as _func

    with session_scope() as session:
        total = session.scalar(select(_func.count(Candidate.candidate_id))) or 0
        elections = session.scalar(select(_func.count(_func.distinct(Candidate.election_id)))) or 0
        incumbents = session.scalar(
            select(_func.count(Candidate.candidate_id)).where(Candidate.is_incumbent.is_(True))
        ) or 0
        by_party = session.execute(
            select(Party.code, _func.count(Candidate.candidate_id))
            .join(Candidate, Candidate.party_id == Party.party_id)
            .group_by(Party.code)
            .order_by(_func.count(Candidate.candidate_id).desc())
            .limit(20)
        ).all()
        return jsonify(
            {
                "total_candidates": total,
                "distinct_elections": elections,
                "incumbents": incumbents,
                "by_party": [{"party_code": p, "count": int(n)} for p, n in by_party],
            }
        )
