from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import RackSlot

VALID_RACK_LETTERS = {chr(letter) for letter in range(ord("A"), ord("H") + 1)}


def _normalize_letter(value: str) -> str:
    letter = value.strip().upper()
    if letter not in VALID_RACK_LETTERS:
        raise ValueError(f"letter debe ser una letra entre A y H, recibido {value!r}")
    return letter


class RackBase(BaseModel):
    section_id: int
    letter: str = Field(min_length=1, max_length=1)
    slot: RackSlot
    capacity: int = Field(default=20, gt=0)

    @field_validator("letter")
    @classmethod
    def _validate_letter(cls, value: str) -> str:
        return _normalize_letter(value)


class RackCreate(RackBase):
    pass


class RackUpdate(BaseModel):
    section_id: int | None = None
    letter: str | None = Field(default=None, min_length=1, max_length=1)
    slot: RackSlot | None = None
    capacity: int | None = Field(default=None, gt=0)

    @field_validator("letter")
    @classmethod
    def _validate_letter_update(cls, value: str | None) -> str | None:
        return _normalize_letter(value) if value is not None else None


class RackRead(RackBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
