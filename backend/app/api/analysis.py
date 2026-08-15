"""GET /api/analysis/{turnout,enp,swing,competitiveness,heatmap,timeline}.

Phase A delivers compute-on-the-fly versions. Phase D will swap heavy queries
for materialized views (`mv_turnout`, `mv_enp`, `mv_swing`, `mv_competitiveness`)
without changing the response shape.
"""

from __future__ import annotations

from collections import defaultdict

from flask import Blueprint, jsonify, request
from sqlalchemy import func, select
from sqlalchemy import text as _text

from app.analysis.competitiveness import competitiveness_index
from app.analysis.descriptive import margin_of_victory, turnout
from app.analysis.enp import effective_number_of_parties
from app.analysis.swing import compute_swings
from app.db import session_scope
from app.models import Candidate, Election, ElectionResult, Party, ScrapeLog, State
from app.scraper.election_types import LABELS as TYPE_LABELS

bp = Blueprint("analysis", __name__, url_prefix="/api/analysis")


@bp.get("/turnout")
def turnout_by_state():
    cycle = request.args.get("cycle", type=int)
    etype = request.args.get("type")
    with session_scope() as session:
        stmt = (
            select(
                State.code,
                State.name,
                func.sum(ElectionResult.accredited_voters),
                func.sum(ElectionResult.registered_voters),
            )
            .join(State, State.state_id == ElectionResult.state_id)
            .join(Election, Election.election_id == ElectionResult.election_id)
        )
        if cycle:
            stmt = stmt.where(Election.cycle == cycle)
        if etype:
            stmt = stmt.where(Election.election_type == etype)
        stmt = stmt.group_by(State.code, State.name)
        out = []
        for code, name, acc, reg in session.execute(stmt).all():
            out.append(
                {
                    "state_code": code,
                    "state_name": name,
                    "accredited": acc,
                    "registered": reg,
                    "turnout": turnout(acc, reg),
                }
            )
        return jsonify(out)


@bp.get("/enp")
def enp_by_election():
    """Read mv_enp when present; fall back to on-the-fly computation otherwise."""
    cycle = request.args.get("cycle", type=int)
    etype = request.args.get("type")
    with session_scope() as session:
        # Try materialized view first
        try:
            mv_sql = "SELECT election_id, cycle, election_type, state_id, enp, total_votes FROM mv_enp"
            where = []
            params: dict = {}
            if cycle:
                where.append("cycle = :cycle")
                params["cycle"] = cycle
            if etype:
                where.append("election_type = :etype")
                params["etype"] = etype
            if where:
                mv_sql += " WHERE " + " AND ".join(where)
            mv_rows = list(session.execute(_text(mv_sql), params))
            if mv_rows:
                return jsonify(
                    [
                        {
                            "election_id": r[0],
                            "cycle": r[1],
                            "type": r[2],
                            "state_id": r[3],
                            "enp": float(r[4] or 0),
                            "margin": _margin_for(session, r[0]),
                        }
                        for r in mv_rows
                    ]
                )
        except Exception:
            pass  # MV may not exist yet — fall through

        stmt = select(Election)
        if cycle:
            stmt = stmt.where(Election.cycle == cycle)
        if etype:
            stmt = stmt.where(Election.election_type == etype)
        out = []
        for e in session.scalars(stmt):
            votes = _votes_by_party(session, e.election_id)
            out.append(
                {
                    "election_id": e.election_id,
                    "cycle": e.cycle,
                    "type": e.election_type,
                    "state_id": e.state_id,
                    "enp": effective_number_of_parties(votes),
                    "margin": margin_of_victory(votes),
                }
            )
        return jsonify(out)


def _margin_for(session, election_id: int) -> float | None:
    """Lightweight margin lookup for MV-served rows."""
    return margin_of_victory(_votes_by_party(session, election_id))


@bp.get("/swing")
def swing_between_cycles():
    state_code = request.args.get("state")
    etype = request.args.get("type")
    cycle_a = request.args.get("a", type=int)
    cycle_b = request.args.get("b", type=int)
    if not (cycle_a and cycle_b and etype):
        return jsonify({"error": "missing required: a, b, type"}), 400
    with session_scope() as session:
        a_votes = _votes_for(session, cycle=cycle_a, etype=etype, state_code=state_code)
        b_votes = _votes_for(session, cycle=cycle_b, etype=etype, state_code=state_code)
        swings = compute_swings(a_votes, b_votes)
        # Resolve party_id → code/name/color so the UI shows "APC" not "#3".
        party_ids = [s.party for s in swings]
        parties = (
            {
                p.party_id: p
                for p in session.scalars(select(Party).where(Party.party_id.in_(party_ids)))
            }
            if party_ids
            else {}
        )
        return jsonify(
            {
                "cycle_a": cycle_a,
                "cycle_b": cycle_b,
                "type": etype,
                "state_code": state_code,
                "swings": [
                    {
                        "party_id": s.party,
                        "party_code": parties[s.party].code if s.party in parties else None,
                        "party_name": parties[s.party].name if s.party in parties else None,
                        "party_color": parties[s.party].color_hex if s.party in parties else None,
                        "share_prior": s.share_prior,
                        "share_current": s.share_current,
                        "delta": s.delta,
                    }
                    for s in swings
                ],
            }
        )


