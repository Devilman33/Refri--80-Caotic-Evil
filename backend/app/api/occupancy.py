from fastapi import APIRouter
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import DbSession
from app.models import Box, Rack, Sample, SampleStatus, Section
from app.schemas.occupancy import BoxOccupancy, FreezerOccupancy, RackOccupancy, SectionOccupancy
from app.services.occupancy import box_capacity, percent

router = APIRouter(prefix="/occupancy", tags=["ocupación"])


def _active_counts_by_box(db: Session) -> dict[int, int]:
    rows = (
        db.query(Sample.box_id, func.count(Sample.id))
        .filter(Sample.status == SampleStatus.ACTIVE.value)
        .group_by(Sample.box_id)
        .all()
    )
    return dict(rows)


@router.get("/freezer", response_model=FreezerOccupancy)
def freezer_occupancy(db: DbSession) -> FreezerOccupancy:
    """% de uso del freezer completo (activas / capacidad de todas las cajas)."""
    boxes = db.query(Box).all()
    active_by_box = _active_counts_by_box(db)
    capacity = sum(box_capacity(box.box_type) for box in boxes)
    active = sum(active_by_box.get(box.id, 0) for box in boxes)
    return FreezerOccupancy(active=active, capacity=capacity, percent=percent(active, capacity))


@router.get("/sections", response_model=list[SectionOccupancy])
def sections_occupancy(db: DbSession) -> list[SectionOccupancy]:
    """% de uso por sección (I-IV)."""
    active_by_box = _active_counts_by_box(db)
    sections = db.query(Section).options(joinedload(Section.racks).joinedload(Rack.boxes)).order_by(Section.code)
    results = []
    for section in sections:
        boxes = [box for rack in section.racks for box in rack.boxes]
        capacity = sum(box_capacity(box.box_type) for box in boxes)
        active = sum(active_by_box.get(box.id, 0) for box in boxes)
        results.append(
            SectionOccupancy(
                section_id=section.id, code=section.code, active=active, capacity=capacity, percent=percent(active, capacity)
            )
        )
    return results


@router.get("/racks", response_model=list[RackOccupancy])
def racks_occupancy(db: DbSession, section_code: str | None = None) -> list[RackOccupancy]:
    """% de uso por rack, opcionalmente filtrado por sección."""
    active_by_box = _active_counts_by_box(db)
    query = db.query(Rack).options(joinedload(Rack.boxes), joinedload(Rack.section))
    if section_code:
        query = query.join(Section).filter(Section.code == section_code.strip().upper())
    results = []
    for rack in query.order_by(Rack.letter).all():
        capacity = sum(box_capacity(box.box_type) for box in rack.boxes)
        active = sum(active_by_box.get(box.id, 0) for box in rack.boxes)
        results.append(
            RackOccupancy(
                rack_id=rack.id,
                letter=rack.letter,
                section_code=rack.section.code,
                active=active,
                capacity=capacity,
                percent=percent(active, capacity),
            )
        )
    return results


@router.get("/boxes", response_model=list[BoxOccupancy])
def boxes_occupancy(db: DbSession, rack_letter: str | None = None) -> list[BoxOccupancy]:
    """% de uso por subcaja, opcionalmente filtrado por rack."""
    active_by_box = _active_counts_by_box(db)
    query = db.query(Box).options(joinedload(Box.rack).joinedload(Rack.section))
    if rack_letter:
        query = query.join(Rack).filter(Rack.letter == rack_letter.strip().upper())
    results = []
    for box in query.order_by(Box.rack_id, Box.number).all():
        capacity = box_capacity(box.box_type)
        active = active_by_box.get(box.id, 0)
        results.append(
            BoxOccupancy(
                box_id=box.id,
                number=box.number,
                rack_letter=box.rack.letter,
                section_code=box.rack.section.code,
                active=active,
                capacity=capacity,
                percent=percent(active, capacity),
            )
        )
    return results
