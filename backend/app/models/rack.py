import enum

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RackSlot(str, enum.Enum):
    """El refri real solo tiene los racks del centro y de la derecha de cada estante
    (la posición izquierda del demo 3D no existe, ver docs/DATOS.md)."""

    CENTER = "center"
    RIGHT = "right"


class Rack(Base):
    """Rack que se extrae del estante. Una letra única en todo el freezer (A–H los
    originales; un rack nuevo toma una libre). Se da de baja con `active`, nunca se borra
    si tuvo muestras: su historial sigue apuntando a él."""

    __tablename__ = "racks"
    __table_args__ = (
        # DEFERRABLE para que el seed pueda permutar slots dentro de su transacción
        # (ver migración 0003). INITIALLY IMMEDIATE: la API sigue fallando en el instante.
        UniqueConstraint("section_id", "slot", name="uq_racks_section_slot", deferrable=True, initially="IMMEDIATE"),
        # Un rack dado de baja libera su lugar en el estante (migración 0007).
        CheckConstraint(
            "(active AND slot IN ('center', 'right')) OR (NOT active AND slot IS NULL)", name="ck_racks_slot"
        ),
        CheckConstraint("letter ~ '^[A-Z]$'", name="ck_racks_letter"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id"), nullable=False)
    letter: Mapped[str] = mapped_column(String(1), unique=True)
    slot: Mapped[str | None] = mapped_column(String(10), nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())

    section: Mapped["Section"] = relationship(back_populates="racks")
    boxes: Mapped[list["Box"]] = relationship(back_populates="rack")

    def __repr__(self) -> str:  # pragma: no cover
        return f"Rack(id={self.id!r}, letter={self.letter!r}, slot={self.slot!r})"