@bp.get("/competitiveness")
def competitiveness():
    cycle = request.args.get("cycle", type=int)
    etype = request.args.get("type")
    with session_scope() as session:
        stmt = select(Election)
        if cycle:
            stmt = stmt.where(Election.cycle == cycle)
        if etype:
            stmt = stmt.where(Election.election_type == etype)
        out = []
        for e in session.scalars(stmt):
            votes = _votes_by_party(session, e.election_id)
            stats = _stats(session, e.election_id)
            out.append(
                {
                    "election_id": e.election_id,
                    "state_id": e.state_id,
                    "cycle": e.cycle,
                    "type": e.election_type,
                    "competitiveness": competitiveness_index(
                        votes_by_party=votes,
                        accredited=stats["accredited"],
                        registered=stats["registered"],
                    ),
                }
            )
        return jsonify(out)


@bp.get("/party-totals")
def party_totals():
    """Sum votes per party across all elections matching filters.

    Returns:
      {grand_total, parties: [{party_code, party_name, party_color, total_votes,
                              share, elections_count}, ...]}
    """
    cycle = request.args.get("cycle", type=int)
    etype = request.args.get("type")
    state_code = request.args.get("state")
    with session_scope() as session:
        stmt = (
            select(
                Party.party_id,
                Party.code,
                Party.name,
                Party.color_hex,
                func.sum(ElectionResult.votes),
                func.count(func.distinct(ElectionResult.election_id)),
            )
            .join(Party, Party.party_id == ElectionResult.party_id)
            .join(Election, Election.election_id == ElectionResult.election_id)
        )
        if cycle:
            stmt = stmt.where(Election.cycle == cycle)
        if etype:
            stmt = stmt.where(Election.election_type == etype)
        if state_code:
            stmt = stmt.join(State, State.state_id == ElectionResult.state_id).where(
                State.code == state_code.upper()
            )
        stmt = stmt.group_by(Party.party_id, Party.code, Party.name, Party.color_hex)
        stmt = stmt.order_by(func.sum(ElectionResult.votes).desc().nullslast())

        rows = list(session.execute(stmt).all())
        grand_total = sum(int(v or 0) for _, _, _, _, v, _ in rows)
        out = []
        for party_id, code, name, color, total, n_elections in rows:
            total = int(total or 0)
            out.append(
                {
                    "party_id": party_id,
                    "party_code": code,
                    "party_name": name,
                    "party_color": color,
                    "total_votes": total,
                    "share": total / grand_total if grand_total else 0.0,
                    "elections_count": int(n_elections),
                }
            )
        # Name the races actually behind these totals. Callers were showing a
        # bare count next to a cumulative percentage, which on polling day
        # reads as the live result — the UI needs to be able to say which
        # concluded races produced the number.
        src_stmt = (
            select(
                Election.election_id,
                Election.election_type,
                Election.cycle,
                Election.election_date,
            )
            .join(ElectionResult, ElectionResult.election_id == Election.election_id)
        )
        if cycle:
            src_stmt = src_stmt.where(Election.cycle == cycle)
        if etype:
            src_stmt = src_stmt.where(Election.election_type == etype)
        if state_code:
            src_stmt = src_stmt.join(
                State, State.state_id == ElectionResult.state_id
            ).where(State.code == state_code.upper())
        src_stmt = src_stmt.group_by(
            Election.election_id,
            Election.election_type,
            Election.cycle,
            Election.election_date,
        ).order_by(Election.election_date.desc().nullslast())

        sources = [
            {
                "election_id": eid,
                "election_type": etype_,
                "election_type_label": TYPE_LABELS.get(etype_, etype_),
                "cycle": cyc,
                "election_date": edate.isoformat() if edate else None,
            }
            for eid, etype_, cyc, edate in session.execute(src_stmt).all()
        ]

        return jsonify(
            {"grand_total": grand_total, "parties": out, "sources": sources}
        )


