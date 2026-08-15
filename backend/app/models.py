"""SQLAlchemy ORM models — unified schema across all cycles + election types.

See `/Users/godwinagbane/.claude/plans/logical-giggling-puzzle.md` section 3 for the design.
Alembic migration `0001_initial.py` is the canonical DDL source.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import DateTime

from app.db import Base


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, default="viewer", nullable=False)  # admin|viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ApiClient(Base):
    """A registered API consumer. The API is free, but access is by application:
    apply (pending) → admin approves → a key is issued. Dashboard traffic is
    same-origin and never needs a key."""

    __tablename__ = "api_clients"

    client_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    use_case: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, default="pending", nullable=False
    )  # pending|approved|rejected|revoked
    api_key: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    application_ref: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


class State(Base):
    __tablename__ = "states"

    state_id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(CHAR(2), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    zone: Mapped[str] = mapped_column(Text, nullable=False)  # NC|NE|NW|SE|SS|SW

    lgas: Mapped[list[Lga]] = relationship(back_populates="state", lazy="selectin")


class Lga(Base):
    __tablename__ = "lgas"

    lga_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    state_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("states.state_id"), nullable=False
    )
    irev_lga_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    irev_lga_oid: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    lga_kind: Mapped[str] = mapped_column(Text, default="lga", nullable=False)  # 'lga'|'area_council'

    __table_args__ = (UniqueConstraint("state_id", "name", name="uq_lga_state_name"),)

    state: Mapped[State] = relationship(back_populates="lgas")
    wards: Mapped[list[Ward]] = relationship(back_populates="lga", lazy="selectin")


class Ward(Base):
    __tablename__ = "wards"

    ward_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lga_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lgas.lga_id"), nullable=False)
    irev_ward_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # IReV's Mongo `_id`. The /pus endpoint keys on this, not irev_ward_id.
    irev_ward_oid: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)

    lga: Mapped[Lga] = relationship(back_populates="wards")
    polling_units: Mapped[list[PollingUnit]] = relationship(back_populates="ward", lazy="selectin")


class PollingUnit(Base):
    __tablename__ = "polling_units"

    pu_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ward_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("wards.ward_id"), nullable=False)
    irev_pu_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    pu_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    registered_voters: Mapped[int | None] = mapped_column(Integer, nullable=True)

    ward: Mapped[Ward] = relationship(back_populates="polling_units")


class ElectionWardSync(Base):
    """When each ward was last walked for polling-unit data, per election.

    Ward coverage used to be inferred from whether the ward had produced any
    vote rows. On an election where IReV publishes result sheets but no
    machine-readable votes that test is never satisfied, so the walk re-fetched
    the same handful of wards every tick and never reached the rest of the
    state. Recording the walk itself is what makes progress monotonic, and
    ordering by `walked_at` gives refresh for free — the least recently seen
    ward is always next.
    """

    __tablename__ = "election_ward_sync"

    election_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elections.election_id"), primary_key=True
    )
    ward_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("wards.ward_id"), primary_key=True
    )
    walked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    pu_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    form_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (Index("ix_ward_sync_election_walked", "election_id", "walked_at"),)


class PollingUnitForm(Base):
    """One published EC8A result sheet, per (election, polling unit).

    INEC's 2026 IReV publishes result sheets as scanned images and serves no
    machine-readable votes, so form presence is the only per-polling-unit
    signal available on election night. Aggregated up to LGA it is what drives
    the reporting-progress view; the URL is the input to transcription.
    """

    __tablename__ = "polling_unit_forms"

    form_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    election_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elections.election_id"), nullable=False
    )
    pu_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("polling_units.pu_id"), nullable=False
    )
    lga_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("lgas.lga_id"), nullable=True
    )
    document_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("election_id", "pu_id", name="uq_pu_form_election_pu"),
        Index("ix_pu_form_election_lga", "election_id", "lga_id"),
    )


class Party(Base):
    __tablename__ = "parties"

    party_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    color_hex: Mapped[str | None] = mapped_column(CHAR(7), nullable=True)
    active_from: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    active_to: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    __table_args__ = (UniqueConstraint("code", "active_from", name="uq_party_code_from"),)


class Election(Base):
    __tablename__ = "elections"

    election_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    cycle: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    election_type: Mapped[str] = mapped_column(Text, nullable=False)
    state_id: Mapped[int | None] = mapped_column(
        SmallInteger, ForeignKey("states.state_id"), nullable=True
    )
    irev_election_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    election_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(Text, default="historical", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Sync state — driven by app.scraper.sync. The daemon picks targets via
    # sync_complete=False ORDER BY sync_priority, results_synced_at NULLS FIRST.
    headers_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    structure_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    results_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expected_pus: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_pus: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sync_complete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 1=live, 2=preflight, 3=recent, 5=historical (default), 9=ignore
    sync_priority: Mapped[int] = mapped_column(SmallInteger, default=5, nullable=False)

    __table_args__ = (
        UniqueConstraint("cycle", "election_type", "state_id", name="uq_election_unique"),
        Index("ix_elections_cycle_type", "cycle", "election_type"),
        Index("ix_elections_irev_id", "irev_election_id"),
        Index("ix_elections_sync_queue", "sync_complete", "sync_priority"),
    )


class IrevRawCache(Base):
    """Cache of every successful IReV API response.

    Lets us re-process historical data without re-fetching, and gives a
    durable audit trail of what INEC's API returned and when.
    """

    __tablename__ = "irev_raw_cache"

    cache_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    url_hash: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    body: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Candidate(Base):
    __tablename__ = "candidates"

    candidate_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    election_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elections.election_id"), nullable=False
    )
    party_id: Mapped[int] = mapped_column(Integer, ForeignKey("parties.party_id"), nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    is_incumbent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Scope: NULL for federal/gov races (one per state); set for LG / Councillor
    # races where each LGA / ward fields its own candidates.
    lga_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("lgas.lga_id"), nullable=True
    )
    ward_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("wards.ward_id"), nullable=True
    )
    # Composite unique handled at the DB level via partial index — see
    # migration 0004. Skip declarative __table_args__ unique here so it
    # doesn't fight the index.


class IngestionSource(Base):
    __tablename__ = "ingestion_sources"

    source_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    license: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ElectionResult(Base):
    __tablename__ = "election_results"

    result_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    election_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elections.election_id"), nullable=False
    )
    pu_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("polling_units.pu_id"), nullable=True
    )
    lga_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("lgas.lga_id"), nullable=True
    )
    state_id: Mapped[int | None] = mapped_column(
        SmallInteger, ForeignKey("states.state_id"), nullable=True
    )
    aggregation: Mapped[str] = mapped_column(Text, nullable=False)  # pu|ward|lga|state|national
    party_id: Mapped[int] = mapped_column(Integer, ForeignKey("parties.party_id"), nullable=False)
    votes: Mapped[int] = mapped_column(Integer, nullable=False)
    accredited_voters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    registered_voters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ingestion_sources.source_id"), nullable=False
    )
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    raw_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        Index("ix_results_election_party", "election_id", "party_id"),
        Index("ix_results_state", "state_id"),
        Index("ix_results_aggregation", "aggregation"),
        Index("ix_results_lga", "lga_id"),
        Index("ix_results_party", "party_id"),
    )


class ScrapeLog(Base):
    __tablename__ = "scrape_log"

    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    phase: Mapped[str | None] = mapped_column(Text, nullable=True)
    state_id: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    election_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ElectionCalendar(Base):
    __tablename__ = "election_calendar"

    calendar_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    election_date: Mapped[date] = mapped_column(Date, nullable=False)
    election_type: Mapped[str] = mapped_column(Text, nullable=False)
    state_id: Mapped[int | None] = mapped_column(
        SmallInteger, ForeignKey("states.state_id"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        Text, default="scheduled", nullable=False
    )  # scheduled|live|completed|cancelled
    inec_published_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_calendar_date_status", "election_date", "status"),
    )
