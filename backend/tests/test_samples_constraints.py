from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from app.models import Box, BoxType, Movement, MovementAction, Rack, Sample, SampleStatus, Section, User



def seed_storage(db_session):
    owner = User(initials="DM", name="Devilman33")
    operator = User(initials="GC", name="Grace Copilot")
    section = Section(name="I")
    rack = Rack(section=section, letter="A")
    box = Box(rack=rack, number=1, type=BoxType.CARTON_81, owner=owner)
    second_box = Box(rack=rack, number=2, type=BoxType.CARTON_81, owner=owner)
    db_session.add_all([owner, operator, section, rack, box, second_box])
    db_session.flush()
    return owner, operator, box, second_box



def test_only_one_active_sample_per_box_position(db_session) -> None:
    owner, _, box, _ = seed_storage(db_session)
    db_session.add(
        Sample(
            environ_id="ENV-1",
            description="first",
            type="RNA",
            owner=owner,
            passage=1,
            is_core=True,
            box=box,
            position="1A",
        )
    )
    db_session.commit()

    db_session.add(
        Sample(
            environ_id="ENV-2",
            description="second",
            type="RNA",
            owner=owner,
            passage=2,
            is_core=False,
            box=box,
            position="1A",
        )
    )

    try:
        db_session.commit()
    except IntegrityError:
        db_session.rollback()
    else:
        raise AssertionError("Expected a unique constraint violation for an occupied active position")



def test_withdrawing_sample_releases_position_without_deleting_history(db_session) -> None:
    owner, operator, box, _ = seed_storage(db_session)
    sample = Sample(
        environ_id="ENV-1",
        description="first",
        type="Vial de Células",
        owner=owner,
        passage=1,
        is_core=True,
        box=box,
        position="1A",
    )
    db_session.add(sample)
    db_session.flush()
    db_session.add(
        Movement(
            sample=sample,
            action=MovementAction.FREEZE,
            date=datetime(2026, 9, 24, tzinfo=timezone.utc),
            operator=operator,
            box=box,
            position="1A",
            note="Ingreso inicial",
        )
    )
    db_session.commit()

    sample.status = SampleStatus.WITHDRAWN
    db_session.add(
        Movement(
            sample=sample,
            action=MovementAction.THAW,
            date=datetime(2026, 9, 25, tzinfo=timezone.utc),
            operator=operator,
            box=box,
            position="1A",
            note="Retiro para análisis",
        )
    )
    db_session.commit()

    replacement = Sample(
        environ_id="ENV-2",
        description="replacement",
        type="Vial de Células",
        owner=owner,
        passage=1,
        is_core=False,
        box=box,
        position="1A",
    )
    db_session.add(replacement)
    db_session.commit()

    persisted = db_session.get(Sample, sample.id)
    assert persisted is not None
    assert persisted.status == SampleStatus.WITHDRAWN
    assert replacement.id is not None
    assert len(persisted.movements) == 2


def test_transferring_sample_records_history_and_frees_previous_position(db_session) -> None:
    owner, operator, box, second_box = seed_storage(db_session)
    sample = Sample(
        environ_id="ENV-3",
        description="movable",
        type="RNA",
        owner=owner,
        passage=3,
        is_core=True,
        box=box,
        position="2A",
    )
    db_session.add(sample)
    db_session.flush()
    db_session.add(
        Movement(
            sample=sample,
            action=MovementAction.FREEZE,
            date=datetime(2026, 9, 24, tzinfo=timezone.utc),
            operator=operator,
            box=box,
            position="2A",
            note="Ingreso inicial",
        )
    )
    db_session.commit()

    sample.box = second_box
    sample.position = "3A"
    db_session.add(
        Movement(
            sample=sample,
            action=MovementAction.TRANSFER,
            date=datetime(2026, 9, 26, tzinfo=timezone.utc),
            operator=operator,
            box=second_box,
            position="3A",
            note="Traslado a otra caja",
        )
    )
    db_session.commit()

    replacement = Sample(
        environ_id="ENV-4",
        description="replacement after transfer",
        type="RNA",
        owner=owner,
        passage=4,
        is_core=False,
        box=box,
        position="2A",
    )
    db_session.add(replacement)
    db_session.commit()

    persisted = db_session.get(Sample, sample.id)
    assert persisted is not None
    assert persisted.box_id == second_box.id
    assert persisted.position == "3A"
    assert [movement.action for movement in persisted.movements] == [
        MovementAction.FREEZE,
        MovementAction.TRANSFER,
    ]
    assert replacement.id is not None
