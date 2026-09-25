from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession, get_or_404
from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, User
from app.schemas.box import BoxCreate, BoxMoveCreate, BoxMoveResult, BoxPositionStatus, BoxRead, BoxUpdate
from app.services.occupancy import refresh_box_full
from app.services.positions import position_order
from app.services.racks import ensure_box_number_within_capacity
from app.services.users import get_or_create_user

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
    if data.get("number") is not None:
        rack = get_or_404(db, Rack, box.rack_id, "Rack no encontrado")
        ensure_box_number_within_capacity(rack, data["number"])
        # Cambiar el número reubica físicamente TODAS las muestras de la caja sin registrar
        # un solo evento de movimiento, y la regla dice que todo movimiento queda en la
        # tabla de eventos. El cambio de `box_type` ya estaba bloqueado por lo mismo.
        if data["number"] != box.number and db.query(Sample).filter(Sample.box_id == box.id).first() is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "No se puede cambiar el número de una caja que ya tiene muestras asociadas: "
                "sería moverlas a todas sin registrar el movimiento",
            )
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
            is_core=by_position[position].is_core if position in by_position else None,
        )
        for position in position_order(box.box_type)
    ]


def _box_label(box: Box) -> str:
    rack = box.rack
    return f"{rack.section.code} · {rack.letter}{box.number}"


@router.post("/{box_id}/move", response_model=BoxMoveResult)
def move_box(box_id: int, payload: BoxMoveCreate, db: DbSession, current_user: CurrentUser) -> BoxMoveResult:
    """Traslada una subcaja con todas sus muestras activas a otro rack y/o número.

    Cada muestra recibe su evento de traslado (misma posición, otra caja), así que la
    ubicación de todas se actualiza sola y el historial dice de dónde a dónde.

    No se renumera la fila de la caja de origen: los eventos viejos y las muestras
    retiradas apuntan a ella, y cambiarle el rack reescribiría la historia (un retiro de
    hace un año aparecería hecho en el lugar nuevo). Por eso las muestras activas pasan a
    una caja en el destino y la de origen queda vacía en su lugar.
    """
    source = db.query(Box).filter(Box.id == box_id).with_for_update().one_or_none()
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caja no encontrada")

    rack = db.query(Rack).filter(Rack.letter == payload.rack_letter.strip().upper()).one_or_none()
    if rack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Rack '{payload.rack_letter}' no encontrado")
    ensure_box_number_within_capacity(rack, payload.box_number)
    if rack.id == source.rack_id and payload.box_number == source.number:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "La caja ya está en ese lugar")

    samples = (
        db.query(Sample)
        .filter(Sample.box_id == source.id, Sample.status == SampleStatus.ACTIVE.value)
        .order_by(Sample.id)
        .with_for_update()
        .all()
    )
    if not samples:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "La caja no tiene muestras activas: no hay nada que trasladar",
        )

    target = (
        db.query(Box)
        .filter(Box.rack_id == rack.id, Box.number == payload.box_number)
        .with_for_update()
        .one_or_none()
    )
    if target is None:
        target = Box(rack_id=rack.id, number=payload.box_number, box_type=source.box_type)
        db.add(target)
        db.flush()
    else:
        target_active = (
            db.query(Sample.id)
            .filter(Sample.box_id == target.id, Sample.status == SampleStatus.ACTIVE.value)
            .first()
        )
        if target_active is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"En {rack.letter}{target.number} ya hay una caja con muestras: elegí un lugar libre",
            )
        if target.box_type != source.box_type:
            has_history = db.query(Sample.id).filter(Sample.box_id == target.id).first() is not None
            if has_history:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"La caja registrada en {rack.letter}{target.number} es de otro tipo y tiene historial",
                )
            target.box_type = source.box_type

    # La etiqueta y el propietario son de la caja física, que es la que se mueve.
    target.label = source.label
    target.owner_id = source.owner_id
    source.label = None
    source.owner_id = None

    operator = get_or_create_user(db, payload.operator_initials)
    for sample in samples:
        db.add(
            Movement(
                sample_id=sample.id,
                action=MovementAction.MOVE.value,
                date=payload.date,
                operator_id=operator.id,
                box_id=target.id,
                position=sample.position,
                from_box_id=source.id,
                from_position=sample.position,
                note=payload.note,
            )
        )
        sample.box_id = target.id

    try:
        refresh_box_full(db, target)
        refresh_box_full(db, source)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Otra operación ocupó el lugar de destino mientras tanto"
        ) from exc

    db.refresh(target)
    db.refresh(source)
    return BoxMoveResult(
        box=BoxRead.model_validate(target),
        moved=len(samples),
        from_label=_box_label(source),
        to_label=_box_label(target),
    )
