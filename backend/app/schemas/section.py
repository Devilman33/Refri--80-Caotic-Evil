from pydantic import BaseModel, ConfigDict, Field


class SectionBase(BaseModel):
    code: str = Field(min_length=1, max_length=4)


class SectionCreate(SectionBase):
    pass


class SectionUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=4)


class SectionRead(SectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
