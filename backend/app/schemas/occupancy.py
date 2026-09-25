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
    rack_letter: str
    section_code: str
