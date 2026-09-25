from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession, get_or_404
from app.models import Box, Rack, Sample, Section
from app.schemas.rack import RackCreate, RackRead, RackUpdate
from app.services.racks import max_box_number

router = APIRouter(prefix="/racks", tags=["racks"])

_DUPLICATE_MESSAGE = "Ya existe un rack con esa letra, o esa sección/posición ya está ocupada"


@router.post("", response_model=RackRead, status_code=status.HTTP_201_CREATED)
def create_rack(payload: RackCreate, db: DbSession) -> Rack:
    get_or_404(db, Section, payload.section_id, "Sección no encontrada")
    rack = Rack(
        section_id=payload.section_id,
        letter=payload.letter.strip().upper(),
        slot=payload.slot.value,
        capacity=payload.capacity,
    )
    db.add(rack)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(rack)
    return rack


@router.get("", response_model=list[RackRead])
def list_racks(db: DbSession, section_id: int | None = None) -> list[Rack]:
    query = db.query(Rack)
    if section_id is not None:
        query = query.filter(Rack.section_id == section_id)
    return query.order_by(Rack.letter).all()


@router.get("/{rack_id}", response_model=RackRead)
def get_rack(rack_id: int, db: DbSession) -> Rack:
    return get_or_404(db, Rack, rack_id, "Rack no encontrado")


@router.patch("/{rack_id}", response_model=RackRead)
def update_rack(rack_id: int, payload: RackUpdate, db: DbSession) -> Rack:
    rack = get_or_404(db, Rack, rack_id, "Rack no encontrado")
    data = payload.model_dump(exclude_unset=True)
    if data.get("section_id") is not None:
        get_or_404(db, Section, data["section_id"], "Sección no encontrada")
    if data.get("slot") is not None:
        data["slot"] = data["slot"].value
    if data.get("letter") is not None:
        data["letter"] = data["letter"].strip().upper()
    if data.get("capacity") is not None and data["capacity"] < rack.capacity:
        highest = max_box_number(db, rack.id)
        if highest is not None and data["capacity"] < highest:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"No se puede bajar la capacidad por debajo de la caja más alta existente ({highest})",
            )
    changes_location = (
        (data.get("section_id") is not None and data["section_id"] != rack.section_id)
        or (data.get("letter") is not None and data["letter"] != rack.letter)
        or (data.get("slot") is not None and data["slot"] != rack.slot)
    )
    if changes_location:
        has_samples = (
            db.query(Sample).join(Box, Sample.box_id == Box.id).filter(Box.rack_id == rack.id).first() is not None
        )
        if has_samples:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "No se puede cambiar la sección, la letra o el slot de un rack que ya tiene muestras asociadas",
            )
    for field, value in data.items():
        setattr(rack, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(rack)
    return rack


@router.delete("/{rack_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rack(rack_id: int, db: DbSession) -> None:
    rack = get_or_404(db, Rack, rack_id, "Rack no encontrado")
    db.delete(rack)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "No se puede eliminar: el rack tiene cajas asociadas"
        ) from exc
