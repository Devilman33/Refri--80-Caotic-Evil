from datetime import date

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.api.deps import DbSession, get_or_404
from app.importer.cleaning import parse_posicion
from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, SampleType, Section, User
from app.schemas.common import Page
from app.schemas.movement import MovementRead
from app.schemas.sample import SampleCreate, SampleRead, SampleUpdate, SampleWithLocation
from app.services.location import sample_with_location
from app.services.users import get_or_create_user

router = APIRouter(prefix="/samples", tags=["muestras"])

_LOCATION_LOAD = joinedload(Sample.box).joinedload(Box.rack).joinedload(Rack.section)


@router.post("", response_model=SampleRead, status_code=status.HTTP_201_CREATED)
def create_sample(payload: SampleCreate, db: DbSession) -> Sample:
    """Alta directa de una muestra: registra además el movimiento de congelamiento
    (igual que `POST /movements`) para no dejar el historial vacío."""
    get_or_404(db, User, payload.owner_id, "Usuario encargado no encontrado")
    box = get_or_404(db, Box, payload.box_id, "Caja no encontrada")

    position, inferred_box_type, reason = parse_posicion(payload.position)
    if reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Posición inválida: {reason}")
    if inferred_box_type != box.box_type:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"La posición '{payload.position}' no es válida para una caja de tipo '{box.box_type}'",
        )

    operator = get_or_create_user(db, payload.operator_initials)
    sample = Sample(
        environ_id=payload.environ_id,
        description=payload.description,
        type=payload.type.value,
        type_other=payload.type_other,
        owner_id=payload.owner_id,
        passage=payload.passage,
        is_core=payload.is_core,
        box_id=payload.box_id,
        position=position,
        notes=payload.notes,
    )
    db.add(sample)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "La posición ya está ocupada por una muestra activa"
        ) from exc

    movement = Movement(
        sample_id=sample.id,
        action=MovementAction.FREEZE.value,
        date=payload.date,
        operator_id=operator.id,
        box_id=payload.box_id,
        position=position,
        note=payload.note,
    )
    db.add(movement)
    db.commit()
    db.refresh(sample)
    return sample


@router.get("", response_model=Page[SampleRead])
def list_samples(
    db: DbSession,
    status_: SampleStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[SampleRead]:
    query = db.query(Sample)
    if status_ is not None:
        query = query.filter(Sample.status == status_.value)
    total = query.count()
    items = query.order_by(Sample.id).offset((page - 1) * page_size).limit(page_size).all()
    return Page[SampleRead](items=items, total=total, page=page, page_size=page_size)


@router.get("/search", response_model=Page[SampleWithLocation])
def search_samples(
    db: DbSession,
    environ_id: str | None = None,
    description: str | None = None,
    owner_initials: str | None = None,
    sample_type: SampleType | None = Query(default=None, alias="type"),
    is_core: bool | None = None,
    passage: int | None = None,
    status_: SampleStatus | None = Query(default=None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
    section_code: str | None = None,
    rack_letter: str | None = None,
    box_number: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[SampleWithLocation]:
    """Búsqueda con filtros combinables; cada resultado trae su ubicación legible."""
    query = (
        db.query(Sample)
        .join(Box, Sample.box_id == Box.id)
        .join(Rack, Box.rack_id == Rack.id)
        .join(Section, Rack.section_id == Section.id)
        .join(User, Sample.owner_id == User.id)
        .options(_LOCATION_LOAD)
    )
    if environ_id:
        query = query.filter(Sample.environ_id.ilike(f"%{environ_id}%"))
    if description:
        query = query.filter(Sample.description.ilike(f"%{description}%"))
    if owner_initials:
        query = query.filter(User.initials == owner_initials.strip().upper())
    if sample_type is not None:
        query = query.filter(Sample.type == sample_type.value)
    if is_core is not None:
        query = query.filter(Sample.is_core == is_core)
    if passage is not None:
        query = query.filter(Sample.passage == passage)
    if status_ is not None:
        query = query.filter(Sample.status == status_.value)
    if section_code:
        query = query.filter(Section.code == section_code.strip().upper())
    if rack_letter:
        query = query.filter(Rack.letter == rack_letter.strip().upper())
    if box_number is not None:
        query = query.filter(Box.number == box_number)
    if date_from or date_to:
        freeze_dates = select(Movement.sample_id).where(Movement.action == MovementAction.FREEZE.value)
        if date_from:
            freeze_dates = freeze_dates.where(Movement.date >= date_from)
        if date_to:
            freeze_dates = freeze_dates.where(Movement.date <= date_to)
        query = query.filter(Sample.id.in_(freeze_dates))

    total = query.count()
    samples = query.order_by(Sample.id).offset((page - 1) * page_size).limit(page_size).all()
    items = [sample_with_location(sample) for sample in samples]
    return Page[SampleWithLocation](items=items, total=total, page=page, page_size=page_size)


@router.get("/{sample_id}", response_model=SampleWithLocation)
def get_sample(sample_id: int, db: DbSession) -> SampleWithLocation:
    sample = db.query(Sample).options(_LOCATION_LOAD).filter(Sample.id == sample_id).one_or_none()
    if sample is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Muestra no encontrada")
    return sample_with_location(sample)


@router.patch("/{sample_id}", response_model=SampleRead)
def update_sample(sample_id: int, payload: SampleUpdate, db: DbSession) -> Sample:
    sample = get_or_404(db, Sample, sample_id, "Muestra no encontrada")
    data = payload.model_dump(exclude_unset=True)
    if data.get("owner_id") is not None:
        get_or_404(db, User, data["owner_id"], "Usuario encargado no encontrado")
    if data.get("type") is not None:
        data["type"] = data["type"].value
    for field, value in data.items():
        setattr(sample, field, value)
    db.commit()
    db.refresh(sample)
    return sample


@router.get("/{sample_id}/movements", response_model=list[MovementRead])
def sample_movements(sample_id: int, db: DbSession) -> list[Movement]:
    """Historial de eventos (ingresos y retiros) de una muestra."""
    get_or_404(db, Sample, sample_id, "Muestra no encontrada")
    return (
        db.query(Movement)
        .filter(Movement.sample_id == sample_id)
        .order_by(Movement.date, Movement.id)
        .all()
    )
