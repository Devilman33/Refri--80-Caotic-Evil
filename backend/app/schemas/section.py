from pydantic import BaseModel, ConfigDict, field_validator

VALID_SECTION_CODES = {"I", "II", "III", "IV"}


def _normalize_code(value: str) -> str:
    code = value.strip().upper()
    if code not in VALID_SECTION_CODES:
        raise ValueError(f"code debe ser uno de {sorted(VALID_SECTION_CODES)}")
    return code


class SectionBase(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def _validate_code(cls, value: str) -> str:
        return _normalize_code(value)


class SectionCreate(SectionBase):
    pass


class SectionUpdate(BaseModel):
    code: str | None = None

    @field_validator("code")
    @classmethod
    def _validate_code(cls, value: str | None) -> str | None:
        return _normalize_code(value) if value is not None else None


class SectionRead(SectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
