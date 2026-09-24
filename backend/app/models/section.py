from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Section(Base):
    """Estante del freezer: I, II, III o IV (ver 'Modelo físico' en docs/DATOS.md)."""

    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(4), unique=True)

    racks: Mapped[list["Rack"]] = relationship(back_populates="section")

    def __repr__(self) -> str:  # pragma: no cover
        return f"Section(id={self.id!r}, code={self.code!r})"
