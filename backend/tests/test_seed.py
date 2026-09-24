from app.models import Rack, Section
from app.seed.seed import seed_layout


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
