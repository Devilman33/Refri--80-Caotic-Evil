from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.deps import DbSession
from app.models import Box, Sample, SampleStatus, SampleType, User
from app.schemas.autocomplete import AutocompleteSuggestion
from app.services.positions import next_free_position

router = APIRouter(prefix="/autocomplete", tags=["autocompletado"])


@router.get("/suggestions", response_model=AutocompleteSuggestion)
def suggestions(db: DbSession, environ_id: str | None = None, owner_initials: str | None = None) -> AutocompleteSuggestion:
    """Sugerencias para el formulario a partir de la última muestra que coincida
    con el ID Environ y/o encargado indicados (docs/FORMULARIO.md)."""
    if not environ_id and not owner_initials:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Se requiere environ_id y/o owner_initials")

    query = (
        db.query(Sample)
        .join(User, Sample.owner_id == User.id)
        .options(joinedload(Sample.box).joinedload(Box.rack), joinedload(Sample.owner))
    )
    if environ_id:
        query = query.filter(Sample.environ_id == environ_id)
    if owner_initials:
        query = query.filter(User.initials == owner_initials.strip().upper())

    sample = query.order_by(Sample.created_at.desc(), Sample.id.desc()).first()
    if sample is None:
        return AutocompleteSuggestion()

    box = sample.box
    occupied = {
        position
        for (position,) in db.query(Sample.position).filter(
            Sample.box_id == box.id, Sample.status == SampleStatus.ACTIVE.value
        )
    }
    return AutocompleteSuggestion(
        environ_id=sample.environ_id,
        description=sample.description,
        sample_type=SampleType(sample.type),
        type_other=sample.type_other,
        passage=sample.passage,
        is_core=sample.is_core,
        owner_initials=sample.owner.initials,
        rack_letter=box.rack.letter,
        box_number=box.number,
        box_id=box.id,
        next_free_position=next_free_position(box.box_type, occupied),
    )
