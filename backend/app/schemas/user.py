from pydantic import BaseModel, ConfigDict, Field, field_validator


def _validate_initials(value: str) -> str:
    if not value.strip():
        raise ValueError("initials no puede estar vacío o ser solo espacios")
    return value


class UserBase(BaseModel):
    initials: str = Field(min_length=1, max_length=10)
    name: str | None = Field(default=None, max_length=120)
    active: bool = True

    @field_validator("initials")
    @classmethod
    def _check_initials(cls, value: str) -> str:
        return _validate_initials(value)


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    initials: str | None = Field(default=None, min_length=1, max_length=10)
    name: str | None = Field(default=None, max_length=120)
    active: bool | None = None

    @field_validator("initials")
    @classmethod
    def _check_initials_update(cls, value: str | None) -> str | None:
        return _validate_initials(value) if value is not None else None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
