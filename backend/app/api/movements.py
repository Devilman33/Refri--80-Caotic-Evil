from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import DbSession
from app.importer.cleaning import parse_posicion
from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, User
from app.schemas.movement import MovementCreate, MovementRead, MovementResult, PositionConflict
from app.services.location import sample_with_location
from app.services.positions import next_free_position
from app.services.racks import ensure_box_number_within_capacity
from app.services.users import NUCLEO_INITIALS, get_or_create_user

router = APIRouter(prefix="/movements", tags=["movimientos"])


@router.post(
    "",
    response_model=MovementResult,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_409_CONFLICT: {"model": PositionConflict}},
)
def create_movement(payload: MovementCreate, db: DbSession) -> MovementResult:
    """Registra un movimiento: congelamiento (ingreso/reingreso) o descongelamiento
    (retiro). Nunca borra una muestra; ver .github/copilot-instructions.md."""
    rack = db.query(Rack).filter(Rack.letter == payload.rack_letter.strip().upper()).one_or_none()
    if rack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Rack '{payload.rack_letter}' no encontrado")

    position, inferred_box_type, reason = parse_posicion(payload.position)
    if reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Posición inválida: {reason}")

    box = db.query(Box).filter(Box.rack_id == rack.id, Box.number == payload.box_number).one_or_none()
    operator = get_or_create_user(db, payload.operator_initials)

    # Guarda explícita en vez de un fallthrough. Este endpoint implementa exactamente dos
    # acciones; agregar un valor nuevo a `MovementAction` (p. ej. un traslado) lo mandaba
    # antes a `_freeze`, donde `_check_required_for_freeze` no valida nada porque la acción
    # no es FREEZE, y terminaba en `get_or_create_user(None)` con un 500. Peor: el
    # desplegable del formulario se genera desde `MOVEMENT_ACTION_LABELS`, así que la
    # acción nueva aparecía sola en la UI y la encontraba un operador, no un test.
    if payload.action not in (MovementAction.FREEZE, MovementAction.THAW):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Este endpoint solo registra congelamientos y descongelamientos; "
            f"'{payload.action.value}' se registra en su propio endpoint",
        )

    if payload.action == MovementAction.THAW:
        return _thaw(db, box=box, position=position, operator=operator, payload=payload)
    return _freeze(
        db, rack=rack, box=box, position=position, box_type=inferred_box_type, operator=operator, payload=payload
    )


def _thaw(db: Session, *, box: Box | None, position: str, operator: User, payload: MovementCreate) -> MovementResult:
    if box is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caja no encontrada")
    sample = (
        db.query(Sample)
        .filter(Sample.box_id == box.id, Sample.position == position, Sample.status == SampleStatus.ACTIVE.value)
        .one_or_none()
    )
    if sample is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No hay una muestra activa en esa posición")

    sample.status = SampleStatus.WITHDRAWN.value
    # Acaba de liberarse una posición: la caja ya no puede estar llena. `_freeze` escribe
    # `box.is_full` desde el campo "¿La caja está llena?" del formulario, pero nadie lo bajaba
    # al retirar, así que la vista de % de uso seguía mostrando "Llena" con huecos libres.
    if box.is_full:
        box.is_full = False
    movement = Movement(
        sample_id=sample.id,
        action=MovementAction.THAW.value,
        date=payload.date,
        operator_id=operator.id,
        box_id=box.id,
        position=position,
        note=payload.note,
    )
    db.add(movement)
    db.commit()
    db.refresh(sample)
    db.refresh(movement)
    return MovementResult(sample=sample_with_location(sample), movement=MovementRead.model_validate(movement))


def _freeze(
    db: Session,
    *,
    rack: Rack,
    box: Box | None,
    position: str,
    box_type: str,
    operator: User,
    payload: MovementCreate,
) -> MovementResult:
    if box is None:
        ensure_box_number_within_capacity(rack, payload.box_number)
        box = Box(rack_id=rack.id, number=payload.box_number, box_type=box_type)
        db.add(box)
        db.flush()
    elif box.box_type != box_type:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"La caja {rack.letter}{box.number} ya es de tipo '{box.box_type}'",
        )

    active_in_box = (
        db.query(Sample).filter(Sample.box_id == box.id, Sample.status == SampleStatus.ACTIVE.value).all()
    )
    occupied = {sample.position for sample in active_in_box}
    if position in occupied:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": f"La posición {position} ya está ocupada",
                "next_free_position": next_free_position(box.box_type, occupied),
            },
        )

    owner = (
        get_or_create_user(db, NUCLEO_INITIALS, name="Núcleo Environ")
        if payload.is_core
        else get_or_create_user(db, payload.non_core_owner_initials)
    )

    if payload.box_is_full is not None:
        box.is_full = payload.box_is_full

    sample = Sample(
        environ_id=payload.environ_id,
        description=payload.description,
        type=payload.sample_type.value,
        type_other=payload.type_other,
        owner_id=owner.id,
        passage=payload.passage,
        is_core=payload.is_core,
        status=SampleStatus.ACTIVE.value,
        box_id=box.id,
        position=position,
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
        box_id=box.id,
        position=position,
        note=payload.note,
    )
    db.add(movement)
    db.commit()
    db.refresh(sample)
    db.refresh(movement)
    return MovementResult(sample=sample_with_location(sample), movement=MovementRead.model_validate(movement))

