from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class UserCreate(BaseModel):
    """Registro de una persona. Basta con el nombre completo o con las iniciales; con
    las dos, las iniciales son las que se usan en el Excel y el Google Form."""

    initials: str | None = Field(default=None, max_length=10)
    name: str | None = Field(default=None, max_length=120)
    active: bool = True

    @model_validator(mode="after")
    def _check_identity(self) -> "UserCreate":
        has_initials = bool(self.initials and self.initials.strip())
        has_name = bool(self.name and self.name.strip())
        if not has_initials and not has_name:
            raise ValueError("Indica el nombre completo (o al menos las iniciales)")
        if self.initials is not None and not has_initials:
            self.initials = None
        return self


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
