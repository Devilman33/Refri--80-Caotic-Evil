"""Siembra la distribución física (secciones y racks) desde `layout.yaml`.

Uso: `python -m app.seed.seed` (requiere el esquema ya migrado con Alembic).
Es idempotente: se puede correr de nuevo sin duplicar secciones ni racks.
"""

from __future__ import annotations

import pathlib

import yaml
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Rack, Section

LAYOUT_PATH = pathlib.Path(__file__).parent / "layout.yaml"


def load_layout(path: pathlib.Path = LAYOUT_PATH) -> list[dict]:
    with path.open(encoding="utf-8") as layout_file:
        data = yaml.safe_load(layout_file)
    return data["racks"]


def seed_layout(session: Session, path: pathlib.Path = LAYOUT_PATH) -> None:
    sections_by_code: dict[str, Section] = {}

    for entry in load_layout(path):
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
