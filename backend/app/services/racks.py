from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Box, Rack, Sample, SampleStatus


def ensure_box_number_within_capacity(rack: Rack, number: int) -> None:
    """El número de caja no puede superar la cantidad de subcajas configurada
    para el rack (`Rack.capacity`, ver docs/DATOS.md)."""
    if number > rack.capacity:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"La caja {number} excede la capacidad del rack {rack.letter} ({rack.capacity})",
        )


def max_box_number(db: Session, rack_id: int) -> int | None:
    return db.query(func.max(Box.number)).filter(Box.rack_id == rack_id).scalar()


def active_sample_count(db: Session, *, rack_id: int | None = None, box_id: int | None = None) -> int:
    query = db.query(func.count(Sample.id)).filter(Sample.status == SampleStatus.ACTIVE.value)
    if box_id is not None:
        query = query.filter(Sample.box_id == box_id)
    if rack_id is not None:
        query = query.join(Box, Sample.box_id == Box.id).filter(Box.rack_id == rack_id)
    return query.scalar() or 0


def ensure_rack_active(rack: Rack) -> None:
    if not rack.active:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"El rack {rack.letter} está dado de baja: reactívalo primero"
        )


def reuse_box(db: Session, box: Box, box_type: str) -> None:
    """Una caja dada de baja vuelve a estar en uso cuando se pone una caja en su lugar.

    Se reutiliza la fila porque la ubicación es la misma (`III · F12`): el historial de la
    caja anterior sigue diciendo la verdad. Solo una caja dada de baja puede cambiar de
    tipo (la caja física nueva puede ser de otro material); una en uso es la que está ahí.
    """
    if box.box_type != box_type:
        if box.active or active_sample_count(db, box_id=box.id) > 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"La caja {box.rack.letter}{box.number} ya es de tipo '{box.box_type}'",
            )
        box.box_type = box_type
    box.active = True
