from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession, get_or_404
from app.models import Box, Rack, Sample, Section
from app.schemas.section import SectionCreate, SectionRead, SectionUpdate

router = APIRouter(prefix="/sections", tags=["secciones"])

_DUPLICATE_MESSAGE = "Ya existe una sección con ese código"


@router.post("", response_model=SectionRead, status_code=status.HTTP_201_CREATED)
def create_section(payload: SectionCreate, db: DbSession) -> Section:
    section = Section(code=payload.code.strip().upper())
    db.add(section)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(section)
    return section


@router.get("", response_model=list[SectionRead])
def list_sections(db: DbSession) -> list[Section]:
    return db.query(Section).order_by(Section.code).all()


@router.get("/{section_id}", response_model=SectionRead)
def get_section(section_id: int, db: DbSession) -> Section:
    return get_or_404(db, Section, section_id, "Sección no encontrada")


@router.patch("/{section_id}", response_model=SectionRead)
def update_section(section_id: int, payload: SectionUpdate, db: DbSession) -> Section:
    section = get_or_404(db, Section, section_id, "Sección no encontrada")
    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] is not None:
        data["code"] = data["code"].strip().upper()
    if data.get("code") is not None and data["code"] != section.code:
        has_samples = (
            db.query(Sample)
            .join(Box, Sample.box_id == Box.id)
            .join(Rack, Box.rack_id == Rack.id)
            .filter(Rack.section_id == section.id)
            .first()
            is not None
        )
        if has_samples:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "No se puede cambiar el código de una sección que ya tiene muestras asociadas",
            )
    for field, value in data.items():
        setattr(section, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(section)
    return section


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(section_id: int, db: DbSession) -> None:
    section = get_or_404(db, Section, section_id, "Sección no encontrada")
    db.delete(section)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "No se puede eliminar: la sección tiene racks asociados"
        ) from exc
