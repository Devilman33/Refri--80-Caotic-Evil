"""anomalías del importador persistidas, con estado de triage (issue #8)

Revision ID: 0005_import_runs
Revises: 0004_movement_move
Create Date: 2026-09-25

El importador ya producía un reporte de anomalías, pero solo como CSV al lado del Excel:
el laboratorio tenía que pedirlo, abrirlo y no tenía dónde marcar lo que ya corrigió.
`docs/DATOS.md` dice que ese reporte existe "para que el laboratorio lo corrija", así que
sin estado de triage la mitad de la idea quedaba afuera.

El CSV se sigue escribiendo: es el contrato del CLI y está documentado en el README.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_import_runs"
down_revision: Union[str, None] = "0004_movement_move"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "import_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_file", sa.String(length=64), nullable=False),
        sa.Column("source_name", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("imported", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("withdrawn", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_already_imported", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_invalid", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("conflicts_resolved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("anomalies_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_import_runs_source_file", "import_runs", ["source_file"])

    op.create_table(
        "import_anomalies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("import_runs.id"), nullable=False),
        sa.Column("row", sa.Integer(), nullable=False),
        sa.Column("column", sa.String(length=60), nullable=False),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        sa.Column("reason", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("resolved_by", sa.String(length=10), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status in ('pending', 'resolved', 'accepted')", name="ck_import_anomalies_status"
        ),
    )
    # La vista agrupa por motivo por defecto ("1.412 filas con fecha imposible" es una
    # decisión que alguien puede tomar; "página 1 de 37" no es nada).
    op.create_index("ix_import_anomalies_run_reason", "import_anomalies", ["run_id", "reason"])


def downgrade() -> None:
    op.drop_index("ix_import_anomalies_run_reason", table_name="import_anomalies")
    op.drop_table("import_anomalies")
    op.drop_index("ix_import_runs_source_file", table_name="import_runs")
    op.drop_table("import_runs")
