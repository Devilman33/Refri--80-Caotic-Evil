"""esquema inicial: users, sections, racks, boxes, samples, movements

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-24

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("initials", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("initials", name="uq_users_initials"),
    )

    op.create_table(
        "sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=4), nullable=False),
        sa.UniqueConstraint("code", name="uq_sections_code"),
    )

    op.create_table(
        "racks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("section_id", sa.Integer(), sa.ForeignKey("sections.id"), nullable=False),
        sa.Column("letter", sa.String(length=1), nullable=False),
        sa.Column("slot", sa.String(length=10), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="30"),
        sa.UniqueConstraint("letter", name="uq_racks_letter"),
        sa.UniqueConstraint("section_id", "slot", name="uq_racks_section_slot"),
        sa.CheckConstraint("slot in ('center', 'right')", name="ck_racks_slot"),
    )

    op.create_table(
        "boxes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rack_id", sa.Integer(), sa.ForeignKey("racks.id"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("box_type", sa.String(length=20), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("rack_id", "number", name="uq_boxes_rack_number"),
        sa.CheckConstraint("box_type in ('carton_81', 'plastic_100')", name="ck_boxes_box_type"),
    )

    op.create_table(
        "samples",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("environ_id", sa.String(length=60), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("type_other", sa.String(length=120), nullable=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("passage", sa.Integer(), nullable=True),
        sa.Column("is_core", sa.Boolean(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("box_id", sa.Integer(), sa.ForeignKey("boxes.id"), nullable=False),
        sa.Column("position", sa.String(length=10), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "type in ('vial_celulas','rna','rna_later','proteinas',"
            "'medio_condicionado','reactivo','plasma','otros')",
            name="ck_samples_type",
        ),
        sa.CheckConstraint("status in ('active', 'withdrawn')", name="ck_samples_status"),
    )
    op.create_index("ix_samples_environ_id", "samples", ["environ_id"])
    # Regla no negociable (.github/copilot-instructions.md): una sola muestra activa
    # por posición dentro de una caja. Las retiradas no cuentan para esta restricción.
    op.create_index(
        "uq_samples_active_position",
        "samples",
        ["box_id", "position"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )

    op.create_table(
        "movements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sample_id", sa.Integer(), sa.ForeignKey("samples.id"), nullable=False),
        sa.Column("action", sa.String(length=10), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("box_id", sa.Integer(), sa.ForeignKey("boxes.id"), nullable=False),
        sa.Column("position", sa.String(length=10), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("action in ('freeze', 'thaw')", name="ck_movements_action"),
    )


def downgrade() -> None:
    op.drop_table("movements")
    op.drop_index("uq_samples_active_position", table_name="samples")
    op.drop_index("ix_samples_environ_id", table_name="samples")
    op.drop_table("samples")
    op.drop_table("boxes")
    op.drop_table("racks")
    op.drop_table("sections")
    op.drop_table("users")
