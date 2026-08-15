"""Scraper phases. Each runs against one (state, election) at a time and is
re-entrant — running twice is a no-op if data hasn't changed.

Phase 1 — stats: total PUs, results uploaded
Phase 2 — lga/ward structure
Phase 3 — polling unit detail + result raw_json

Persists into the new unified schema (`elections`, `lgas`, `wards`,
`polling_units`, `election_results`).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Election, IngestionSource, Lga, PollingUnit, ScrapeLog, Ward
from app.scraper.irev_client import IrevClient

log = logging.getLogger(__name__)

LIVE_SOURCE_NAME = "irev_live"
BACKFILL_SOURCE_NAME = "irev_backfill"


def ensure_source(session: Session, name: str) -> IngestionSource:
    src = session.scalar(select(IngestionSource).where(IngestionSource.name == name))
    if src:
        return src
    src = IngestionSource(name=name, url="https://www.inecelectionresults.ng/", license="public")
    session.add(src)
    session.flush()
    return src


def ensure_election(
    session: Session,
    *,
    cycle: int,
    election_type: str,
    state_id: int | None,
    irev_election_id: str | None,
    election_date: date | None,
    status: str,
) -> Election:
    stmt = select(Election).where(
        Election.cycle == cycle,
        Election.election_type == election_type,
        Election.state_id == state_id,
    )
    existing = session.scalar(stmt)
    if existing:
        if irev_election_id and not existing.irev_election_id:
            existing.irev_election_id = irev_election_id
        # IReV is authoritative on the poll date — adopt corrections, don't just
        # fill blanks. The previous `not existing.election_date` guard meant a
        # date stored wrong once (e.g. Osun's UTC-truncated 2026-08-14) could
        # never be repaired, even after the parser was fixed.
        if election_date and existing.election_date != election_date:
            log.info(
                "election %s: date %s -> %s (IReV)",
                existing.election_id, existing.election_date, election_date,
            )
            existing.election_date = election_date
        # Manual/terminal curation wins over a derived lifecycle value.
        if existing.status not in ("cancelled", "postponed"):
            existing.status = status
        return existing
    elec = Election(
        cycle=cycle,
        election_type=election_type,
        state_id=state_id,
        irev_election_id=irev_election_id,
        election_date=election_date,
        status=status,
    )
    session.add(elec)
    session.flush()
    return elec


def upsert_lga(session: Session, state_id: int, *, irev_lga_id: int | None, name: str) -> Lga:
    if irev_lga_id is not None:
        existing = session.scalar(
            select(Lga).where(Lga.state_id == state_id, Lga.irev_lga_id == irev_lga_id)
        )
        if existing:
            return existing
    existing_by_name = session.scalar(
        select(Lga).where(Lga.state_id == state_id, Lga.name == name)
    )
    if existing_by_name:
        if irev_lga_id and not existing_by_name.irev_lga_id:
            existing_by_name.irev_lga_id = irev_lga_id
        return existing_by_name
    lga = Lga(state_id=state_id, irev_lga_id=irev_lga_id, name=name)
    session.add(lga)
    session.flush()
    return lga


def upsert_ward(session: Session, lga: Lga, *, irev_ward_id: int | None, name: str) -> Ward:
    if irev_ward_id is not None:
        existing = session.scalar(
            select(Ward).where(Ward.lga_id == lga.lga_id, Ward.irev_ward_id == irev_ward_id)
        )
        if existing:
            return existing
    existing_by_name = session.scalar(
        select(Ward).where(Ward.lga_id == lga.lga_id, Ward.name == name)
    )
    if existing_by_name:
        if irev_ward_id and not existing_by_name.irev_ward_id:
            existing_by_name.irev_ward_id = irev_ward_id
        return existing_by_name
    ward = Ward(lga_id=lga.lga_id, irev_ward_id=irev_ward_id, name=name)
    session.add(ward)
    session.flush()
    return ward


def upsert_polling_unit(
    session: Session,
    ward: Ward,
    *,
    irev_pu_id: int | None,
    pu_code: str | None,
    name: str | None,
) -> PollingUnit:
    if irev_pu_id is not None:
        existing = session.scalar(
            select(PollingUnit).where(
                PollingUnit.ward_id == ward.ward_id, PollingUnit.irev_pu_id == irev_pu_id
            )
        )
        if existing:
            return existing
    if pu_code:
        existing_by_code = session.scalar(
            select(PollingUnit).where(
                PollingUnit.ward_id == ward.ward_id, PollingUnit.pu_code == pu_code
            )
        )
        if existing_by_code:
            if irev_pu_id and not existing_by_code.irev_pu_id:
                existing_by_code.irev_pu_id = irev_pu_id
            return existing_by_code
    pu = PollingUnit(ward_id=ward.ward_id, irev_pu_id=irev_pu_id, pu_code=pu_code, name=name)
    session.add(pu)
    session.flush()
    return pu


def log_phase(
    session: Session,
    *,
    phase: str,
    state_id: int | None,
    election_id: int | None,
    status: str,
    message: str | None = None,
    duration_ms: int | None = None,
) -> None:
    session.add(
        ScrapeLog(
            phase=phase,
            state_id=state_id,
            election_id=election_id,
            status=status,
            message=message,
            duration_ms=duration_ms,
        )
    )


def scrape_lga_structure(
    client: IrevClient,
    session: Session,
    *,
    election: Election,
    state_id: int,
) -> int:
    """Phase 2 — fetch the LGA/ward structure for one election/state.

    Returns number of LGAs ingested.
    """
    if not election.irev_election_id:
        return 0
    resp = client.lga_state(election.irev_election_id, state_id) or {}
    data = resp.get("data") or [] if isinstance(resp, dict) else resp
    count = 0
    for lga_raw in data:
        if not isinstance(lga_raw, dict):
            continue

        # Each element is an election↔LGA join row, not the LGA itself: its
        # top-level `_id` is the join's id and there is no top-level `name`.
        # The LGA proper is nested under `lga`. Reading the old flat keys
        # matched nothing, so every LGA was skipped and the whole PU pipeline
        # downstream had no geography to walk.
        lga_obj = lga_raw.get("lga")
        if isinstance(lga_obj, dict):
            lga_name = lga_obj.get("name") or lga_obj.get("lga_name")
            irev_lga_id = lga_obj.get("lga_id")
            lga_oid = lga_obj.get("_id")
        else:
            # Tolerate a flat shape in case IReV varies by election type.
            lga_name = lga_raw.get("lga_name") or lga_raw.get("name")
            irev_lga_id = lga_raw.get("lga_id")
            lga_oid = None

        if not lga_name:
            log.warning(
                "structure: LGA row without a name (election=%s state=%s keys=%s)",
                election.election_id, state_id, sorted(lga_raw)[:8],
            )
            continue

        lga = upsert_lga(session, state_id, irev_lga_id=_as_int(irev_lga_id), name=lga_name)
        if lga_oid and not lga.irev_lga_oid:
            lga.irev_lga_oid = str(lga_oid)

        for ward_raw in lga_raw.get("wards") or []:
            if not isinstance(ward_raw, dict):
                continue
            ward_name = ward_raw.get("ward_name") or ward_raw.get("name")
            if not ward_name:
                continue
            ward = upsert_ward(
                session,
                lga,
                irev_ward_id=_as_int(ward_raw.get("ward_id")),
                name=ward_name,
            )
            # The object-id is what /pus keys on — without it the ward is
            # unreachable no matter how correct the integer id is.
            oid = ward_raw.get("_id")
            if oid and ward.irev_ward_oid != str(oid):
                ward.irev_ward_oid = str(oid)
        count += 1
    return count


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
