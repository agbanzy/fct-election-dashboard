"""Make polling-unit results idempotent.

The PU walk inserted a fresh election_results row on every visit. While the
walk was accidentally pinned to the same wards this was invisible; once it
started revisiting wards on a refresh cycle, each pass re-added the same
polling unit's votes and the state total climbed with no new data behind it —
Osun's tally doubled from 404 to 808 across the same two polling units.

A unique key on (election_id, pu_id, party_id, aggregation) lets the walk
upsert instead, so a revisit restates a polling unit rather than adding to it.
Partial on pu_id IS NOT NULL: rolled-up rows legitimately carry a null pu_id,
and in Postgres nulls are distinct anyway, so scoping the index to real
polling-unit rows says what is actually meant.

Existing duplicates are collapsed to the highest-numbered row per key, which
is the most recent write.

Revision ID: 0012_pu_result_unique
Revises: 0011_election_ward_sync
"""

from __future__ import annotations

from alembic import op

revision = "0012_pu_result_unique"
down_revision = "0011_election_ward_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Collapse duplicates before the index can reject them.
    op.execute(
        """
        DELETE FROM election_results a
        USING election_results b
        WHERE a.pu_id IS NOT NULL
          AND b.pu_id IS NOT NULL
          AND a.election_id = b.election_id
          AND a.pu_id       = b.pu_id
          AND a.party_id    = b.party_id
          AND a.aggregation = b.aggregation
          AND a.result_id   < b.result_id
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_result_election_pu_party
            ON election_results (election_id, pu_id, party_id, aggregation)
            WHERE pu_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_result_election_pu_party")
