"""una muestra puede tener varios encargados (parte 2)

Revision ID: 0006_sample_owners
Revises: 0005_import_runs
Create Date: 2026-09-25

`samples.owner_id` admitía un solo encargado, pero en el laboratorio una muestra puede
tener varios: el Excel los escribe juntos (`AS/MN`, `BPG-JCI`, `JCI BPG`). El importador
tomaba el valor entero como si fuera UNA persona, así que existían "usuarios" como
`AS/MN`.

Esta migración:

1. Crea `sample_owners` (muestra ↔ persona) y copia ahí el encargado de cada muestra.
2. Parte los usuarios combinados en sus personas (creando las que falten) y asigna a la
   muestra todas ellas.
3. Borra los usuarios combinados que ya no referencia nada (los que figuran como operador
   de un movimiento o propietario de una caja se conservan: son historia).
4. Elimina `samples.owner_id`.
"""
from __future__ import annotations

import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_sample_owners"
down_revision: Union[str, None] = "0005_import_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Copia de `_OWNER_SEPARATORS_RE` (app/importer/cleaning.py). Una migración no importa
# código de la app: si ese código cambia, la migración tiene que seguir haciendo lo mismo.
_SEPARATORS_RE = re.compile(r"\s+[yY]\s+|[\s/,;+&-]+")


def _split(initials: str) -> list[str]:
    parts: list[str] = []
    for part in _SEPARATORS_RE.split(initials.strip()):
        value = part.strip().upper()
        if value and value not in parts:
            parts.append(value)
    return parts


def upgrade() -> None:
    op.create_table(
        "sample_owners",
        sa.Column("sample_id", sa.Integer(), sa.ForeignKey("samples.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
    )
    op.create_index("ix_sample_owners_user_id", "sample_owners", ["user_id"])

    bind = op.get_bind()
    users = {row.initials: row.id for row in bind.execute(sa.text("SELECT id, initials FROM users"))}

    # Usuario combinado → las personas que lo componen.
    expansion: dict[int, list[int]] = {}
    for initials, user_id in list(users.items()):
        parts = _split(initials)
        if len(parts) <= 1:
            continue
        ids = []
        for part in parts:
            if part not in users:
                users[part] = bind.execute(
                    sa.text("INSERT INTO users (initials, active) VALUES (:initials, true) RETURNING id"),
                    {"initials": part[:10]},
                ).scalar_one()
            ids.append(users[part])
        expansion[user_id] = ids

    rows = bind.execute(sa.text("SELECT id, owner_id FROM samples")).all()
    links = {
        (sample_id, owner) for sample_id, owner_id in rows for owner in expansion.get(owner_id, [owner_id])
    }
    if links:
        bind.execute(
            sa.text("INSERT INTO sample_owners (sample_id, user_id) VALUES (:sample_id, :user_id)"),
            [{"sample_id": sample_id, "user_id": user_id} for sample_id, user_id in sorted(links)],
        )

    op.drop_column("samples", "owner_id")

    for combined_id in expansion:
        bind.execute(
            sa.text(
                "DELETE FROM users WHERE id = :id "
                "AND NOT EXISTS (SELECT 1 FROM movements WHERE operator_id = :id) "
                "AND NOT EXISTS (SELECT 1 FROM boxes WHERE owner_id = :id) "
                "AND NOT EXISTS (SELECT 1 FROM sample_owners WHERE user_id = :id)"
            ),
            {"id": combined_id},
        )


def downgrade() -> None:
    # Con varios encargados no hay vuelta exacta: se conserva el de menor id.
    op.add_column("samples", sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    op.execute(
        "UPDATE samples SET owner_id = (SELECT MIN(user_id) FROM sample_owners WHERE sample_id = samples.id)"
    )
    op.alter_column("samples", "owner_id", nullable=False)
    op.drop_index("ix_sample_owners_user_id", table_name="sample_owners")
    op.drop_table("sample_owners")
