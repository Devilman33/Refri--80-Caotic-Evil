from pydantic import BaseModel, ConfigDict, Field


class UserBase(BaseModel):
    initials: str = Field(min_length=1, max_length=10)
    name: str | None = Field(default=None, max_length=120)
    active: bool = True


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    initials: str | None = Field(default=None, min_length=1, max_length=10)
    name: str | None = Field(default=None, max_length=120)
    active: bool | None = None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
