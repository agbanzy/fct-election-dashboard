"""GET /api/elections — list with filters; /api/elections/<id> — detail + standings."""

from __future__ import annotations

from collections import defaultdict

from flask import Blueprint, abort, jsonify, request
from sqlalchemy import func, select

from app.analysis.competitiveness import competitiveness_index
from app.analysis.descriptive import margin_of_victory, turnout
from app.analysis.enp import effective_number_of_parties
from app.db import session_scope
from app.models import Candidate, Election, ElectionResult, Party, State
from app.scraper.election_types import LABELS

bp = Blueprint("elections", __name__, url_prefix="/api/elections")


@bp.get("")
def list_elections():
    state_code = request.args.get("state")
    cycle = request.args.get("cycle", type=int)
    etype = request.args.get("type")
    with session_scope() as session:
        stmt = select(Election)
        if state_code:
            stmt = stmt.join(State, State.state_id == Election.state_id).where(
                State.code == state_code.upper()
            )
        if cycle:
            stmt = stmt.where(Election.cycle == cycle)
        if etype:
            stmt = stmt.where(Election.election_type == etype)
        stmt = stmt.order_by(Election.election_date.desc().nullslast(), Election.cycle.desc())
        return jsonify([_serialize_election(e) for e in session.scalars(stmt)])


@bp.get("/<int:election_id>")
def get_election(election_id: int):
    with session_scope() as session:
        election = session.get(Election, election_id)
        if election is None:
            abort(404)
        return jsonify(_serialize_election(election))


@bp.get("/<int:election_id>/standings")
def get_standings(election_id: int):
    with session_scope() as session:
        election = session.get(Election, election_id)
        if election is None:
            abort(404)

        # Aggregate votes by party (sum across all ElectionResult rows for
        # this election, regardless of aggregation level — PU, ward, LGA,
        # state, national all roll up the same way).
        votes_by_party: dict[int, int] = defaultdict(int)
        accredited_total = 0
        registered_total = 0
        for r in session.scalars(
            select(ElectionResult).where(ElectionResult.election_id == election_id)
        ):
            votes_by_party[r.party_id] += r.votes
            if r.accredited_voters:
                accredited_total += r.accredited_voters
            if r.registered_voters:
                registered_total += r.registered_voters

        if not votes_by_party:
            party_meta: dict[int, tuple[str, str, str | None]] = {}
        else:
            party_meta = {
                p.party_id: (p.code, p.name, p.color_hex)
                for p in session.scalars(
                    select(Party).where(Party.party_id.in_(votes_by_party.keys()))
                )
            }

        # Candidates for this election — keyed by party for a single name
        # when there's one per party, or "(multiple)" when LG races have
        # per-LGA candidates of the same party.
        candidates_for_party: dict[int, list[Candidate]] = defaultdict(list)
        for c in session.scalars(select(Candidate).where(Candidate.election_id == election_id)):
            candidates_for_party[c.party_id].append(c)

        standings = []
        for party_id, total_votes in votes_by_party.items():
            code, name, color = party_meta.get(party_id, ("?", "?", None))
            cands = candidates_for_party.get(party_id, [])
            if len(cands) == 1:
                cand_name = cands[0].full_name
                is_incumbent = cands[0].is_incumbent
            elif len(cands) > 1:
                cand_name = f"{len(cands)} candidates"
                is_incumbent = any(c.is_incumbent for c in cands)
            else:
                cand_name = None
                is_incumbent = False
            standings.append(
                {
                    "party_id": party_id,
                    "party_code": code,
                    "party_name": name,
                    "party_color": color,
                    "candidate": cand_name,
                    "candidate_count": len(cands),
                    "is_incumbent": is_incumbent,
                    "votes": total_votes,
                }
            )
        standings.sort(key=lambda x: x["votes"], reverse=True)
        total = sum(votes_by_party.values())
        for s in standings:
            s["share"] = (s["votes"] / total) if total else 0.0

        return jsonify(
            {
                "election": _serialize_election(election),
                "standings": standings,
                "stats": {
                    "total_votes": total,
                    "accredited": accredited_total or None,
                    "registered": registered_total or None,
                    "turnout": turnout(accredited_total or None, registered_total or None),
                    "margin": margin_of_victory(votes_by_party),
                    "enp": effective_number_of_parties(votes_by_party),
                    "competitiveness": competitiveness_index(
                        votes_by_party=votes_by_party,
                        accredited=accredited_total or None,
                        registered=registered_total or None,
                    ),
                },
            }
        )


