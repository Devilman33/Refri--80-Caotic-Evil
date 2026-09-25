"""CHECK de sección/rack, unicidad de slot diferible y default de capacidad alineado (issue #8)

Revision ID: 0003_layout_integrity
Revises: 0002_sample_source_row
Create Date: 2026-09-25

La API ya rechazaba códigos de sección y letras de rack inválidos: `SectionCreate` y
`RackCreate` los validan con `field_validator`. El hueco es el camino **ORM**, que existe y
es el que carga los datos: `seed_layout` escribe `Section(code=entry["section"])` directo
desde `layout.yaml`, sin pasar por Pydantic. Estos CHECK cierran ese camino.

`uq_racks_section_slot` pasa a DEFERRABLE INITIALLY IMMEDIATE. No relaja nada para la API
(un duplicado por `POST /racks` sigue fallando en el instante); solo habilita que el seed
difiera la validación hasta el COMMIT dentro de su propia transacción, que es lo que hace
falta para permutar los slots de dos racks de la misma sección. La alternativa de "dos
pasadas" no es implementable: `slot` es NOT NULL con un CHECK de dos valores, así que no
hay un valor centinela legal donde estacionar un slot a mitad del swap.

`racks.capacity` tenía `server_default="30"` mientras el modelo, el schema y `layout.yaml`
usan 20. Se alinea para que el valor viva en un solo lugar.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_layout_integrity"
down_revision: Union[str, None] = "0002_sample_source_row"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SECTION_CODES = "('I', 'II', 'III', 'IV')"
_RACK_LETTERS = "('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')"


def upgrade() -> None:
    op.create_check_constraint("ck_sections_code", "sections", f"code in {_SECTION_CODES}")
    op.create_check_constraint("ck_racks_letter", "racks", f"letter in {_RACK_LETTERS}")

    # Postgres no tiene ALTER CONSTRAINT para volver diferible un UNIQUE: hay que recrearlo.
    op.drop_constraint("uq_racks_section_slot", "racks", type_="unique")
    op.execute(
        "ALTER TABLE racks ADD CONSTRAINT uq_racks_section_slot "
        "UNIQUE (section_id, slot) DEFERRABLE INITIALLY IMMEDIATE"
    )

    op.alter_column("racks", "capacity", server_default="20")


def downgrade() -> None:
    op.alter_column("racks", "capacity", server_default="30")

    op.drop_constraint("uq_racks_section_slot", "racks", type_="unique")
    op.create_unique_constraint("uq_racks_section_slot", "racks", ["section_id", "slot"])

    op.drop_constraint("ck_racks_letter", "racks", type_="check")
    op.drop_constraint("ck_sections_code", "sections", type_="check")
