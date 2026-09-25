from sqlalchemy import CheckConstraint, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Section(Base):
    """Estante del freezer: I, II, III o IV (ver 'Modelo físico' en docs/DATOS.md)."""

    __tablename__ = "sections"
    # La API ya valida esto en `SectionCreate`; el CHECK cubre el camino ORM, que es por
    # donde entra el seed leyendo `layout.yaml` sin pasar por Pydantic.
    __table_args__ = (CheckConstraint("code in ('I', 'II', 'III', 'IV')", name="ck_sections_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(4), unique=True)

    racks: Mapped[list["Rack"]] = relationship(back_populates="section")

    def __repr__(self) -> str:  # pragma: no cover
        return f"Section(id={self.id!r}, code={self.code!r})"
