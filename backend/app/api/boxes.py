from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession, get_or_404
from app.models import Box, Rack, Sample, SampleStatus, User
from app.schemas.box import BoxCreate, BoxPositionStatus, BoxRead, BoxUpdate
from app.services.positions import position_order
from app.services.racks import ensure_box_number_within_capacity

router = APIRouter(prefix="/boxes", tags=["cajas"])

_DUPLICATE_MESSAGE = "Ya existe una caja con ese número en el rack"


@router.post("", response_model=BoxRead, status_code=status.HTTP_201_CREATED)
def create_box(payload: BoxCreate, db: DbSession) -> Box:
    rack = get_or_404(db, Rack, payload.rack_id, "Rack no encontrado")
    ensure_box_number_within_capacity(rack, payload.number)
    if payload.owner_id is not None:
        get_or_404(db, User, payload.owner_id, "Usuario propietario no encontrado")
    box = Box(
        rack_id=payload.rack_id,
        number=payload.number,
        box_type=payload.box_type.value,
        label=payload.label,
        owner_id=payload.owner_id,
        is_full=payload.is_full,
    )
    db.add(box)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(box)
    return box


@router.get("", response_model=list[BoxRead])
def list_boxes(db: DbSession, rack_id: int | None = None) -> list[Box]:
    query = db.query(Box)
    if rack_id is not None:
        query = query.filter(Box.rack_id == rack_id)
    return query.order_by(Box.rack_id, Box.number).all()


@router.get("/{box_id}", response_model=BoxRead)
def get_box(box_id: int, db: DbSession) -> Box:
    return get_or_404(db, Box, box_id, "Caja no encontrada")


@router.patch("/{box_id}", response_model=BoxRead)
def update_box(box_id: int, payload: BoxUpdate, db: DbSession) -> Box:
    box = get_or_404(db, Box, box_id, "Caja no encontrada")
    data = payload.model_dump(exclude_unset=True)
    if data.get("owner_id") is not None:
        get_or_404(db, User, data["owner_id"], "Usuario propietario no encontrado")
    if data.get("box_type") is not None:
        data["box_type"] = data["box_type"].value
        if data["box_type"] != box.box_type and db.query(Sample).filter(Sample.box_id == box.id).first() is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "No se puede cambiar el tipo de una caja que ya tiene muestras asociadas",
            )
    for field, value in data.items():
        setattr(box, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(box)
    return box


@router.delete("/{box_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box(box_id: int, db: DbSession) -> None:
    box = get_or_404(db, Box, box_id, "Caja no encontrada")
    db.delete(box)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "No se puede eliminar: la caja tiene muestras asociadas"
        ) from exc


@router.get("/{box_id}/positions", response_model=list[BoxPositionStatus])
def box_positions(box_id: int, db: DbSession) -> list[BoxPositionStatus]:
    """Estado de cada posición de la caja (ocupada/libre) para las luces del visor."""
    box = get_or_404(db, Box, box_id, "Caja no encontrada")
    active_samples = (
        db.query(Sample).filter(Sample.box_id == box.id, Sample.status == SampleStatus.ACTIVE.value).all()
    )
    by_position = {sample.position: sample for sample in active_samples}
    return [
        BoxPositionStatus(
            position=position,
            occupied=position in by_position,
            sample_id=by_position[position].id if position in by_position else None,
            environ_id=by_position[position].environ_id if position in by_position else None,
        )
        for position in position_order(box.box_type)
    ]
