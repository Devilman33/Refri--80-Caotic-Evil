"""Initial schema.

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-09-24 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


box_type = postgresql.ENUM("carton_81", "plastic_100", name="box_type", create_type=False)
sample_status = postgresql.ENUM("active", "withdrawn", name="sample_status", create_type=False)
movement_action = postgresql.ENUM("freeze", "thaw", "transfer", name="movement_action", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    box_type.create(bind, checkfirst=True)
    sample_status.create(bind, checkfirst=True)
    movement_action.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("initials", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_users_initials", "users", ["initials"], unique=True)

    op.create_table(
        "sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=4), nullable=False),
        sa.UniqueConstraint("name", name="uq_sections_name"),
    )

    op.create_table(
        "racks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("section_id", sa.Integer(), nullable=False),
        sa.Column("letter", sa.String(length=1), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("section_id", "letter", name="uq_racks_section_letter"),
    )

    op.create_table(
        "boxes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rack_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("type", box_type, nullable=False),
        sa.Column("historical_label", sa.String(length=255), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rack_id"], ["racks.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("rack_id", "number", name="uq_boxes_rack_number"),
    )

    op.create_table(
        "samples",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("environ_id", sa.String(length=255), nullable=False),
        sa.Column("origin_id", sa.String(length=255), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column("type_other", sa.String(length=255), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("passage", sa.Integer(), nullable=True),
        sa.Column("is_core", sa.Boolean(), nullable=False),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("status", sample_status, nullable=False, server_default="active"),
        sa.Column("box_id", sa.Integer(), nullable=True),
        sa.Column("position", sa.String(length=8), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status != 'active' OR (box_id IS NOT NULL AND position IS NOT NULL)",
            name="ck_samples_active_requires_location",
        ),
        sa.CheckConstraint(
            "(type = 'Otros' AND type_other IS NOT NULL) OR (type != 'Otros' AND type_other IS NULL)",
            name="ck_samples_type_other_consistency",
        ),
        sa.ForeignKeyConstraint(["box_id"], ["boxes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_samples_environ_id", "samples", ["environ_id"], unique=False)
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
        sa.Column("sample_id", sa.Integer(), nullable=False),
        sa.Column("action", movement_action, nullable=False),
        sa.Column("date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("source_box_id", sa.Integer(), nullable=True),
        sa.Column("source_position", sa.String(length=8), nullable=True),
        sa.Column("destination_box_id", sa.Integer(), nullable=True),
        sa.Column("destination_position", sa.String(length=8), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["destination_box_id"], ["boxes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["operator_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["sample_id"], ["samples.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_box_id"], ["boxes.id"], ondelete="RESTRICT"),
    )


def downgrade() -> None:
    op.drop_table("movements")
    op.drop_index("uq_samples_active_position", table_name="samples")
    op.drop_index("ix_samples_environ_id", table_name="samples")
    op.drop_table("samples")
    op.drop_table("boxes")
    op.drop_table("racks")
    op.drop_table("sections")
    op.drop_index("ix_users_initials", table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    movement_action.drop(bind, checkfirst=True)
    sample_status.drop(bind, checkfirst=True)
    box_type.drop(bind, checkfirst=True)
