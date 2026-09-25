from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import SampleStatus, SampleType


def check_type_other(sample_type: SampleType, type_other: str | None) -> None:
    if sample_type == SampleType.OTROS and not (type_other and type_other.strip()):
        raise ValueError("type_other es obligatorio cuando type es 'otros'")


class SampleBase(BaseModel):
    environ_id: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=255)
    type: SampleType
    type_other: str | None = Field(default=None, max_length=120)
    #: Encargados: una muestra puede tener varios (en el Excel, `AS/MN`).
    owner_ids: list[int] = Field(min_length=1)
    passage: int | None = None
    is_core: bool | None = None
    box_id: int
    position: str = Field(min_length=1, max_length=10)
    notes: str | None = None


class SampleCreate(SampleBase):
    """Alta directa de una muestra activa. Registra también el movimiento de
    congelamiento (igual que `POST /movements`) para no romper la trazabilidad."""

    operator_initials: str = Field(min_length=1, max_length=10)
    date: date
    note: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _check_type_other(self) -> "SampleCreate":
        check_type_other(self.type, self.type_other)
        return self


class SampleUpdate(BaseModel):
    """Solo permite editar los datos descriptivos de la muestra.

    Ubicación y estado cambian a través de `POST /movements`, para no romper la
    trazabilidad (ver .github/copilot-instructions.md).
    """

    environ_id: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=255)
    type: SampleType | None = None
    type_other: str | None = Field(default=None, max_length=120)
    owner_ids: list[int] | None = None
    passage: int | None = None
    is_core: bool | None = None
    notes: str | None = None


class SampleRead(SampleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: SampleStatus
    created_at: datetime
    updated_at: datetime


class IdLookupResult(BaseModel):
    """Resultado de buscar una lista de IDs pegada o escaneada.

    `missing` lo calcula el SERVIDOR, no el cliente. Si el diff se hiciera en el frontend
    contra la página recibida, pegar 400 IDs existentes devolvería como máximo `page_size`
    resultados (200) y la UI reportaría ~200 "no encontrados" fantasma — justo la pregunta
    que esta feature existe para responder, contestada mal.
    """

    items: list["SampleWithLocation"]
    total: int
    #: Los IDs pedidos que no tienen ninguna muestra, en el orden en que se pegaron.
    missing: list[str]


class SampleWithLocation(SampleRead):
    """`SampleRead` más la ubicación legible, p. ej. `III · F12 · 3B`."""

    location: str


IdLookupResult.model_rebuild()
