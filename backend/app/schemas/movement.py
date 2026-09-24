from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import MovementAction, SampleType
from app.schemas.sample import SampleWithLocation


class MovementCreate(BaseModel):
    """Campos del formulario de movimientos (docs/FORMULARIO.md).

    `rack_letter` + `box_number` corresponden al campo "Nombre Caja (Letra rack y
    N° de caja)"; el frontend es responsable de partir el texto combinado (p. ej.
    `A12`) en estos dos campos. `position` acepta tanto la grilla de la caja de
    cartón (`1A`..`9I`) como el número de la caja plástica (`1`..`100`); el tipo de
    caja se infiere del formato, igual que en el importador.
    """

    action: MovementAction
    date: date
    operator_initials: str = Field(min_length=1, max_length=10)

    rack_letter: str = Field(min_length=1, max_length=1)
    box_number: int = Field(gt=0)
    position: str = Field(min_length=1, max_length=10)

    environ_id: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=255)
    sample_type: SampleType | None = None
    type_other: str | None = Field(default=None, max_length=120)
    passage: int | None = None
    is_core: bool | None = None
    non_core_owner_initials: str | None = Field(default=None, max_length=10)
    box_is_full: bool | None = None
    note: str | None = None

    @model_validator(mode="after")
    def _check_required_for_freeze(self) -> "MovementCreate":
        if self.action != MovementAction.FREEZE:
            return self
        if self.sample_type is None:
            raise ValueError("sample_type es obligatorio para un congelamiento")
        if self.sample_type == SampleType.OTROS and not self.type_other:
            raise ValueError("type_other es obligatorio cuando sample_type es 'otros'")
        if self.is_core is None:
            raise ValueError("is_core es obligatorio para un congelamiento")
        if self.is_core is False and not self.non_core_owner_initials:
            raise ValueError("non_core_owner_initials es obligatorio cuando is_core es false")
        return self


class MovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sample_id: int
    action: MovementAction
    date: date
    operator_id: int | None
    box_id: int
    position: str
    note: str | None
    created_at: datetime


class MovementResult(BaseModel):
    """Respuesta de `POST /movements`: la muestra resultante y el evento creado."""

    sample: SampleWithLocation
    movement: MovementRead


class PositionConflict(BaseModel):
    """Cuerpo del 409 cuando la posición ya está ocupada por una muestra activa."""

    message: str
    next_free_position: str | None