@bp.get("/winners")
def winners_per_state():
    """Per-state winner for the given cycle + election_type. Used by the
    party-colored choropleth + state comparison view.

    Returns: {state_code: str → {winner_party_code, winner_candidate, votes,
                                 share, second_place, margin}}
    """
    cycle = request.args.get("cycle", default=2023, type=int)
    etype = request.args.get("type", default="presidential")
    with session_scope() as session:
        # Get all states
        states = {s.state_id: s for s in session.scalars(select(State))}
        # Find the election rows
        elections = list(
            session.scalars(
                select(Election).where(
                    Election.cycle == cycle,
                    Election.election_type == etype,
                )
            )
        )
        out: dict[str, dict] = {}
        for elec in elections:
            # Get vote totals per party for this election
            party_rows = session.execute(
                select(
                    ElectionResult.party_id,
                    Party.code,
                    Party.color_hex,
                    func.sum(ElectionResult.votes),
                )
                .join(Party, Party.party_id == ElectionResult.party_id)
                .where(ElectionResult.election_id == elec.election_id)
                .group_by(ElectionResult.party_id, Party.code, Party.color_hex)
                .order_by(func.sum(ElectionResult.votes).desc())
            ).all()
            if not party_rows:
                continue
            top = party_rows[0]
            second = party_rows[1] if len(party_rows) > 1 else None
            total = sum(int(r[3] or 0) for r in party_rows)
            winner_votes = int(top[3] or 0)
            margin = (
                (winner_votes - int(second[3] or 0)) / total
                if (second and total)
                else None
            )
            # Lookup candidate
            cand = session.scalar(
                select(Candidate).where(
                    Candidate.election_id == elec.election_id,
                    Candidate.party_id == top[0],
                )
            )
            state = states.get(elec.state_id) if elec.state_id else None
            key = state.code if state else "NG"
            out[key] = {
                "state_code": key,
                "state_name": state.name if state else "National",
                "winner_party_id": top[0],
                "winner_party_code": top[1],
                "winner_party_color": top[2],
                "winner_candidate": cand.full_name if cand else None,
                "winner_votes": winner_votes,
                "winner_share": (winner_votes / total) if total else 0.0,
                "second_party_code": second[1] if second else None,
                "margin": margin,
                "total_votes": total,
            }
        return jsonify(out)


@bp.get("/zone-summary")
def zone_summary():
    """Aggregate votes by geopolitical zone × party for a given cycle/type."""
    cycle = request.args.get("cycle", default=2023, type=int)
    etype = request.args.get("type", default="presidential")
    with session_scope() as session:
        rows = session.execute(
            select(
                State.zone,
                Party.code,
                Party.color_hex,
                func.sum(ElectionResult.votes),
            )
            .join(Party, Party.party_id == ElectionResult.party_id)
            .join(State, State.state_id == ElectionResult.state_id)
            .join(Election, Election.election_id == ElectionResult.election_id)
            .where(Election.cycle == cycle, Election.election_type == etype)
            .group_by(State.zone, Party.code, Party.color_hex)
        ).all()
        by_zone: dict[str, dict] = {}
        for zone, code, color, total in rows:
            z = by_zone.setdefault(zone, {"zone": zone, "total": 0, "parties": []})
            z["parties"].append({"party_code": code, "party_color": color, "votes": int(total or 0)})
            z["total"] += int(total or 0)
        # Sort parties within each zone, compute shares + winner
        for z in by_zone.values():
            z["parties"].sort(key=lambda p: p["votes"], reverse=True)
            for p in z["parties"]:
                p["share"] = p["votes"] / z["total"] if z["total"] else 0.0
            z["winner"] = z["parties"][0]["party_code"] if z["parties"] else None
        return jsonify(
            sorted(by_zone.values(), key=lambda z: -z["total"])
        )


@bp.get("/party-trajectory")
def party_trajectory():
    """Party vote-share across cycles for a given election type. Drives the
    multi-cycle line/area chart on /insights."""
    etype = request.args.get("type", default="presidential")
    state_code = request.args.get("state")
    with session_scope() as session:
        stmt = (
            select(
                Election.cycle,
                Party.code,
                Party.color_hex,
                func.sum(ElectionResult.votes),
            )
            .join(Party, Party.party_id == ElectionResult.party_id)
            .join(Election, Election.election_id == ElectionResult.election_id)
            .where(Election.election_type == etype)
            .group_by(Election.cycle, Party.code, Party.color_hex)
            .order_by(Election.cycle.asc())
        )
        if state_code:
            stmt = stmt.join(State, State.state_id == ElectionResult.state_id).where(
                State.code == state_code.upper()
            )
        rows = list(session.execute(stmt).all())
        cycles: dict[int, dict] = {}
        for cycle, code, color, votes in rows:
            cycles.setdefault(cycle, {"cycle": cycle, "parties": []})
            cycles[cycle]["parties"].append({"party_code": code, "party_color": color, "votes": int(votes or 0)})
        for c in cycles.values():
            total = sum(p["votes"] for p in c["parties"])
            for p in c["parties"]:
                p["share"] = p["votes"] / total if total else 0.0
        return jsonify(sorted(cycles.values(), key=lambda c: c["cycle"]))


