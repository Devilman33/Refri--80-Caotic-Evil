import enum
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, Text, event, func, select
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MovementAction(str, enum.Enum):
    """Los tres eventos que registra la tabla.

    Congelamiento = freeze (ingreso/reingreso), Descongelamiento = thaw (retiro),
    Traslado = move. Los dos primeros son los del formulario (docs/FORMULARIO.md); el
    traslado no está en el Google Form porque ahí no existía, pero
    .github/copilot-instructions.md sí lo lista como movimiento.

    OJO al agregar un valor nuevo acá: `POST /movements` solo implementa freeze y thaw, y
    el desplegable del formulario NO se deriva de este enum justamente por eso.
    """

    FREEZE = "freeze"
    THAW = "thaw"
    MOVE = "move"
    #: Reingreso: una muestra retirada vuelve al freezer (la misma fila, con su historial).
    RETURN = "return"


class Movement(Base):
    """Evento de trazabilidad sobre una muestra. Nunca se borra."""

    __tablename__ = "movements"
    __table_args__ = (
        CheckConstraint("action in ('freeze', 'thaw', 'move', 'return')", name="ck_movements_action"),
        # Un traslado sin origen no registra nada: la garantía va en la base y no solo en
        # la aplicación, porque es la que no se puede saltear por un bug.
        CheckConstraint(
            "action <> 'move' OR (from_box_id IS NOT NULL AND from_position IS NOT NULL)",
            name="ck_movements_move_origin",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    box_id: Mapped[int] = mapped_column(ForeignKey("boxes.id"), nullable=False)
    position: Mapped[str] = mapped_column(String(10), nullable=False)
    # Solo en los traslados. Con origen y destino en la misma fila, el historial muestra
    # "III · F12 · 3B → I · A4 · 1A" sin recorrer la cadena de eventos hacia atrás.
    from_box_id: Mapped[int | None] = mapped_column(ForeignKey("boxes.id"), nullable=True)
    from_position: Mapped[str | None] = mapped_column(String(10), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Sección donde ocurrió el evento, fijada al registrarlo. Un rack puede cambiar de
    # estante: armar la ubicación con la sección ACTUAL reescribiría la historia.
    section_code: Mapped[str | None] = mapped_column(String(4), nullable=True)
    from_section_code: Mapped[str | None] = mapped_column(String(4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sample: Mapped["Sample"] = relationship(back_populates="movements")
    operator: Mapped["User | None"] = relationship(foreign_keys=[operator_id])
    box: Mapped["Box"] = relationship(foreign_keys=[box_id])
    from_box: Mapped["Box | None"] = relationship(foreign_keys=[from_box_id])

    @property
    def location(self) -> str:
        """Ubicación legible del evento, p. ej. `III · F12 · 3B`.

        Va como property del modelo y no armada en el endpoint porque `MovementRead` la
        lee con `from_attributes`. Sin esto, el historial solo tenía `box_id` y la UI no
        podía mostrar de dónde a dónde se movió una muestra.
        """
        return f"{self.box.location_label_in(self.section_code)} · {self.position}"

    @property
    def from_location(self) -> str | None:
        """Origen de un traslado. `None` en congelamientos y descongelamientos."""
        if self.from_box is None or self.from_position is None:
            return None
        return f"{self.from_box.location_label_in(self.from_section_code)} · {self.from_position}"

    @property
    def operator_initials(self) -> str | None:
        """Iniciales de quien registró el evento, o `None` si vino del importador.

        `MovementRead` la lee con `from_attributes`. La regla de dominio exige registrar
        *quién* retiró una muestra; el `operator_id` numérico solo no deja mostrarlo.
        """
        return self.operator.initials if self.operator is not None else None

    def __repr__(self) -> str:  # pragma: no cover
        return f"Movement(id={self.id!r}, sample_id={self.sample_id!r}, action={self.action!r})"


def _section_of_box(connection, box_id: int | None) -> str | None:
    if box_id is None:
        return None
    from app.models.box import Box
    from app.models.rack import Rack
    from app.models.section import Section

    return connection.execute(
        select(Section.code)
        .join(Rack, Rack.section_id == Section.id)
        .join(Box, Box.rack_id == Rack.id)
        .where(Box.id == box_id)
    ).scalar()


@event.listens_for(Movement, "before_insert")
def _snapshot_sections(mapper, connection, target: Movement) -> None:  # noqa: ARG001
    """Fija la sección del evento al registrarlo, sea cual sea el camino que lo crea
    (formulario, traslados, importador). Quien ya la trae (mover un rack) la respeta."""
    if target.section_code is None:
        target.section_code = _section_of_box(connection, target.box_id)
    if target.from_section_code is None and target.from_box_id is not None:
        target.from_section_code = _section_of_box(connection, target.from_box_id)
