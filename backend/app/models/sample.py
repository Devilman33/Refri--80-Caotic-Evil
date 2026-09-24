import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SampleType(str, enum.Enum):
    """Opciones del campo 'Tipo' del formulario (docs/FORMULARIO.md)."""

    VIAL_CELULAS = "vial_celulas"
    RNA = "rna"
    RNA_LATER = "rna_later"
    PROTEINAS = "proteinas"
    MEDIO_CONDICIONADO = "medio_condicionado"
    REACTIVO = "reactivo"
    PLASMA = "plasma"
    OTROS = "otros"


class SampleStatus(str, enum.Enum):
    ACTIVE = "active"
    WITHDRAWN = "withdrawn"


class Sample(Base):
    """Una muestra. Nunca se borra: retirar cambia `status` a `withdrawn`."""

    __tablename__ = "samples"
    __table_args__ = (
        CheckConstraint(
            "type in ('vial_celulas','rna','rna_later','proteinas',"
            "'medio_condicionado','reactivo','plasma','otros')",
            name="ck_samples_type",
        ),
        CheckConstraint("status in ('active', 'withdrawn')", name="ck_samples_status"),
        # Una sola muestra activa por posición dentro de una caja (regla no negociable,
        # ver .github/copilot-instructions.md). Las retiradas no cuentan.
        Index(
            "uq_samples_active_position",
            "box_id",
            "position",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    environ_id: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    type_other: Mapped[str | None] = mapped_column(String(120), nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    passage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_core: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=SampleStatus.ACTIVE.value)
    box_id: Mapped[int] = mapped_column(ForeignKey("boxes.id"), nullable=False)
    position: Mapped[str] = mapped_column(String(10), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship(foreign_keys=[owner_id])
    box: Mapped["Box"] = relationship(back_populates="samples")
    movements: Mapped[list["Movement"]] = relationship(back_populates="sample")

    def __repr__(self) -> str:  # pragma: no cover
        return f"Sample(id={self.id!r}, environ_id={self.environ_id!r}, status={self.status!r})"
