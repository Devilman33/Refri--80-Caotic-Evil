from pydantic import BaseModel


class FreezerOccupancy(BaseModel):
    active: int
    capacity: int
    percent: float


class SectionOccupancy(FreezerOccupancy):
    section_id: int
    code: str


class RackOccupancy(FreezerOccupancy):
    rack_id: int
    letter: str
    section_code: str


class BoxOccupancy(FreezerOccupancy):
    box_id: int
    number: int
    rack_id: int
    rack_letter: str
    section_code: str
    box_type: str
    # "Caja Completa" declarada en el formulario (puede diferir del % calculado).
    is_full: bool | None = None
