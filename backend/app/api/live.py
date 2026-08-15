"""Live-election endpoints.

`GET /api/live/now` — what is happening right now: the election(s) in progress,
how much of the state has reported, and the running tallies. This is what the
dashboard hero polls on polling day.

`GET /api/live/events` — SSE heartbeat. Phase A only; the real broadcaster
needs Postgres LISTEN/NOTIFY or Redis pub/sub and is a TODO for Phase B.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime

from flask import Blueprint, Response, jsonify
from sqlalchemy import func, select

from app.db import session_scope
from app.models import (
    Candidate,
    Election,
    ElectionResult,
    Party,
    PollingUnitForm,
    State,
)
from app.scraper.election_types import LABELS as TYPE_LABELS
from app.scraper.sync import today_wat

bp = Blueprint("live", __name__, url_prefix="/api/live")


@bp.get("/now")
def now():
    """Elections in progress, with reporting progress and running tallies.

    Returns `{"live": false, ...}` rather than 404 when nothing is running, so
    the dashboard can render a calm empty state without treating it as an error.
    """
    today = today_wat()

    with session_scope() as session:
        elections = list(
            session.scalars(
                select(Election)
                .where(
                    (Election.status == "live")
                    | (Election.election_date == today)
                )
                .order_by(Election.election_date.desc())
            )
        )

        if not elections:
            return jsonify({"live": False, "as_of": datetime.now(UTC).isoformat(), "elections": []})

        states = {s.state_id: s for s in session.scalars(select(State))}
        payload = []

        for elec in elections:
            expected = elec.expected_pus or 0
            uploaded = elec.uploaded_pus or 0

            # Running tallies. PU-level rows are the finest grain the scraper
            # writes on election day; fall back to whatever aggregation exists
            # so an early-stage election still shows something real.
            aggregation = "pu"
            have_pu = session.scalar(
                select(func.count(ElectionResult.result_id)).where(
                    ElectionResult.election_id == elec.election_id,
                    ElectionResult.aggregation == "pu",
                )
            ) or 0

            # How many polling units actually carry transcribed votes. INEC
            # publishes result sheets as images, so any vote rows we hold for a
            # live election are fragmentary — a handful of units out of
            # thousands. Reporting a "leader" off that is misinformation, so the
            # caller needs the coverage, not just the totals.
            pus_with_votes = session.scalar(
                select(func.count(func.distinct(ElectionResult.pu_id))).where(
                    ElectionResult.election_id == elec.election_id,
                    ElectionResult.pu_id.is_not(None),
                )
            ) or 0

            # Units whose votes were read off the scan by machine rather than
            # transcribed by INEC.
            machine_read = session.scalar(
                select(func.count(PollingUnitForm.form_id)).where(
                    PollingUnitForm.election_id == elec.election_id,
                    PollingUnitForm.ocr_status == "read",
                )
            ) or 0

            if not have_pu:
                aggregation = session.scalar(
                    select(ElectionResult.aggregation)
                    .where(ElectionResult.election_id == elec.election_id)
                    .limit(1)
                )

            tallies = []
            if aggregation:
                rows = session.execute(
                    select(
                        Party.code,
                        Party.name,
                        Party.color_hex,
                        func.sum(ElectionResult.votes),
                    )
                    .join(Party, Party.party_id == ElectionResult.party_id)
                    .where(
                        ElectionResult.election_id == elec.election_id,
                        ElectionResult.aggregation == aggregation,
                    )
                    .group_by(Party.code, Party.name, Party.color_hex)
                    .order_by(func.sum(ElectionResult.votes).desc())
                ).all()

                candidates = dict(
                    session.execute(
                        select(Party.code, Candidate.full_name)
                        .join(Party, Party.party_id == Candidate.party_id)
                        .where(Candidate.election_id == elec.election_id)
                    ).all()
                )

                total = sum(int(v or 0) for *_, v in rows) or 0
                tallies = [
                    {
                        "party": code,
                        "party_name": name,
                        "color": color,
                        "candidate": candidates.get(code),
                        "votes": int(votes or 0),
                        "share": round(int(votes or 0) / total, 4) if total else 0.0,
                    }
                    for code, name, color, votes in rows
                ]

            state = states.get(elec.state_id) if elec.state_id else None
            payload.append(
                {
                    "election_id": elec.election_id,
                    "election_type": elec.election_type,
                    "election_type_label": TYPE_LABELS.get(
                        elec.election_type, elec.election_type
                    ),
                    "election_date": elec.election_date.isoformat()
                    if elec.election_date
                    else None,
                    "state_id": elec.state_id,
                    "state_name": state.name if state else None,
                    "state_code": state.code if state else None,
                    "status": elec.status,
                    "reporting": {
                        "expected_pus": expected,
                        "uploaded_pus": uploaded,
                        "pct": round(uploaded / expected, 4) if expected else 0.0,
                    },
                    "aggregation": aggregation,
                    "total_votes": sum(t["votes"] for t in tallies),
                    "tallies": tallies,
                    # Consumers must gate any leader claim on this, not on
                    # tallies being non-empty.
                    "tally_coverage": {
                        "pus_with_votes": pus_with_votes,
                        "reported_pus": uploaded,
                        "pct": round(pus_with_votes / uploaded, 4) if uploaded else 0.0,
                        # How many of those units were read off a scan by
                        # machine rather than transcribed by INEC. The UI must
                        # say so: a number nobody has checked should never sit
                        # on the page looking like an official return.
                        "machine_read_pus": machine_read,
                    },
                    "results_synced_at": elec.results_synced_at.isoformat()
                    if elec.results_synced_at
                    else None,
                }
            )

    return jsonify(
        {
            "live": True,
            "as_of": datetime.now(UTC).isoformat(),
            "elections": payload,
        }
    )


@bp.get("/events")
def events():
    def gen():
        yield f"event: connected\ndata: {json.dumps({'ts': datetime.now(UTC).isoformat()})}\n\n"
        while True:
            time.sleep(15)
            yield f"event: heartbeat\ndata: {json.dumps({'ts': datetime.now(UTC).isoformat()})}\n\n"

    return Response(gen(), mimetype="text/event-stream")
