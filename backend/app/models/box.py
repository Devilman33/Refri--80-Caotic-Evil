import enum

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BoxType(str, enum.Enum):
    """Tipo de subcaja (ver 'Modelo físico' en docs/DATOS.md)."""

    CARTON_81 = "carton_81"
    PLASTIC_100 = "plastic_100"


class Box(Base):
    """Subcaja dentro de un rack: cartón 9x9 (posiciones 1A..9I) o plástica 10x10 (1..100)."""

    __tablename__ = "boxes"
    __table_args__ = (
        UniqueConstraint("rack_id", "number", name="uq_boxes_rack_number"),
        CheckConstraint("box_type in ('carton_81', 'plastic_100')", name="ck_boxes_box_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    rack_id: Mapped[int] = mapped_column(ForeignKey("racks.id"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    box_type: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    rack: Mapped["Rack"] = relationship(back_populates="boxes")
    owner: Mapped["User | None"] = relationship(foreign_keys=[owner_id])
    samples: Mapped[list["Sample"]] = relationship(back_populates="box")

    def __repr__(self) -> str:  # pragma: no cover
        return f"Box(id={self.id!r}, rack_id={self.rack_id!r}, number={self.number!r})"
