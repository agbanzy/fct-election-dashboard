"""Track ward walk coverage per election.

The polling-unit walk decided a ward was done if it already had vote rows.
IReV's 2026 governorship publishes result sheets and no machine-readable
votes, so that test never passed: every tick re-fetched the same first wards
and the walk never advanced past them. Osun sat at 444 of 3,763 polling units
across 3 of 30 LGAs while two thirds of the state had already published sheets.

Recording the walk makes progress monotonic; ordering by walked_at also gives
refresh, since the least recently seen ward is always next in line.

Revision ID: 0011_election_ward_sync
Revises: 0010_polling_unit_forms
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_election_ward_sync"
down_revision = "0010_polling_unit_forms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "election_ward_sync",
        sa.Column("election_id", sa.BigInteger(), nullable=False),
        sa.Column("ward_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "walked_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("pu_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("form_count", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["election_id"], ["elections.election_id"]),
        sa.ForeignKeyConstraint(["ward_id"], ["wards.ward_id"]),
        sa.PrimaryKeyConstraint("election_id", "ward_id"),
    )
    op.create_index(
        "ix_ward_sync_election_walked", "election_ward_sync", ["election_id", "walked_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_ward_sync_election_walked", table_name="election_ward_sync")
    op.drop_table("election_ward_sync")
