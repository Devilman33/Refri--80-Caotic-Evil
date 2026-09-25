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
        if not self.environ_id or not self.environ_id.strip():
            raise ValueError("environ_id es obligatorio para un congelamiento")
        if self.sample_type is None:
            raise ValueError("sample_type es obligatorio para un congelamiento")
        if self.sample_type == SampleType.OTROS and not (self.type_other and self.type_other.strip()):
            raise ValueError("type_other es obligatorio cuando sample_type es 'otros'")
        if self.is_core is None:
            raise ValueError("is_core es obligatorio para un congelamiento")
        if self.is_core is False and not self.non_core_owner_initials:
            raise ValueError("non_core_owner_initials es obligatorio cuando is_core es false")
        if self.box_is_full is None:
            raise ValueError("box_is_full es obligatorio para un congelamiento")
        return self


class SampleMoveCreate(BaseModel):
    """Traslado de una muestra: se direcciona por `sample.id`, no por posición.

    Es la diferencia con `POST /movements`, que identifica la muestra por dónde está
    porque así funciona el Google Form. Acá ya sabemos cuál es, y `environ_id` NO sirve
    para identificarla: un mismo ID cubre hasta cientos de tubos (docs/DATOS.md).
    """

    date: date
    operator_initials: str = Field(min_length=1, max_length=10)
    rack_letter: str = Field(min_length=1, max_length=1)
    box_number: int = Field(gt=0)
    position: str = Field(min_length=1, max_length=10)
    note: str | None = Field(default=None, max_length=255)


class MovementRead(BaseModel):
    """Un evento del historial.

    `operator_initials` se deriva de la relación `Movement.operator`: la regla de dominio
    exige registrar *quién* retiró una muestra (ver .github/copilot-instructions.md), y el
    id numérico solo no deja mostrarlo. Los movimientos que vienen del importador no tienen
    operador (el Excel histórico no lo traía) y quedan en `None`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    sample_id: int
    action: MovementAction
    date: date
    operator_id: int | None
    operator_initials: str | None = None
    box_id: int
    position: str
    #: Ubicación legible del evento, p. ej. `III · F12 · 3B`.
    location: str | None = None
    #: Origen de un traslado. `None` en congelamientos y descongelamientos.
    from_box_id: int | None = None
    from_position: str | None = None
    from_location: str | None = None
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
