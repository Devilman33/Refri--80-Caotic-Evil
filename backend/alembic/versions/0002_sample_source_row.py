"""agrega samples.source_row para idempotencia del importador (issue #2)

Revision ID: 0002_sample_source_row
Revises: 0001_initial_schema
Create Date: 2026-09-24

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_sample_source_row"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("samples", sa.Column("source_row", sa.Integer(), nullable=True))
    op.create_unique_constraint("uq_samples_source_row", "samples", ["source_row"])


def downgrade() -> None:
    op.drop_constraint("uq_samples_source_row", "samples", type_="unique")
    op.drop_column("samples", "source_row")
