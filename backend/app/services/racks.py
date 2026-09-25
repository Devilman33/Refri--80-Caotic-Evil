from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Box, Rack


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
