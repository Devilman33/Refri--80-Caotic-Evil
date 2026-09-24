from pydantic import BaseModel, ConfigDict, Field

from app.models import RackSlot


class RackBase(BaseModel):
    section_id: int
    letter: str = Field(min_length=1, max_length=1)
    slot: RackSlot
    capacity: int = Field(default=30, gt=0)


class RackCreate(RackBase):
    pass


class RackUpdate(BaseModel):
    section_id: int | None = None
    letter: str | None = Field(default=None, min_length=1, max_length=1)
    slot: RackSlot | None = None
    capacity: int | None = Field(default=None, gt=0)


class RackRead(RackBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
