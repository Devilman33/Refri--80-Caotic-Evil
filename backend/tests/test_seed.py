import pytest
import yaml
from sqlalchemy.exc import IntegrityError

from app.models import Rack, Section
from app.seed.seed import LayoutError, seed_layout


def test_seed_layout_creates_sections_and_racks(db_session):
    seed_layout(db_session)

    assert db_session.query(Section).count() == 4
    assert db_session.query(Rack).count() == 8

    rack_a = db_session.query(Rack).filter_by(letter="A").one()
    assert rack_a.slot == "center"
    assert rack_a.section.code == "I"


def test_seed_layout_is_idempotent(db_session):
    seed_layout(db_session)
    seed_layout(db_session)

    assert db_session.query(Section).count() == 4
    assert db_session.query(Rack).count() == 8


def test_seed_layout_survives_slot_swap(db_session, tmp_path):
    """El motivo por el que `uq_racks_section_slot` es DEFERRABLE.

    Intercambiar los slots de dos racks de la misma sección deja, a mitad del UPDATE, dos
    racks en el mismo (section_id, slot). Con el constraint validando por sentencia, la
    siembra explotaba a la mitad y dejaba el layout a medio aplicar.
    """
    seed_layout(db_session)

    swapped = tmp_path / "layout.yaml"
    swapped.write_text(
        yaml.safe_dump(
            {
                "racks": [
                    {"letter": "A", "section": "I", "slot": "right", "capacity": 20},
                    {"letter": "B", "section": "I", "slot": "center", "capacity": 20},
                ]
            }
        ),
        encoding="utf-8",
    )

    seed_layout(db_session, swapped)

    assert db_session.query(Rack).filter_by(letter="A").one().slot == "right"
    assert db_session.query(Rack).filter_by(letter="B").one().slot == "center"


def test_racks_unique_slot_still_rejects_immediate_duplicate(db_session):
    """DEFERRABLE INITIALLY IMMEDIATE no relaja nada fuera del seed: un duplicado sigue
    fallando en el instante, no al commit."""
    seed_layout(db_session)
    section = db_session.query(Section).filter_by(code="I").one()

    db_session.add(Rack(letter="Z", section_id=section.id, slot="center", capacity=20))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_seed_layout_rejects_invalid_section_code(db_session, tmp_path):
    """Sin esta validación, un typo en layout.yaml dejaría de ser una sección mal
    etiquetada y pasaría a ser un loop de reinicio del backend (el seed corre en cada
    arranque encadenado con `&&`)."""
    bad = tmp_path / "layout.yaml"
    bad.write_text(
        yaml.safe_dump({"racks": [{"letter": "A", "section": "i", "slot": "center", "capacity": 20}]}),
        encoding="utf-8",
    )

    # "i" se normaliza a "I" y es válida; el caso malo es una sección que no existe.
    seed_layout(db_session, bad)
    assert db_session.query(Rack).filter_by(letter="A").one().section.code == "I"

    worse = tmp_path / "worse.yaml"
    worse.write_text(
        yaml.safe_dump({"racks": [{"letter": "A", "section": "V", "slot": "center", "capacity": 20}]}),
        encoding="utf-8",
    )
    with pytest.raises(LayoutError) as exc:
        seed_layout(db_session, worse)
    assert "V" in str(exc.value)
    assert "Arreglo" in str(exc.value)


def test_seed_layout_rejects_invalid_rack_letter(db_session, tmp_path):
    bad = tmp_path / "layout.yaml"
    bad.write_text(
        yaml.safe_dump({"racks": [{"letter": "Z", "section": "I", "slot": "center", "capacity": 20}]}),
        encoding="utf-8",
    )

    with pytest.raises(LayoutError) as exc:
        seed_layout(db_session, bad)
    assert "Z" in str(exc.value)


def test_seed_layout_rejects_duplicate_letter(db_session, tmp_path):
    bad = tmp_path / "layout.yaml"
    bad.write_text(
        yaml.safe_dump(
            {
                "racks": [
                    {"letter": "A", "section": "I", "slot": "center", "capacity": 20},
                    {"letter": "A", "section": "II", "slot": "right", "capacity": 20},
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(LayoutError):
        seed_layout(db_session, bad)
