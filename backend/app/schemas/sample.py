from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import SampleStatus, SampleType


class SampleBase(BaseModel):
    environ_id: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=255)
    type: SampleType
    type_other: str | None = Field(default=None, max_length=120)
    owner_id: int
    passage: int | None = None
    is_core: bool | None = None
    box_id: int
    position: str = Field(min_length=1, max_length=10)
    notes: str | None = None


class SampleCreate(SampleBase):
    pass


class SampleUpdate(BaseModel):
    """Solo permite editar los datos descriptivos de la muestra.

    Ubicación y estado cambian a través de `POST /movements`, para no romper la
    trazabilidad (ver .github/copilot-instructions.md).
    """

    environ_id: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=255)
    type: SampleType | None = None
    type_other: str | None = Field(default=None, max_length=120)
    owner_id: int | None = None
    passage: int | None = None
    is_core: bool | None = None
    notes: str | None = None


class SampleRead(SampleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: SampleStatus
    created_at: datetime
    updated_at: datetime


class SampleWithLocation(SampleRead):
    """`SampleRead` más la ubicación legible, p. ej. `III · F12 · 3B`."""

    location: str
