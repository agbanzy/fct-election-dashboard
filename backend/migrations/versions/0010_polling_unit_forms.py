"""Track published EC8A result sheets per polling unit.

INEC's 2026 IReV publishes result sheets as scanned images and serves no
machine-readable votes (`votes` is null on the /pus payload, and the per-LGA
vote fields stay at zero). Form presence is therefore the only per-polling-unit
signal available on election night, and aggregating it to LGA is what lets the
state map show a real breakdown rather than a uniform "no tally" wash.

Storing the URL also gives the transcription workflow its input list.

Revision ID: 0010_polling_unit_forms
Revises: 0009_ward_irev_oid
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_polling_unit_forms"
down_revision = "0009_ward_irev_oid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "polling_unit_forms",
        sa.Column("form_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("election_id", sa.BigInteger(), nullable=False),
        sa.Column("pu_id", sa.BigInteger(), nullable=False),
        sa.Column("lga_id", sa.BigInteger(), nullable=True),
        sa.Column("document_url", sa.Text(), nullable=True),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["election_id"], ["elections.election_id"]),
        sa.ForeignKeyConstraint(["pu_id"], ["polling_units.pu_id"]),
        sa.ForeignKeyConstraint(["lga_id"], ["lgas.lga_id"]),
        sa.PrimaryKeyConstraint("form_id"),
        sa.UniqueConstraint("election_id", "pu_id", name="uq_pu_form_election_pu"),
    )
    op.create_index(
        "ix_pu_form_election_lga", "polling_unit_forms", ["election_id", "lga_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_pu_form_election_lga", table_name="polling_unit_forms")
    op.drop_table("polling_unit_forms")
