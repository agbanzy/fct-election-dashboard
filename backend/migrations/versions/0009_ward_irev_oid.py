"""Store the IReV ward object-id.

IReV's `/elections/{id}/pus` endpoint keys on the ward's Mongo `_id` (a hex
string), not the integer `ward_id` we already store:

    ?ward=24545                    -> 400 Unable to complete request
    ?ward=5f0f3e4d8f77bb3acad0a904 -> 200 + polling units

Without the object-id the PU walk could never resolve a ward, so no
polling-unit results were ever ingested.

Revision ID: 0009_ward_irev_oid
Revises: 0008_result_indexes
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_ward_irev_oid"
down_revision = "0008_result_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("wards", sa.Column("irev_ward_oid", sa.Text(), nullable=True))
    op.create_index("ix_wards_irev_oid", "wards", ["irev_ward_oid"])
    op.add_column("lgas", sa.Column("irev_lga_oid", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("lgas", "irev_lga_oid")
    op.drop_index("ix_wards_irev_oid", table_name="wards")
    op.drop_column("wards", "irev_ward_oid")
