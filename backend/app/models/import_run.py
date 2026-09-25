import enum
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AnomalyStatus(str, enum.Enum):
    """Estado de triage de una anomalía."""

    PENDING = "pending"
    RESOLVED = "resolved"
    #: Revisada y se decide dejarla así (p. ej. un pasaje que de verdad no existe).
    ACCEPTED = "accepted"


class ImportRun(Base):
    """Una corrida del importador.

    Guarda los contadores del `ImportSummary`, así que dos corridas seguidas responden
    "¿mejoró el Excel del laboratorio desde la última vez?" — la única métrica de calidad
    de datos que a este proyecto le importa, y sale gratis de lo que ya se calculaba.
    """

    __tablename__ = "import_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Hash sha256 del contenido, no el nombre: el mismo archivo renombrado es el mismo
    #: origen, y dos workbooks distintos con el mismo nombre no lo son.
    source_file: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    #: Nombre con el que se importó, solo para mostrarlo.
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    withdrawn: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_already_imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_invalid: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    conflicts_resolved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    anomalies_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    anomalies: Mapped[list["ImportAnomaly"]] = relationship(back_populates="run", cascade="all, delete-orphan")

    def __repr__(self) -> str:  # pragma: no cover
        return f"ImportRun(id={self.id!r}, source_name={self.source_name!r})"


class ImportAnomaly(Base):
    """Una fila del Excel que el importador no pudo interpretar como esperaba.

    Misma estructura que el CSV que el importador ya escribía (fila, columna, valor
    original, motivo), más el estado de triage: una lista de solo lectura de miles de
    anomalías es una hoja de cálculo en una página web, y nadie la corrige.
    """

    __tablename__ = "import_anomalies"
    __table_args__ = (
        CheckConstraint("status in ('pending', 'resolved', 'accepted')", name="ck_import_anomalies_status"),
        # La vista agrupa por motivo por defecto, y una corrida del Excel real puede traer
        # miles de filas.
        Index("ix_import_anomalies_run_reason", "run_id", "reason"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("import_runs.id"), nullable=False)
    row: Mapped[int] = mapped_column(Integer, nullable=False)
    column: Mapped[str] = mapped_column(String(60), nullable=False)
    #: Valor tal como venía en el Excel. Se sirve truncado: puede traer texto libre con
    #: nombres del personal (ver docs/DATOS.md, "Propietario de Caja").
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reason: Mapped[str] = mapped_column(String(120), nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=AnomalyStatus.PENDING.value)
    resolved_by: Mapped[str | None] = mapped_column(String(10), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped["ImportRun"] = relationship(back_populates="anomalies")

    def __repr__(self) -> str:  # pragma: no cover
        return f"ImportAnomaly(row={self.row!r}, column={self.column!r}, reason={self.reason!r})"