@bp.get("/biggest-swings")
def biggest_swings():
    """Top N party share changes between two cycles, same type, across states."""
    a = request.args.get("a", type=int)
    b = request.args.get("b", type=int)
    etype = request.args.get("type", default="presidential")
    limit = min(request.args.get("limit", default=20, type=int), 200)
    if not (a and b):
        return jsonify({"error": "missing required: a, b"}), 400
    with session_scope() as session:
        def shares(cycle: int) -> dict:
            stmt = (
                select(
                    State.code,
                    State.name,
                    Party.code,
                    Party.color_hex,
                    func.sum(ElectionResult.votes),
                )
                .join(Party, Party.party_id == ElectionResult.party_id)
                .join(State, State.state_id == ElectionResult.state_id)
                .join(Election, Election.election_id == ElectionResult.election_id)
                .where(Election.cycle == cycle, Election.election_type == etype)
                .group_by(State.code, State.name, Party.code, Party.color_hex)
            )
            out: dict = {}
            for sc, sn, pc, color, v in session.execute(stmt).all():
                state_block = out.setdefault(sc, {"state_code": sc, "state_name": sn, "parties": {}, "total": 0})
                state_block["parties"][pc] = {"votes": int(v or 0), "color": color}
                state_block["total"] += int(v or 0)
            return out

        a_data = shares(a)
        b_data = shares(b)
        all_states = set(a_data) | set(b_data)
        swings = []
        all_parties: set[str] = set()
        for sc in all_states:
            for blk in (a_data.get(sc, {}).get("parties") or {}):
                all_parties.add(blk)
            for blk in (b_data.get(sc, {}).get("parties") or {}):
                all_parties.add(blk)
        for sc in all_states:
            a_blk = a_data.get(sc, {})
            b_blk = b_data.get(sc, {})
            a_total = a_blk.get("total") or 0
            b_total = b_blk.get("total") or 0
            for pc in all_parties:
                a_v = (a_blk.get("parties") or {}).get(pc, {}).get("votes", 0)
                b_v = (b_blk.get("parties") or {}).get(pc, {}).get("votes", 0)
                a_share = (a_v / a_total) if a_total else 0
                b_share = (b_v / b_total) if b_total else 0
                if a_share == 0 and b_share == 0:
                    continue
                color = (b_blk.get("parties") or {}).get(pc, {}).get("color") or (
                    a_blk.get("parties") or {}
                ).get(pc, {}).get("color")
                swings.append(
                    {
                        "state_code": sc,
                        "state_name": (a_blk or b_blk).get("state_name"),
                        "party_code": pc,
                        "party_color": color,
                        "share_a": a_share,
                        "share_b": b_share,
                        "delta": b_share - a_share,
                    }
                )
        swings.sort(key=lambda s: abs(s["delta"]), reverse=True)
        return jsonify({"cycle_a": a, "cycle_b": b, "type": etype, "swings": swings[:limit]})


@bp.get("/timeline")
def scrape_timeline():
    limit = min(request.args.get("limit", default=300, type=int), 2000)
    with session_scope() as session:
        rows = session.scalars(
            select(ScrapeLog).order_by(ScrapeLog.created_at.desc()).limit(limit)
        )
        return jsonify(
            [
                {
                    "log_id": r.log_id,
                    "phase": r.phase,
                    "state_id": r.state_id,
                    "election_id": r.election_id,
                    "status": r.status,
                    "message": r.message,
                    "duration_ms": r.duration_ms,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ]
        )


def _votes_by_party(session, election_id: int) -> dict[int, int]:
    out: dict[int, int] = defaultdict(int)
    for r in session.scalars(
        select(ElectionResult).where(ElectionResult.election_id == election_id)
    ):
        out[r.party_id] += r.votes
    return out


def _stats(session, election_id: int) -> dict:
    acc = 0
    reg = 0
    for r in session.scalars(
        select(ElectionResult).where(ElectionResult.election_id == election_id)
    ):
        acc += r.accredited_voters or 0
        reg += r.registered_voters or 0
    return {"accredited": acc or None, "registered": reg or None}


def _votes_for(session, *, cycle: int, etype: str, state_code: str | None) -> dict[int, int]:
    stmt = (
        select(ElectionResult.party_id, func.sum(ElectionResult.votes))
        .join(Election, Election.election_id == ElectionResult.election_id)
        .where(Election.cycle == cycle, Election.election_type == etype)
        .group_by(ElectionResult.party_id)
    )
    if state_code:
        stmt = stmt.join(State, State.state_id == ElectionResult.state_id).where(
            State.code == state_code.upper()
        )
    return {pid: int(v) for pid, v in session.execute(stmt).all()}
