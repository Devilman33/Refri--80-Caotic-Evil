from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import RackSlot


# A–H son los racks originales; un rack nuevo toma cualquier letra libre (parte 3).
VALID_RACK_LETTERS = {chr(letter) for letter in range(ord("A"), ord("Z") + 1)}


def _normalize_letter(value: str) -> str:
    letter = value.strip().upper()
    if letter not in VALID_RACK_LETTERS:
        raise ValueError(f"letter debe ser una letra entre A y Z, recibido {value!r}")
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


class RackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    section_id: int
    letter: str
    #: `None` cuando el rack está dado de baja: libera su lugar en el estante.
    slot: RackSlot | None
    capacity: int
    active: bool


class RackMoveCreate(BaseModel):
    """Llevar un rack a otro estante y/o lugar (centro/derecha). La letra no cambia."""

    section_code: str = Field(min_length=1, max_length=4)
    slot: RackSlot
    #: Si el lugar de destino está ocupado, intercambiar los dos racks.
    swap: bool = False
    date: date
    operator_initials: str = Field(min_length=1, max_length=10)
    note: str | None = Field(default=None, max_length=255)


class RackMoveResult(BaseModel):
    rack: RackRead
    #: El rack que estaba en el lugar de destino y pasó al lugar de origen, si hubo intercambio.
    swapped_with: RackRead | None = None
    moved_samples: int


class RackActivate(BaseModel):
    section_code: str = Field(min_length=1, max_length=4)
    slot: RackSlot
