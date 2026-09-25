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


def test_seed_layout_does_not_undo_changes_made_from_the_page(db_session, tmp_path):
    """La base manda: un rack movido o dado de baja desde la página no vuelve a su lugar
    en el arranque siguiente. `layout.yaml` solo crea lo que falta."""
    seed_layout(db_session)
    section_i = db_session.query(Section).filter_by(code="I").one()
    rack_a = db_session.query(Rack).filter_by(letter="A").one()
    rack_b = db_session.query(Rack).filter_by(letter="B").one()
    rack_b.active, rack_b.slot = False, None
    db_session.flush()
    rack_a.slot = "right"
    db_session.commit()

    seed_layout(db_session)

    db_session.refresh(rack_a)
    db_session.refresh(rack_b)
    assert (rack_a.section_id, rack_a.slot) == (section_i.id, "right")
    assert (rack_b.active, rack_b.slot) == (False, None)


def test_seed_layout_creates_missing_racks_only_where_the_place_is_free(db_session, tmp_path):
    seed_layout(db_session)
    extra = tmp_path / "layout.yaml"
    extra.write_text(
        yaml.safe_dump({"racks": [{"letter": "A", "section": "II", "slot": "center", "capacity": 20}]}),
        encoding="utf-8",
    )

    seed_layout(db_session, extra)

    # A ya existía en I: no se mueve a II.
    assert db_session.query(Rack).filter_by(letter="A").one().section.code == "I"


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
        yaml.safe_dump({"racks": [{"letter": "1", "section": "I", "slot": "center", "capacity": 20}]}),
        encoding="utf-8",
    )

    with pytest.raises(LayoutError) as exc:
        seed_layout(db_session, bad)
    assert "1" in str(exc.value)


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


def test_seed_users_creates_the_initial_people_once(db_session):
    from app.models import User
    from app.seed.seed import INITIAL_USERS, seed_users

    db_session.add(User(initials="GC", name="Gonzalo Carrasco"))
    db_session.commit()

    seed_users(db_session)
    seed_users(db_session)

    users = {user.initials: user for user in db_session.query(User).all()}
    assert set(users) == set(INITIAL_USERS)
    # Una persona que ya completó su nombre no se pisa.
    assert users["GC"].name == "Gonzalo Carrasco"
