import enum
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MovementAction(str, enum.Enum):
    """Corresponde al campo 'Acción' del formulario (docs/FORMULARIO.md).

    Congelamiento = freeze (ingreso/reingreso), Descongelamiento = thaw (retiro).
    """

    FREEZE = "freeze"
    THAW = "thaw"


class Movement(Base):
    """Evento de trazabilidad sobre una muestra. Nunca se borra."""

    __tablename__ = "movements"
    __table_args__ = (CheckConstraint("action in ('freeze', 'thaw')", name="ck_movements_action"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    box_id: Mapped[int] = mapped_column(ForeignKey("boxes.id"), nullable=False)
    position: Mapped[str] = mapped_column(String(10), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sample: Mapped["Sample"] = relationship(back_populates="movements")
    operator: Mapped["User | None"] = relationship(foreign_keys=[operator_id])
    box: Mapped["Box"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"Movement(id={self.id!r}, sample_id={self.sample_id!r}, action={self.action!r})"
