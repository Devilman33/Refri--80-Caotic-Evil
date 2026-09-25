from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession
from app.importer.cleaning import parse_posicion
from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, User
from app.schemas.movement import MovementCreate, MovementRead, MovementResult, PositionConflict, ThawBatchCreate
from app.services.location import sample_with_location
from app.services.occupancy import refresh_box_full
from app.services.positions import next_free_position
from app.services.racks import ensure_box_number_within_capacity, ensure_rack_active, reuse_box
from app.services.users import get_or_create_user

router = APIRouter(prefix="/movements", tags=["movimientos"])


@router.post(
    "",
    response_model=MovementResult,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_409_CONFLICT: {"model": PositionConflict}},
)
def create_movement(payload: MovementCreate, db: DbSession, current_user: CurrentUser) -> MovementResult:
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

    if payload.action == MovementAction.FREEZE:
        ensure_rack_active(rack)

    if payload.action == MovementAction.THAW:
        return _thaw(db, box=box, position=position, operator=operator, payload=payload, current_user=current_user)
    return _freeze(
        db, rack=rack, box=box, position=position, box_type=inferred_box_type, operator=operator, payload=payload
    )


def _thaw(
    db: Session, *, box: Box | None, position: str, operator: User, payload: MovementCreate, current_user: User
) -> MovementResult:
    if box is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caja no encontrada")
    sample = (
        db.query(Sample)
        .filter(Sample.box_id == box.id, Sample.position == position, Sample.status == SampleStatus.ACTIVE.value)
        .one_or_none()
    )
    if sample is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No hay una muestra activa en esa posición")
    # Retirar lo puede hacer cualquier persona identificada (parte 3): quien está frente al
    # freezer saca lo que le piden. Editar y trasladar siguen siendo de los encargados.

    sample.status = SampleStatus.WITHDRAWN.value
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
    refresh_box_full(db, box)
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
        # Dos congelamientos simultáneos en una caja que todavía no existe: los dos llegan
        # acá con `box is None` y uno viola `uq_boxes_rack_number`. Antes eso salía como un
        # 500 al operador.
        #
        # El SAVEPOINT importa: un `db.rollback()` completo también descartaría el INSERT
        # del operador que `get_or_create_user` ya flusheó más arriba, y como
        # `movements.operator_id` es nullable el evento saldría SIN operador — o sea un 201
        # que incumple en silencio la regla de registrar quién, y que además se mostraría
        # como "importado" en el historial. `begin_nested` deshace solo la caja.
        try:
            with db.begin_nested():
                box = Box(rack_id=rack.id, number=payload.box_number, box_type=box_type)
                db.add(box)
                db.flush()
        except IntegrityError:
            box = (
                db.query(Box)
                .filter(Box.rack_id == rack.id, Box.number == payload.box_number)
                .one_or_none()
            )
            if box is None:  # pragma: no cover - la caja existía al fallar el INSERT
                raise
            if box.box_type != box_type:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"La caja {rack.letter}{box.number} ya es de tipo '{box.box_type}'",
                ) from None
    else:
        reuse_box(db, box, box_type)

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

    # Núcleo es una marca sobre la muestra, no su encargado: los encargados son siempre
    # personas (una o varias), sea o no de Núcleo.
    owners = [get_or_create_user(db, initials) for initials in dict.fromkeys(payload.owner_initials)]

    sample = Sample(
        environ_id=payload.environ_id,
        description=payload.description,
        type=payload.sample_type.value,
        type_other=payload.type_other,
        owners=owners,
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
    refresh_box_full(db, box)
    db.commit()
    db.refresh(sample)
    db.refresh(movement)
    return MovementResult(sample=sample_with_location(sample), movement=MovementRead.model_validate(movement))



@router.post("/thaw-batch", response_model=list[MovementResult], status_code=status.HTTP_201_CREATED)
def thaw_batch(payload: ThawBatchCreate, db: DbSession, current_user: CurrentUser) -> list[MovementResult]:
    """Retira varias muestras de una vez: todas o ninguna.

    Se direcciona por id de muestra (la grilla y la búsqueda ya la conocen), no por
    posición: con varias cajas en juego, "caja + posición" repetido por cada una sería
    pedir lo mismo muchas veces. Cada muestra deja su propio evento de retiro.
    """
    ids = list(dict.fromkeys(payload.sample_ids))
    samples = db.query(Sample).filter(Sample.id.in_(ids)).with_for_update().all()
    by_id = {sample.id: sample for sample in samples}
    missing = [sample_id for sample_id in ids if sample_id not in by_id]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Muestras no encontradas: {missing}")
    withdrawn = [sample_id for sample_id in ids if by_id[sample_id].status != SampleStatus.ACTIVE.value]
    if withdrawn:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Estas muestras ya estaban retiradas: {withdrawn}"
        )

    operator = get_or_create_user(db, payload.operator_initials)
    movements = []
    for sample_id in ids:
        sample = by_id[sample_id]
        sample.status = SampleStatus.WITHDRAWN.value
        movement = Movement(
            sample_id=sample.id,
            action=MovementAction.THAW.value,
            date=payload.date,
            operator_id=operator.id,
            box_id=sample.box_id,
            position=sample.position,
            note=payload.note,
        )
        db.add(movement)
        movements.append(movement)
    for box in {sample.box for sample in samples}:
        refresh_box_full(db, box)
    db.commit()
    results = []
    for sample_id, movement in zip(ids, movements):
        db.refresh(by_id[sample_id])
        db.refresh(movement)
        results.append(
            MovementResult(sample=sample_with_location(by_id[sample_id]), movement=MovementRead.model_validate(movement))
        )
    return results
