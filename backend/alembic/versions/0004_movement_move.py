"""traslado: acción 'move' y columnas de origen en movements (issue #8)

Revision ID: 0004_movement_move
Revises: 0003_layout_integrity
Create Date: 2026-09-25

`.github/copilot-instructions.md` ya listaba el traslado como uno de los tres movimientos
("ingreso, traslado, retiro"), pero `MovementAction` solo tenía freeze y thaw. Mover un
tubo obligaba a descongelar y volver a congelar, y `_freeze` crea una muestra NUEVA: el
historial quedaba partido en dos `sample.id` y el encargado perdía el rastro.

`from_box_id` / `from_position` son nullable porque freeze y thaw no las usan, pero para
un traslado son obligatorias, y eso lo garantiza la base con `ck_movements_move_origin`.
Sin ese CHECK, un bug en la aplicación dejaría un traslado sin origen y la UI no podría
mostrar de dónde vino la muestra — que es justamente lo que el traslado viene a registrar.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_movement_move"
down_revision: Union[str, None] = "0003_layout_integrity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("movements", sa.Column("from_box_id", sa.Integer(), nullable=True))
    op.add_column("movements", sa.Column("from_position", sa.String(length=10), nullable=True))
    op.create_foreign_key(
        "fk_movements_from_box_id", "movements", "boxes", ["from_box_id"], ["id"]
    )

    # Los valores actuales (freeze, thaw) son un subconjunto de los nuevos, así que
    # recrear el CHECK no puede fallar sobre datos existentes.
    op.drop_constraint("ck_movements_action", "movements", type_="check")
    op.create_check_constraint(
        "ck_movements_action", "movements", "action in ('freeze', 'thaw', 'move')"
    )

    op.create_check_constraint(
        "ck_movements_move_origin",
        "movements",
        "action <> 'move' OR (from_box_id IS NOT NULL AND from_position IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_movements_move_origin", "movements", type_="check")

    # Un downgrade con traslados ya registrados no puede recrear el CHECK de dos valores.
    # Se convierten en descongelamientos: la muestra queda donde estaba y el evento no se
    # pierde, que es lo que manda la regla de "nunca se borra nada".
    op.execute("UPDATE movements SET action = 'thaw' WHERE action = 'move'")
    op.drop_constraint("ck_movements_action", "movements", type_="check")
    op.create_check_constraint("ck_movements_action", "movements", "action in ('freeze', 'thaw')")

    op.drop_constraint("fk_movements_from_box_id", "movements", type_="foreignkey")
    op.drop_column("movements", "from_position")
    op.drop_column("movements", "from_box_id")
