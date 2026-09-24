import enum

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RackSlot(str, enum.Enum):
    """El refri real solo tiene los racks del centro y de la derecha de cada estante
    (la posición izquierda del demo 3D no existe, ver docs/DATOS.md)."""

    CENTER = "center"
    RIGHT = "right"


class Rack(Base):
    """Rack que se extrae del estante. Letra A-H, único en todo el freezer."""

    __tablename__ = "racks"
    __table_args__ = (
        UniqueConstraint("section_id", "slot", name="uq_racks_section_slot"),
        CheckConstraint("slot in ('center', 'right')", name="ck_racks_slot"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id"), nullable=False)
    letter: Mapped[str] = mapped_column(String(1), unique=True)
    slot: Mapped[str] = mapped_column(String(10), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=30)

    section: Mapped["Section"] = relationship(back_populates="racks")
    boxes: Mapped[list["Box"]] = relationship(back_populates="rack")

    def __repr__(self) -> str:  # pragma: no cover
        return f"Rack(id={self.id!r}, letter={self.letter!r}, slot={self.slot!r})"
