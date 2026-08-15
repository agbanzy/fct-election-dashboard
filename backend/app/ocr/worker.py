"""Read published EC8A sheets, cache the readings, publish the confident ones.

Cost control is the whole design. A state publishes thousands of sheets and
the ward walk revisits wards continuously, so the rule is: **each image is
read exactly once.** The reading lives on the form row, keyed by the URL it
came from. A sheet already read is never sent again; a sheet INEC replaces
arrives with a new URL and is re-read, which is the only case worth paying
for twice.

`unreadable` is terminal for the same reason. A sheet whose figures and words
contradict each other will contradict itself on a second reading too, and
retrying it spends money to reach the conclusion we already have.

Published votes are marked machine-read and unverified. Nothing here is
authoritative; a human accepting a sheet in /admin is what makes it so.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import requests
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.importer.normalizers import resolve_party
from app.models import Election, ElectionResult, PollingUnit, PollingUnitForm, Ward
from app.ocr.ec8a_vision import read_ec8a
from app.scraper.phases import ensure_source

log = logging.getLogger(__name__)

#: Minimum confidence before a reading's votes reach the public tallies.
#: Confidence here is the share of scored rows whose figures and words agree,
#: halved when the parties do not sum to the sheet's own total — so 1.0 means
#: every row was corroborated twice over and the arithmetic closed. Anything
#: less is a sheet disagreeing with itself, which is exactly what must not be
#: published as a vote count.
PUBLISH_CONFIDENCE = 1.0

OCR_SOURCE_NAME = "irev_ec8a_machine_read"


def read_pending_forms(
    session: Session,
    election_id: int,
    *,
    limit: int = 25,
    api_key: str | None = None,
) -> dict[str, int]:
    """Read up to `limit` unread sheets for one election.

    Returns counters. Bounded per call so a caller can spend a predictable
    number of API calls per tick rather than draining thousands at once.
    """
    counters = {"attempted": 0, "read": 0, "unreadable": 0, "errors": 0, "published": 0}

    rows = list(
        session.scalars(
            select(PollingUnitForm)
            .where(
                PollingUnitForm.election_id == election_id,
                PollingUnitForm.document_url.isnot(None),
                # Never read the same image twice: unread sheets, or ones whose
                # image has since been replaced.
                or_(
                    PollingUnitForm.ocr_status.is_(None),
                    PollingUnitForm.ocr_url.is_(None),
                    PollingUnitForm.ocr_url != PollingUnitForm.document_url,
                ),
            )
            .limit(limit)
        )
    )
    if not rows:
        return counters

    election = session.get(Election, election_id)
    if election is None:
        return counters
    source = ensure_source(session, OCR_SOURCE_NAME)

    for form in rows:
        counters["attempted"] += 1
        url = form.document_url or ""
        try:
            img = requests.get(url, timeout=45)
            img.raise_for_status()
        except requests.RequestException as exc:
            log.warning("ocr: fetch failed pu=%s: %s", form.pu_id, exc)
            counters["errors"] += 1
            # Left unstamped on purpose — a transport failure says nothing
            # about the sheet, so it stays in the queue.
            continue

        reading = read_ec8a(img.content, api_key=api_key)
        if reading is None:
            # Reader unavailable, not sheet unreadable. Same reasoning.
            counters["errors"] += 1
            continue

        form.ocr_url = url
        form.ocr_confidence = reading.confidence
        form.ocr_votes = reading.party_votes or {}
        form.ocr_problems = reading.problems or []
        form.ocr_read_at = datetime.now(UTC)

        if reading.confidence >= PUBLISH_CONFIDENCE and reading.party_votes:
            form.ocr_status = "read"
            counters["read"] += 1
            counters["published"] += _publish(
                session, election, form, reading.party_votes, source_id=source.source_id
            )
        else:
            form.ocr_status = "unreadable"
            counters["unreadable"] += 1

    session.flush()
    return counters


def _publish(
    session: Session,
    election: Election,
    form: PollingUnitForm,
    party_votes: dict[str, int],
    *,
    source_id: int,
) -> int:
    """Write a corroborated reading into the tallies.

    Upserts on the same key the IReV walk uses, so a sheet read here and a
    figure INEC later transcribes converge on one row per party rather than
    doubling the polling unit.
    """
    lga_id = form.lga_id
    if lga_id is None:
        lga_id = session.scalar(
            select(Ward.lga_id)
            .join(PollingUnit, PollingUnit.ward_id == Ward.ward_id)
            .where(PollingUnit.pu_id == form.pu_id)
        )

    written = 0
    for code, votes in party_votes.items():
        if not isinstance(votes, int) or votes < 0:
            continue
        party = resolve_party(session, code=code, cycle=election.cycle, autocreate=True)
        if party is None:
            continue
        stmt = pg_insert(ElectionResult).values(
            election_id=election.election_id,
            pu_id=form.pu_id,
            lga_id=lga_id,
            state_id=election.state_id,
            aggregation="pu",
            party_id=party.party_id,
            votes=votes,
            source_id=source_id,
        )
        session.execute(
            stmt.on_conflict_do_update(
                index_elements=["election_id", "pu_id", "party_id", "aggregation"],
                index_where=ElectionResult.pu_id.isnot(None),
                set_={"votes": stmt.excluded.votes, "source_id": stmt.excluded.source_id},
            )
        )
        written += 1
    return written


def ocr_progress(session: Session, election_id: int) -> dict[str, int]:
    """Counts by reading state, for the admin view and the live panel."""
    rows = session.execute(
        select(PollingUnitForm.ocr_status, func.count(PollingUnitForm.form_id))
        .where(PollingUnitForm.election_id == election_id)
        .group_by(PollingUnitForm.ocr_status)
    ).all()
    out = {"pending": 0, "read": 0, "unreadable": 0}
    for status, n in rows:
        out["pending" if status is None else status] = int(n or 0)
    return out
