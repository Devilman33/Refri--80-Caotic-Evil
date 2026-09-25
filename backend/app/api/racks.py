from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession, get_or_404
from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, Section
from app.schemas.rack import RackActivate, RackCreate, RackMoveCreate, RackMoveResult, RackRead, RackUpdate
from app.services.racks import active_sample_count, max_box_number
from app.services.users import get_or_create_user

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
def list_racks(db: DbSession, section_id: int | None = None, include_inactive: bool = False) -> list[Rack]:
    query = db.query(Rack)
    if not include_inactive:
        query = query.filter(Rack.active.is_(True))
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


def _section_by_code(db, code: str) -> Section:
    section = db.query(Section).filter(Section.code == code.strip().upper()).one_or_none()
    if section is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sección '{code}' no encontrada")
    return section


def _record_rack_move(db, rack: Rack, *, from_code: str, to_code: str, operator_id: int, payload) -> int:
    """Un evento de traslado por cada muestra activa del rack: su ubicación cambió de
    estante aunque siga en la misma caja y posición."""
    samples = (
        db.query(Sample)
        .join(Box, Sample.box_id == Box.id)
        .filter(Box.rack_id == rack.id, Sample.status == SampleStatus.ACTIVE.value)
        .all()
    )
    for sample in samples:
        db.add(
            Movement(
                sample_id=sample.id,
                action=MovementAction.MOVE.value,
                date=payload.date,
                operator_id=operator_id,
                box_id=sample.box_id,
                position=sample.position,
                from_box_id=sample.box_id,
                from_position=sample.position,
                section_code=to_code,
                from_section_code=from_code,
                note=payload.note,
            )
        )
    return len(samples)


@router.post("/{rack_id}/move", response_model=RackMoveResult)
def move_rack(rack_id: int, payload: RackMoveCreate, db: DbSession, current_user: CurrentUser) -> RackMoveResult:
    """Lleva un rack a otro estante o lugar, con todas sus cajas y muestras.

    Cada estante tiene dos lugares (centro y derecha). Si el de destino está ocupado, con
    `swap` los dos racks intercambian lugares; sin él, 409 diciendo cuál rack está ahí.
    Todas las muestras activas de los racks que se mueven reciben su evento de traslado,
    y cada evento guarda la sección donde ocurrió: el historial anterior no cambia.
    """
    rack = db.query(Rack).filter(Rack.id == rack_id).with_for_update().one_or_none()
    if rack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rack no encontrado")
    if not rack.active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El rack está dado de baja")
    target_section = _section_by_code(db, payload.section_code)
    slot = payload.slot.value
    if rack.section_id == target_section.id and rack.slot == slot:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El rack ya está en ese lugar")

    occupant = (
        db.query(Rack)
        .filter(Rack.section_id == target_section.id, Rack.slot == slot, Rack.active.is_(True))
        .with_for_update()
        .one_or_none()
    )
    if occupant is not None and not payload.swap:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": f"En ese lugar está el rack {occupant.letter}: se pueden intercambiar",
                "occupant_letter": occupant.letter,
            },
        )

    operator = get_or_create_user(db, payload.operator_initials)
    origin_section = rack.section
    origin_code, origin_slot = origin_section.code, rack.slot

    # Un intercambio deja, a mitad de camino, dos racks en el mismo lugar: la restricción
    # se verifica al final de la transacción (es DEFERRABLE desde la migración 0003).
    db.execute(text("SET CONSTRAINTS uq_racks_section_slot DEFERRED"))
    moved = _record_rack_move(db, rack, from_code=origin_code, to_code=target_section.code, operator_id=operator.id, payload=payload)
    rack.section_id, rack.slot = target_section.id, slot
    if occupant is not None:
        moved += _record_rack_move(
            db, occupant, from_code=target_section.code, to_code=origin_code, operator_id=operator.id, payload=payload
        )
        occupant.section_id, occupant.slot = origin_section.id, origin_slot
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Otra operación ocupó ese lugar mientras tanto") from exc

    db.refresh(rack)
    if occupant is not None:
        db.refresh(occupant)
    return RackMoveResult(
        rack=RackRead.model_validate(rack),
        swapped_with=RackRead.model_validate(occupant) if occupant is not None else None,
        moved_samples=moved,
    )


@router.post("/{rack_id}/deactivate", response_model=RackRead)
def deactivate_rack(rack_id: int, db: DbSession, current_user: CurrentUser) -> Rack:
    """Da de baja un rack vacío: sale del visor y libera su lugar en el estante. Sus cajas
    se dan de baja con él. El historial de lo que tuvo queda intacto."""
    rack = get_or_404(db, Rack, rack_id, "Rack no encontrado")
    active = active_sample_count(db, rack_id=rack.id)
    if active:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"El rack {rack.letter} tiene {active} muestras activas: retíralas o trasládalas antes de darlo de baja",
        )
    rack.active = False
    rack.slot = None
    for box in rack.boxes:
        box.active = False
    db.commit()
    db.refresh(rack)
    return rack


@router.post("/{rack_id}/activate", response_model=RackRead)
def activate_rack(rack_id: int, payload: RackActivate, db: DbSession, current_user: CurrentUser) -> Rack:
    """Vuelve a poner en uso un rack dado de baja, en un lugar libre."""
    rack = get_or_404(db, Rack, rack_id, "Rack no encontrado")
    if rack.active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El rack ya está en uso")
    section = _section_by_code(db, payload.section_code)
    rack.active = True
    rack.section_id = section.id
    rack.slot = payload.slot.value
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese lugar del estante ya está ocupado") from exc
    db.refresh(rack)
    return rack
