from pydantic import BaseModel

from app.models import SampleType


class AutocompleteSuggestion(BaseModel):
    """Sugerencias para autorellenar el formulario a partir de un ID Environ y/o
    encargado ya existente (docs/FORMULARIO.md: "Autocompletado (QOL)")."""

    environ_id: str | None = None
    description: str | None = None
    sample_type: SampleType | None = None
    type_other: str | None = None
    passage: int | None = None
    is_core: bool | None = None
    owner_initials: str | None = None
    rack_letter: str | None = None
    box_number: int | None = None
    box_id: int | None = None
    next_free_position: str | None = None
