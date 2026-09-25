"""Siembra la distribución física (secciones y racks) desde `layout.yaml`.

Uso: `python -m app.seed.seed` (requiere el esquema ya migrado con Alembic).
Es idempotente: se puede correr de nuevo sin duplicar secciones ni racks.
"""

from __future__ import annotations

import pathlib

import yaml
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Rack, Section
from app.schemas.rack import VALID_RACK_LETTERS
from app.schemas.section import VALID_SECTION_CODES

LAYOUT_PATH = pathlib.Path(__file__).parent / "layout.yaml"

VALID_SLOTS = {"center", "right"}


class LayoutError(RuntimeError):
    """El layout no es válido. Se corta antes de tocar la base.

    El seed corre en cada arranque del backend (`docker-compose.yml` lo encadena con
    `&&` bajo `restart: unless-stopped`), así que sin esta validación un typo de un
    carácter en `layout.yaml` dejaría de ser "una sección mal etiquetada" y pasaría a ser
    un loop de reinicio con un CheckViolation crudo en los logs.
    """


def _fail(path: pathlib.Path, index: int, entry: object, problem: str, fix: str) -> LayoutError:
    return LayoutError(
        f"{path}: la entrada #{index + 1} de `racks` {problem}.\n"
        f"  Entrada: {entry!r}\n"
        f"  Arreglo: {fix}"
    )


def load_layout(path: pathlib.Path = LAYOUT_PATH) -> list[dict]:
    """Lee el layout y valida cada entrada contra los mismos conjuntos que usa la API.

    El camino ORM no pasa por Pydantic, así que la validación tiene que estar acá.
    """
    with path.open(encoding="utf-8") as layout_file:
        data = yaml.safe_load(layout_file)

    racks = (data or {}).get("racks")
    if not isinstance(racks, list) or not racks:
        raise LayoutError(f"{path}: falta la lista `racks` o está vacía.")

    normalized: list[dict] = []
    for index, entry in enumerate(racks):
        if not isinstance(entry, dict):
            raise _fail(path, index, entry, "no es un mapa", "usá `letter`, `section`, `slot` y `capacity`")

        letter = str(entry.get("letter", "")).strip().upper()
        if letter not in VALID_RACK_LETTERS:
            raise _fail(
                path, index, entry,
                f"tiene `letter: {entry.get('letter')!r}`, que no es una letra de rack válida",
                f"usá una de {sorted(VALID_RACK_LETTERS)}",
            )

        section = str(entry.get("section", "")).strip().upper()
        if section not in VALID_SECTION_CODES:
            raise _fail(
                path, index, entry,
                f"tiene `section: {entry.get('section')!r}`, que no es una sección válida",
                f"usá una de {sorted(VALID_SECTION_CODES)}",
            )

        slot = str(entry.get("slot", "")).strip().lower()
        if slot not in VALID_SLOTS:
            raise _fail(
                path, index, entry,
                f"tiene `slot: {entry.get('slot')!r}`",
                f"usá una de {sorted(VALID_SLOTS)} (el refri real solo tiene centro y derecha)",
            )

        capacity = entry.get("capacity")
        if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity <= 0:
            raise _fail(
                path, index, entry,
                f"tiene `capacity: {capacity!r}`, que no es un entero positivo",
                "usá la cantidad de subcajas que caben en el rack (por defecto 20)",
            )

        normalized.append({"letter": letter, "section": section, "slot": slot, "capacity": capacity})

    letters = [entry["letter"] for entry in normalized]
    duplicates = sorted({letter for letter in letters if letters.count(letter) > 1})
    if duplicates:
        raise LayoutError(f"{path}: la letra de rack {', '.join(duplicates)} aparece más de una vez.")

    return normalized


def seed_layout(session: Session, path: pathlib.Path = LAYOUT_PATH) -> None:
    entries = load_layout(path)

    # Intercambiar los slots de dos racks de la misma sección deja, a mitad del UPDATE,
    # dos racks en el mismo (section_id, slot). El constraint es DEFERRABLE INITIALLY
    # IMMEDIATE (migración 0003): acá lo diferimos hasta el COMMIT, solo para esta
    # transacción. Fuera del seed sigue validando en el instante.
    session.execute(text("SET CONSTRAINTS uq_racks_section_slot DEFERRED"))

    sections_by_code: dict[str, Section] = {}

    for entry in entries:
        section = sections_by_code.get(entry["section"])
        if section is None:
            section = session.query(Section).filter_by(code=entry["section"]).one_or_none()
            if section is None:
                section = Section(code=entry["section"])
                session.add(section)
                session.flush()
            sections_by_code[entry["section"]] = section

        rack = session.query(Rack).filter_by(letter=entry["letter"]).one_or_none()
        if rack is None:
            rack = Rack(letter=entry["letter"])
            session.add(rack)

        rack.section_id = section.id
        rack.slot = entry["slot"]
        rack.capacity = entry["capacity"]

    session.commit()


def main() -> None:
    with SessionLocal() as session:
        seed_layout(session)
    print("Siembra de secciones y racks aplicada.")


if __name__ == "__main__":
    main()
