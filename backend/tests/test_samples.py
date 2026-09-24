"""Cubre los criterios de aceptación del issue #1:
- restricción de posición única para muestras activas
- retirar una muestra libera su posición sin borrarla
"""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Box, Rack, Sample, SampleStatus, SampleType, Section


def _make_box(session, *, box_type: str = "carton_81") -> Box:
    section = Section(code="I")
    session.add(section)
    session.flush()

    rack = Rack(section_id=section.id, letter="A", slot="center", capacity=30)
    session.add(rack)
    session.flush()

    box = Box(rack_id=rack.id, number=1, box_type=box_type)
    session.add(box)
    session.flush()
    return box


def _make_sample(box: Box, position: str, status: str = SampleStatus.ACTIVE.value) -> Sample:
    return Sample(
        type=SampleType.VIAL_CELULAS.value,
        status=status,
        box_id=box.id,
        position=position,
    )


def test_two_active_samples_cannot_share_a_position(db_session):
    box = _make_box(db_session)

    db_session.add(_make_sample(box, "1A"))
    db_session.commit()

    db_session.add(_make_sample(box, "1A"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_different_positions_in_the_same_box_are_fine(db_session):
    box = _make_box(db_session)

    db_session.add(_make_sample(box, "1A"))
    db_session.add(_make_sample(box, "1B"))
    db_session.commit()

    assert db_session.query(Sample).count() == 2


def test_withdrawing_a_sample_frees_its_position_without_deleting_it(db_session):
    box = _make_box(db_session)

    sample = _make_sample(box, "1A")
    db_session.add(sample)
    db_session.commit()
    sample_id = sample.id

    sample.status = SampleStatus.WITHDRAWN.value
    db_session.commit()

    # La posición quedó libre: otra muestra activa puede ocuparla.
    db_session.add(_make_sample(box, "1A"))
    db_session.commit()

    withdrawn = db_session.get(Sample, sample_id)
    assert withdrawn is not None
    assert withdrawn.status == SampleStatus.WITHDRAWN.value
    assert db_session.query(Sample).count() == 2
