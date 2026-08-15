"""Cache machine readings of EC8A sheets on the form row.

Reading a sheet costs a vision API call. Osun alone has ~3,000 published
sheets, and the ward walk revisits wards continuously to pick up new uploads —
without a cache every pass would re-read every sheet it saw, turning a
one-time cost into a recurring one for no new information.

The reading is stored beside the form so each sheet is read once. `ocr_url`
records which image the reading came from: INEC does replace sheets, and a
re-upload arrives with a new URL, which is the one case that justifies
spending another call. `unreadable` is terminal — a sheet whose figures and
words contradict each other will contradict itself next time too.

Revision ID: 0013_pu_form_ocr_cache
Revises: 0012_pu_result_unique
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0013_pu_form_ocr_cache"
down_revision = "0012_pu_result_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("polling_unit_forms", sa.Column("ocr_status", sa.Text(), nullable=True))
    op.add_column("polling_unit_forms", sa.Column("ocr_url", sa.Text(), nullable=True))
    op.add_column("polling_unit_forms", sa.Column("ocr_confidence", sa.Float(), nullable=True))
    op.add_column("polling_unit_forms", sa.Column("ocr_votes", JSONB(), nullable=True))
    op.add_column("polling_unit_forms", sa.Column("ocr_problems", JSONB(), nullable=True))
    op.add_column(
        "polling_unit_forms",
        sa.Column("ocr_read_at", sa.DateTime(timezone=True), nullable=True),
    )
    # The worker's queue query: unread sheets first, cheaply.
    op.create_index(
        "ix_pu_form_ocr_queue",
        "polling_unit_forms",
        ["election_id", "ocr_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_pu_form_ocr_queue", table_name="polling_unit_forms")
    for col in (
        "ocr_read_at",
        "ocr_problems",
        "ocr_votes",
        "ocr_confidence",
        "ocr_url",
        "ocr_status",
    ):
        op.drop_column("polling_unit_forms", col)
