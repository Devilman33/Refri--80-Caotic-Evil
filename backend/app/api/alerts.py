from fastapi import APIRouter
from sqlalchemy.orm import joinedload

from app.api.deps import DbSession
from app.api.occupancy import _active_counts_by_box
from app.models import Box, Rack, Sample, SampleStatus, User
from app.schemas.alerts import AlertsRead
from app.schemas.occupancy import BoxOccupancy
from app.services.alerts import (
    UNASSIGNED_INITIALS,
    is_full,
    is_inconsistent_full,
    is_nearly_full,
)
from app.services.occupancy import box_capacity, percent
from app.services.owners import has_owner

router = APIRouter(prefix="/alerts", tags=["alertas"])


@router.get("", response_model=AlertsRead)
def alerts(db: DbSession) -> AlertsRead:
    """Lo que el laboratorio puede corregir hoy, en cuatro contadores.

    Reutiliza el conteo por caja de `/occupancy` en vez de recalcularlo: si los dos
    divergieran, el contador de alertas y la tabla de % de uso mostrarían números
    distintos para la misma cosa.

    Las muestras sin encargado se cuentan con una consulta directa. Podrían salir del
    constructor de filtros de la búsqueda, pero acá solo hace falta un `count()`: pasarlo
    por un armador de filtros que no se usa sería acoplar por reutilizar.
    """
    unassigned = (
        db.query(Sample)
        .filter(has_owner(UNASSIGNED_INITIALS), Sample.status == SampleStatus.ACTIVE.value)
        .count()
    )

    active_by_box = _active_counts_by_box(db)
    boxes: list[BoxOccupancy] = []
    for box in (
        db.query(Box).options(joinedload(Box.rack).joinedload(Rack.section)).order_by(Box.rack_id, Box.number).all()
    ):
        capacity = box_capacity(box.box_type)
        active = active_by_box.get(box.id, 0)
        boxes.append(
            BoxOccupancy(
                box_id=box.id,
                number=box.number,
                rack_id=box.rack_id,
                rack_letter=box.rack.letter,
                section_code=box.rack.section.code,
                box_type=box.box_type,
                is_full=box.is_full,
                active=active,
                capacity=capacity,
                percent=percent(active, capacity),
            )
        )

    flagged = [box for box in boxes if is_full(box) or is_nearly_full(box) or is_inconsistent_full(box)]

    return AlertsRead(
        unassigned_samples=unassigned,
        nearly_full_boxes=sum(1 for box in boxes if is_nearly_full(box)),
        full_boxes=sum(1 for box in boxes if is_full(box)),
        inconsistent_full_boxes=sum(1 for box in boxes if is_inconsistent_full(box)),
        boxes=flagged,
    )
