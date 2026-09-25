from pydantic import BaseModel, ConfigDict, Field

from app.models import BoxType


class BoxBase(BaseModel):
    rack_id: int
    number: int = Field(gt=0)
    box_type: BoxType
    label: str | None = Field(default=None, max_length=120)
    owner_id: int | None = None
    is_full: bool | None = None


class BoxCreate(BoxBase):
    pass


class BoxUpdate(BaseModel):
    number: int | None = Field(default=None, gt=0)
    box_type: BoxType | None = None
    label: str | None = Field(default=None, max_length=120)
    owner_id: int | None = None
    is_full: bool | None = None


class BoxRead(BoxBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class BoxPositionStatus(BaseModel):
    """Estado de una posición dentro de una caja, para las luces del visor."""

    position: str
    occupied: bool
    sample_id: int | None = None
    environ_id: str | None = None
    # Para pintar el warning de Núcleo en el tooltip del visor 3D sin otro round-trip.
    is_core: bool | None = None