@bp.get("/<int:election_id>/reporting-by-lga")
def reporting_by_lga(election_id: int):
    """Per-LGA reporting progress: result sheets published vs polling units.

    This is the breakdown the state map can actually show on election night.
    Party tallies need transcribed votes, and INEC's 2026 IReV publishes only
    EC8A scans — so "how much of each LGA has reported" is the real live
    signal, and it is honest about being progress rather than results.

    `expected` counts the polling units we have walked, so an LGA the scraper
    has not reached yet reports null rather than a misleading 0%.
    """
    from app.models import Lga, PollingUnit, PollingUnitForm, Ward

    with session_scope() as session:
        election = session.get(Election, election_id)
        if election is None:
            abort(404)

        expected = dict(
            session.execute(
                select(Lga.lga_id, func.count(PollingUnit.pu_id))
                .join(Ward, Ward.lga_id == Lga.lga_id)
                .join(PollingUnit, PollingUnit.ward_id == Ward.ward_id)
                .where(Lga.state_id == election.state_id)
                .group_by(Lga.lga_id)
            ).all()
        )
        reported = dict(
            session.execute(
                select(PollingUnitForm.lga_id, func.count(PollingUnitForm.form_id))
                .where(PollingUnitForm.election_id == election_id)
                .group_by(PollingUnitForm.lga_id)
            ).all()
        )

        lgas = list(
            session.scalars(select(Lga).where(Lga.state_id == election.state_id))
        )
        out = []
        for lga in lgas:
            exp = int(expected.get(lga.lga_id) or 0)
            rep = int(reported.get(lga.lga_id) or 0)
            out.append(
                {
                    "lga_id": lga.lga_id,
                    "lga_name": lga.name,
                    "expected_pus": exp,
                    "reported_pus": rep,
                    # Null, not zero — an unwalked LGA is unknown, not empty.
                    "pct": round(rep / exp, 4) if exp else None,
                }
            )
        out.sort(key=lambda r: (r["pct"] is None, -(r["pct"] or 0)))

        from app.ocr.worker import ocr_progress

        return jsonify(
            {
                "election": _serialize_election(election),
                "totals": {
                    "expected_pus": election.expected_pus or 0,
                    "reported_pus": election.uploaded_pus or 0,
                    "walked_pus": sum(expected.values()),
                },
                # Machine-reading progress over the published sheets, so the
                # drain can be watched without tailing worker logs.
                "ocr": ocr_progress(session, election_id),
                "by_lga": out,
            }
        )


@bp.get("/<int:election_id>/by-lga")
def standings_by_lga(election_id: int):
    """Per-LGA standings for LG/Councillor races. Returns one block per LGA
    that has any results or candidates for this election.
    """
    from app.models import Lga

    with session_scope() as session:
        election = session.get(Election, election_id)
        if election is None:
            abort(404)

        # Sum votes per (lga_id, party_id) across all ElectionResult rows
        # (PU, ward, LGA aggregations all roll into the right LGA bucket).
        votes_rows = session.execute(
            select(ElectionResult.lga_id, ElectionResult.party_id, func.sum(ElectionResult.votes))
            .where(
                ElectionResult.election_id == election_id,
                ElectionResult.lga_id.isnot(None),
            )
            .group_by(ElectionResult.lga_id, ElectionResult.party_id)
        ).all()
        votes_by_lga: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        for lga_id, party_id, total in votes_rows:
            if lga_id is not None:
                votes_by_lga[lga_id][party_id] = int(total or 0)

        # Candidates by (lga_id, party_id)
        cands_by_lga: dict[int, dict[int, Candidate]] = defaultdict(dict)
        for c in session.scalars(select(Candidate).where(Candidate.election_id == election_id)):
            if c.lga_id is not None:
                cands_by_lga[c.lga_id][c.party_id] = c

        # All LGAs we care about: ones with votes OR candidates
        all_lga_ids = set(votes_by_lga.keys()) | set(cands_by_lga.keys())
        if not all_lga_ids:
            return jsonify({"election": _serialize_election(election), "by_lga": []})

        lgas = {
            lga.lga_id: lga
            for lga in session.scalars(select(Lga).where(Lga.lga_id.in_(all_lga_ids)))
        }
        party_ids: set[int] = set()
        for v in votes_by_lga.values():
            party_ids.update(v.keys())
        for v in cands_by_lga.values():
            party_ids.update(v.keys())
        parties = {
            p.party_id: p
            for p in session.scalars(select(Party).where(Party.party_id.in_(party_ids)))
        }

        out_blocks = []
        for lga_id in sorted(all_lga_ids, key=lambda lid: (lgas[lid].name if lid in lgas else "")):
            lga = lgas.get(lga_id)
            votes_pp = votes_by_lga.get(lga_id, {})
            total = sum(votes_pp.values())
            block_standings = []
            relevant_parties = set(votes_pp.keys()) | set(cands_by_lga.get(lga_id, {}).keys())
            for pid in relevant_parties:
                party = parties.get(pid)
                if party is None:
                    continue
                cand = cands_by_lga.get(lga_id, {}).get(pid)
                v = votes_pp.get(pid, 0)
                block_standings.append(
                    {
                        "party_id": pid,
                        "party_code": party.code,
                        "party_name": party.name,
                        "party_color": party.color_hex,
                        "candidate": cand.full_name if cand else None,
                        "is_incumbent": cand.is_incumbent if cand else False,
                        "votes": v,
                        "share": (v / total) if total else 0.0,
                    }
                )
            block_standings.sort(key=lambda x: x["votes"], reverse=True)
            winner = block_standings[0] if block_standings and block_standings[0]["votes"] > 0 else None
            out_blocks.append(
                {
                    "lga_id": lga_id,
                    "lga_name": lga.name if lga else None,
                    "total_votes": total,
                    "winner_party": winner["party_code"] if winner else None,
                    "winner_candidate": winner["candidate"] if winner else None,
                    "standings": block_standings,
                }
            )

        return jsonify({"election": _serialize_election(election), "by_lga": out_blocks})


def _serialize_election(e: Election) -> dict:
    return {
        "election_id": e.election_id,
        "cycle": e.cycle,
        "election_type": e.election_type,
        "election_type_label": LABELS.get(e.election_type, e.election_type),
        "state_id": e.state_id,
        "election_date": e.election_date.isoformat() if e.election_date else None,
        "status": e.status,
        "irev_election_id": e.irev_election_id,
    }
