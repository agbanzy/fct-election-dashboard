"""GET /api/states, /api/states/<code>, /api/states/<code>/lgas — geography lookups."""

from __future__ import annotations

from flask import Blueprint, abort, jsonify
from sqlalchemy import func, select

from app.db import session_scope
from app.models import Lga, State, Ward

bp = Blueprint("states", __name__, url_prefix="/api/states")


@bp.get("")
def list_states():
    with session_scope() as session:
        rows = session.scalars(select(State).order_by(State.name))
        return jsonify(
            [
                {
                    "state_id": s.state_id,
                    "code": s.code,
                    "name": s.name,
                    "zone": s.zone,
                }
                for s in rows
            ]
        )


@bp.get("/<code>")
def get_state(code: str):
    with session_scope() as session:
        state = session.scalar(select(State).where(State.code == code.upper()))
        if state is None:
            abort(404)
        return jsonify(
            {
                "state_id": state.state_id,
                "code": state.code,
                "name": state.name,
                "zone": state.zone,
            }
        )


@bp.get("/<code>/lgas")
def list_lgas(code: str):
    with session_scope() as session:
        state = session.scalar(select(State).where(State.code == code.upper()))
        if state is None:
            abort(404)
        rows = session.scalars(
            select(Lga).where(Lga.state_id == state.state_id).order_by(Lga.name)
        )
        return jsonify(
            [
                {
                    "lga_id": lga.lga_id,
                    "name": lga.name,
                    "kind": lga.lga_kind,
                    "irev_lga_id": lga.irev_lga_id,
                }
                for lga in rows
            ]
        )


@bp.get("/lgas/<int:lga_id>/wards")
def list_wards(lga_id: int):
    with session_scope() as session:
        rows = session.scalars(
            select(Ward).where(Ward.lga_id == lga_id).order_by(Ward.name)
        )
        return jsonify(
            [
                {"ward_id": w.ward_id, "name": w.name, "irev_ward_id": w.irev_ward_id}
                for w in rows
            ]
        )


@bp.get("/<code>/results-by-election")
def results_by_election(code: str):
    """Per-election results for one state: who won, by how much.

    Replaces a cumulative roll-up that summed a presidential race and a
    governorship into a single bar. Adding votes across different offices
    produces a number that describes no election that was ever held, and a
    "55.2% APC" derived that way invites being read as a result. What a
    reader wants from a state page is the opposite cut: each race on its own,
    with the winner, the runner-up, and the gap between them.

    Live races are excluded — a margin computed mid-count is not a margin.
    """
    from app.models import Candidate, Election, ElectionResult, Party
    from app.scraper.election_types import LABELS as TYPE_LABELS
    from app.scraper.sync import today_wat

    with session_scope() as session:
        state = session.scalar(select(State).where(State.code == code.upper()))
        if state is None:
            abort(404)

        elections = list(
            session.scalars(
                select(Election).where(
                    Election.state_id == state.state_id,
                    Election.status != "live",
                    (Election.election_date.is_(None))
                    | (Election.election_date < today_wat()),
                )
            )
        )
        # Presidential races are national rows carrying a state_id on the
        # result, not on the election, so pick them up via the results side.
        national_ids = [
            eid
            for (eid,) in session.execute(
                select(ElectionResult.election_id)
                .where(ElectionResult.state_id == state.state_id)
                .group_by(ElectionResult.election_id)
            ).all()
        ]
        seen = {e.election_id for e in elections}
        for eid in national_ids:
            if eid in seen:
                continue
            elec = session.get(Election, eid)
            if elec is not None and elec.status != "live":
                elections.append(elec)

        out = []
        for elec in elections:
            rows = session.execute(
                select(Party.code, Party.name, Party.color_hex, func.sum(ElectionResult.votes))
                .join(Party, Party.party_id == ElectionResult.party_id)
                .where(
                    ElectionResult.election_id == elec.election_id,
                    ElectionResult.state_id == state.state_id,
                )
                .group_by(Party.code, Party.name, Party.color_hex)
                .order_by(func.sum(ElectionResult.votes).desc())
            ).all()
            standings = [
                {
                    "party": c,
                    "party_name": n,
                    "color": col,
                    "votes": int(v or 0),
                }
                for c, n, col, v in rows
                if int(v or 0) > 0
            ]
            if not standings:
                continue

            total = sum(s["votes"] for s in standings)
            for s in standings:
                s["share"] = round(s["votes"] / total, 4) if total else 0.0

            cands = dict(
                session.execute(
                    select(Party.code, Candidate.full_name)
                    .join(Party, Party.party_id == Candidate.party_id)
                    .where(Candidate.election_id == elec.election_id)
                ).all()
            )
            for s in standings:
                s["candidate"] = cands.get(s["party"])

            winner = standings[0]
            runner_up = standings[1] if len(standings) > 1 else None
            out.append(
                {
                    "election_id": elec.election_id,
                    "election_type": elec.election_type,
                    "election_type_label": TYPE_LABELS.get(
                        elec.election_type, elec.election_type
                    ),
                    "cycle": elec.cycle,
                    "election_date": elec.election_date.isoformat()
                    if elec.election_date
                    else None,
                    "total_votes": total,
                    "winner": winner,
                    "runner_up": runner_up,
                    # Both framings: the raw gap, and the gap in points, which
                    # is what makes races of different sizes comparable.
                    "margin_votes": winner["votes"] - runner_up["votes"] if runner_up else None,
                    "margin_points": round(winner["share"] - runner_up["share"], 4)
                    if runner_up
                    else None,
                    "standings": standings[:8],
                }
            )

        out.sort(key=lambda r: (r["cycle"], r["election_date"] or ""), reverse=True)
        return jsonify({"state": {"code": state.code, "name": state.name}, "elections": out})
