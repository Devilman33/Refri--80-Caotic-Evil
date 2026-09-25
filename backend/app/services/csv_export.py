"""Generación del CSV de búsqueda.

Se arma en memoria y se devuelve entero, no en streaming. Tres razones, en orden de peso:

1. Una `StreamingResponse` ya mandó el 200 y los encabezados cuando la consulta falla a
   mitad de camino: el laboratorio se queda con un CSV incompleto que *parece* completo y
   decide con él qué tubos existen. Con el buffer, o sale entero o falla con un status real.
2. La sesión de base viene de una dependencia con `yield`. En la versión de FastAPI que
   usa el proyecto, el cierre de esas dependencias ocurre antes de que se consuma el
   generador de una respuesta en streaming, así que el generador correría contra una
   sesión cerrada.
3. A la escala de este freezer el archivo pesa un par de MB. El streaming resolvería un
   problema que no existe.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime

# Excel interpreta como fórmula toda celda que empiece con estos caracteres. Un
# `=SUM(A1)` guardado como descripción se ejecuta al abrir el archivo. El dato viene de un
# Excel editado por personas y vuelve a un Excel, así que el vector es real acá.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

# Solo estos filtros entran en el nombre del archivo: son valores cerrados (iniciales,
# códigos de sección, letras de rack, estados). Los de texto libre no, porque terminarían
# bytes sin validar en un encabezado de respuesta.
_FILENAME_FILTERS = ("owner_initials", "section_code", "rack_letter", "status", "type")

_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]")

COLUMNS = [
    "ID Environ",
    "Descripción",
    "Tipo",
    "Encargado",
    "Pasaje",
    "Núcleo",
    "Estado",
    "Sección",
    "Rack",
    "Caja",
    "Posición",
    "Ubicación",
    "Registrada",
]


def neutralize(value: object) -> str:
    """Devuelve el texto de una celda, desactivando la inyección de fórmulas.

    El prefijo `'` le dice a Excel "esto es texto"; el usuario ve el valor original.
    """
    if value is None:
        return ""
    text = str(value)
    if text.startswith(_FORMULA_PREFIXES):
        return "'" + text
    return text


def export_filename(filters: dict[str, object]) -> str:
    """`muestras_encargado-BPG_2026-09-25.csv`, con los filtros que aporten contexto."""
    parts = ["muestras"]
    labels = {
        "owner_initials": "encargado",
        "section_code": "seccion",
        "rack_letter": "rack",
        "status": "estado",
        "type": "tipo",
    }
    for key in _FILENAME_FILTERS:
        value = filters.get(key)
        if value in (None, ""):
            continue
        safe = _FILENAME_SAFE.sub("", str(value))[:20]
        if safe:
            parts.append(f"{labels[key]}-{safe}")
    parts.append(date.today().isoformat())
    return "_".join(parts) + ".csv"


def _format_boolean(value: object) -> str:
    if value is None:
        return ""
    return "Sí" if value else "No"


def build_csv(rows: list[tuple], type_labels: dict[str, str], status_labels: dict[str, str]) -> bytes:
    """Arma el CSV a partir de tuplas de columnas, sin instanciar modelos.

    Las filas llegan como tuplas de una consulta de columnas y no como entidades del ORM:
    pasarlas por los modelos de Pydantic costaría dos validaciones por fila para producir
    texto que se escribe y se tira.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(COLUMNS)

    for row in rows:
        (
            environ_id,
            description,
            sample_type,
            type_other,
            owner_initials,
            passage,
            is_core,
            sample_status,
            section_code,
            rack_letter,
            box_number,
            position,
            created_at,
        ) = row

        type_label = type_labels.get(sample_type, sample_type)
        if sample_type == "otros" and type_other:
            type_label = f"{type_label} ({type_other})"

        writer.writerow(
            [
                neutralize(environ_id),
                neutralize(description),
                neutralize(type_label),
                neutralize(owner_initials),
                "" if passage is None else passage,
                _format_boolean(is_core),
                status_labels.get(sample_status, sample_status),
                neutralize(section_code),
                neutralize(rack_letter),
                box_number,
                neutralize(position),
                f"{section_code} · {rack_letter}{box_number} · {position}",
                created_at.date().isoformat() if isinstance(created_at, datetime) else "",
            ]
        )

    # BOM UTF-8: sin él, Excel abre el archivo en la codificación del sistema y "Núcleo"
    # y "Posición" salen rotos. Es el único consumidor que importa acá.
    return "﻿".encode("utf-8") + buffer.getvalue().encode("utf-8")
