"""racks y cajas se mueven y se dan de baja; cada evento guarda su sección (parte 3)

Revision ID: 0007_racks_boxes_lifecycle
Revises: 0006_sample_owners
Create Date: 2026-09-25

- `movements.section_code` / `from_section_code`: la sección donde ocurrió el evento. La
  ubicación de un evento se armaba con la sección ACTUAL del rack; ahora que un rack puede
  cambiar de estante, eso reescribiría la historia (un retiro de hace un año aparecería
  hecho en el estante nuevo). Se completan con la sección actual, que hasta hoy nunca
  cambió.
- `racks.active` / `boxes.active`: dar de baja sin borrar, para conservar el historial.
  Un rack dado de baja libera su lugar en el estante (`slot` queda NULL).
- La letra del rack deja de estar limitada a A–H: un rack nuevo necesita una letra libre.
- Acción `return` (reingreso): una muestra retirada vuelve al freezer, por ejemplo si se
  sacó por error o si un tubo usado en parte vuelve.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_racks_boxes_lifecycle"
down_revision: Union[str, None] = "0006_sample_owners"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SECTION_OF_BOX = (
    "SELECT s.code FROM boxes b JOIN racks r ON r.id = b.rack_id "
    "JOIN sections s ON s.id = r.section_id WHERE b.id = {column}"
)


def upgrade() -> None:
    op.add_column("movements", sa.Column("section_code", sa.String(length=4), nullable=True))
    op.add_column("movements", sa.Column("from_section_code", sa.String(length=4), nullable=True))
    op.execute(f"UPDATE movements SET section_code = ({_SECTION_OF_BOX.format(column='movements.box_id')})")
    op.execute(
        f"UPDATE movements SET from_section_code = ({_SECTION_OF_BOX.format(column='movements.from_box_id')}) "
        "WHERE from_box_id IS NOT NULL"
    )

    op.add_column("racks", sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("boxes", sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))

    op.alter_column("racks", "slot", existing_type=sa.String(length=10), nullable=True)
    op.drop_constraint("ck_racks_slot", "racks", type_="check")
    op.create_check_constraint(
        "ck_racks_slot",
        "racks",
        "(active AND slot IN ('center', 'right')) OR (NOT active AND slot IS NULL)",
    )
    op.drop_constraint("ck_racks_letter", "racks", type_="check")
    op.create_check_constraint("ck_racks_letter", "racks", "letter ~ '^[A-Z]$'")

    op.drop_constraint("ck_movements_action", "movements", type_="check")
    op.create_check_constraint(
        "ck_movements_action", "movements", "action in ('freeze', 'thaw', 'move', 'return')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_movements_action", "movements", type_="check")
    op.create_check_constraint("ck_movements_action", "movements", "action in ('freeze', 'thaw', 'move')")
    op.drop_constraint("ck_racks_letter", "racks", type_="check")
    op.create_check_constraint("ck_racks_letter", "racks", "letter in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')")
    op.drop_constraint("ck_racks_slot", "racks", type_="check")
    op.create_check_constraint("ck_racks_slot", "racks", "slot in ('center', 'right')")
    op.alter_column("racks", "slot", existing_type=sa.String(length=10), nullable=False)
    op.drop_column("boxes", "active")
    op.drop_column("racks", "active")
    op.drop_column("movements", "from_section_code")
    op.drop_column("movements", "section_code")
