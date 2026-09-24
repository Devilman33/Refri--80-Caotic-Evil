from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.models import Box, Movement, MovementAction, Sample, User


def register_frozen_sample(
    session: Session,
    *,
    environ_id: str,
    owner: User,
    operator: User,
    box: Box,
    position: str,
    sample_type: str,
    movement_date: datetime,
    origin_id: str | None = None,
    description: str | None = None,
    type_other: str | None = None,
    passage: int | None = None,
    is_core: bool,
    sample_date: date | None = None,
    notes: str | None = None,
    movement_note: str | None = None,
) -> Sample:
    sample = Sample(
        environ_id=environ_id,
        origin_id=origin_id,
        description=description,
        type=sample_type,
        type_other=type_other,
        owner=owner,
        passage=passage,
        is_core=is_core,
        date=sample_date,
        box=box,
        position=position,
        notes=notes,
    )
    movement = Movement(
        sample=sample,
        action=MovementAction.FREEZE,
        date=movement_date.astimezone(timezone.utc),
        operator=operator,
        destination_box=box,
        destination_position=position,
        note=movement_note,
    )
    session.add_all([sample, movement])
    session.flush()
    return sample
