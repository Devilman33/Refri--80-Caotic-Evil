from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import AnomalyStatus


class ImportRunRead(BaseModel):
    """Una corrida del importador con sus contadores."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_name: str
    started_at: datetime
    total_rows: int
    imported: int
    withdrawn: int
    skipped_already_imported: int
    skipped_invalid: int
    conflicts_resolved: int
    anomalies_count: int


class AnomalyRead(BaseModel):
    id: int
    row: int
    column: str
    #: Recortado: las celdas del Excel son texto libre y pueden traer nombres del personal.
    value: str
    reason: str
    status: AnomalyStatus
    resolved_by: str | None
    resolved_at: datetime | None


class AnomalyGroup(BaseModel):
    """Anomalías de un mismo motivo y columna. La unidad con la que se corrige."""

    reason: str
    column: str
    total: int
    pending: int


class AnomalyResolveRequest(BaseModel):
    """Marca un grupo entero (`reason`, opcionalmente acotado por `column`) o `ids` sueltos."""

    operator_initials: str = Field(min_length=1, max_length=10)
    status: AnomalyStatus = AnomalyStatus.RESOLVED
    reason: str | None = None
    column: str | None = None
    ids: list[int] | None = None

    @model_validator(mode="after")
    def _check_target(self) -> "AnomalyResolveRequest":
        if not self.ids and not self.reason:
            raise ValueError("Indicá 'ids' o 'reason'")
        return self


class AnomalyResolveResult(BaseModel):
    updated: int
    status: AnomalyStatus
