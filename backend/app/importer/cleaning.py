"""Reglas de limpieza de la hoja `Inventario-80` (ver docs/DATOS.md).

Cada función es pura: recibe el valor crudo de una celda y devuelve el valor
normalizado junto con un motivo de anomalía (`None` si no hay nada que reportar).
Mantenerlas puras permite testearlas sin Excel ni base de datos.
"""

from __future__ import annotations

import re
from datetime import date, datetime

_ACCENTS = str.maketrans("áéíóúÁÉÍÓÚñÑ", "aeiouAEIOUnN")

_TIPO_MAP = {
    "medio condicionado": "medio_condicionado",
    "mc": "medio_condicionado",
    "rna later": "rna_later",
    "rna": "rna",
    "vial": "vial_celulas",
    "vial de celulas": "vial_celulas",
    "proteinas": "proteinas",
    "reactivo": "reactivo",
    "plasma": "plasma",
    "otros": "otros",
}
_LINEA_CELULAR = {"linea celular", "lineas celulares"}

_SECCION_VALIDAS = {"I", "II", "III", "IV"}
_SECCION_LEGACY = {"1": "I", "2": "II", "3": "III", "4": "IV"}

_RACK_LETRAS = set("ABCDEFGH")

_CARTON_RE = re.compile(r"^([1-9])([A-Ia-i])$")
_DATE_RE = re.compile(r"(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})")
_INITIALS_RE = re.compile(r"\b([A-ZÑ]{2,5})\b")

_DATE_FORMATS = (
    "%d-%m-%Y",
    "%d-%m-%y",
    "%d/%m/%Y",
    "%d/%m/%y",
    "%d.%m.%Y",
    "%d.%m.%y",
)

_MIN_YEAR = 1990


def _unaccent_lower(text: str) -> str:
    return text.translate(_ACCENTS).lower()


def clean_text(raw: object) -> str | None:
    """Texto libre: recorta espacios; `-` o vacío se trata como ausente."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text == "-":
        return None
    return text


def clean_environ_id(raw: object) -> tuple[str | None, str | None]:
    text = clean_text(raw)
    if text is None:
        return None, "ID Environ vacío"
    return text, None


def clean_tipo(raw: object) -> tuple[str | None, str | None, str | None]:
    """Devuelve (sample_type, type_other, motivo)."""
    text = clean_text(raw)
    if text is None:
        return None, None, "Tipo vacío"

    key = re.sub(r"\s+", " ", _unaccent_lower(text)).replace("-", " ").strip()
    if key in _LINEA_CELULAR:
        return "otros", "Línea celular", None

    mapped = _TIPO_MAP.get(key)
    if mapped:
        return mapped, None, None

    return "otros", text, "Tipo no reconocido, se guardó en 'Otros'"


def parse_si_no(raw: object) -> bool | None:
    text = clean_text(raw)
    if text is None:
        return None
    key = _unaccent_lower(text)
    if key == "si":
        return True
    if key == "no":
        return False
    return None


def parse_pasaje(raw: object) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        try:
            return int(raw)
        except (ValueError, OverflowError):
            return None
    text = clean_text(raw)
    if text is None:
        return None
    if text.isdigit():
        return int(text)
    return None


def parse_seccion(raw: object) -> tuple[str | None, str | None]:
    text = clean_text(raw)
    if text is None:
        return None, "Sección inválida"
    upper = text.upper()
    if upper in _SECCION_VALIDAS:
        return upper, None
    if text in _SECCION_LEGACY:
        return _SECCION_LEGACY[text], None
    return None, "Sección inválida"


def parse_rack_letter(raw: object) -> tuple[str | None, str | None]:
    text = clean_text(raw)
    if text is None:
        return None, "Rack vacío"
    letter = text.upper()
    if letter not in _RACK_LETRAS:
        return None, "Rack inválido"
    return letter, None


def parse_caja_numero(raw: object) -> tuple[int | None, str | None]:
    if raw is None:
        return None, "Número de caja vacío"
    if not isinstance(raw, bool) and isinstance(raw, (int, float)):
        value = int(raw)
        if value <= 0:
            return None, "Número de caja inválido"
        return value, None
    text = clean_text(raw)
    if text is None:
        return None, "Número de caja vacío"
    if text.isdigit() and int(text) > 0:
        return int(text), None
    return None, "Número de caja inválido"


def parse_posicion(raw: object) -> tuple[str | None, str | None, str | None]:
    """Devuelve (posición normalizada, tipo de caja inferido, motivo)."""
    text = clean_text(raw)
    if text is None:
        return None, None, "Posición vacía"

    match = _CARTON_RE.match(text)
    if match:
        number, letter = match.groups()
        return f"{number}{letter.upper()}", "carton_81", None

    if text.isdigit():
        value = int(text)
        if 1 <= value <= 100:
            return str(value), "plastic_100", None

    return None, None, "Posición inválida"


def parse_encargado(raw: object) -> tuple[str, str | None, str | None]:
    """Devuelve (iniciales, motivo, valor_original_combinado)."""
    text = clean_text(raw)
    if text is None:
        return "SIN_ASIGNAR", None, None
    parts = text.split()
    first = parts[0].upper()
    if len(parts) > 1:
        return first, "Encargado combinado, se tomó el primero", text
    return first, None, None


def _validate_date_range(value: date) -> tuple[date | None, str | None]:
    if value.year < _MIN_YEAR or value.year > date.today().year + 1:
        return None, "Fecha fuera de rango plausible"
    return value, None


def parse_fecha_entrada(raw: object) -> tuple[date | None, str | None]:
    if raw is None:
        return None, None
    if isinstance(raw, datetime):
        return _validate_date_range(raw.date())
    if isinstance(raw, date):
        return _validate_date_range(raw)

    text = clean_text(raw)
    if text is None:
        return None, None

    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt).date()
        except ValueError:
            continue
        return _validate_date_range(parsed)

    return None, "Fecha con formato no reconocido"


def _extract_initials(text: str) -> str | None:
    match = _INITIALS_RE.search(text)
    return match.group(1) if match else None


def parse_propietario_caja(raw: object) -> str | None:
    text = clean_text(raw)
    if text is None:
        return None
    without_date = _DATE_RE.sub(" ", text)
    initials = _extract_initials(without_date)
    if initials:
        return initials
    first_token = without_date.strip().split()
    return first_token[0].upper() if first_token else None


def parse_fecha_salida(raw: object) -> tuple[date | None, str | None, str | None, str | None]:
    """Devuelve (fecha, iniciales, nota_original, motivo)."""
    if raw is None:
        return None, None, None, None
    if isinstance(raw, datetime):
        exit_date, reason = _validate_date_range(raw.date())
        return exit_date, None, None, reason
    if isinstance(raw, date):
        exit_date, reason = _validate_date_range(raw)
        return exit_date, None, None, reason

    text = clean_text(raw)
    if text is None:
        return None, None, None, None

    match = _DATE_RE.search(text)
    if not match:
        return None, _extract_initials(text), text, "Fecha de salida no interpretable, se guardó el texto como nota"

    day, month, year = match.groups()
    year_num = int(year) + 2000 if len(year) == 2 else int(year)
    try:
        candidate = date(year_num, int(month), int(day))
    except ValueError:
        return None, _extract_initials(text), text, "Fecha de salida con formato inválido"

    exit_date, reason = _validate_date_range(candidate)
    remainder = text[: match.start()] + text[match.end() :]
    initials = _extract_initials(remainder)
    return exit_date, initials, text, reason
