"""Generador de un Excel sintético con la estructura de `Inventario-80`
(ver docs/DATOS.md). El Excel real del laboratorio nunca se versiona; los tests
del importador usan este generador para reproducir la estructura y los casos
"sucios" documentados (formatos de fecha mezclados, encargados combinados, etc).
"""

from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook

from app.importer.core import COLUMNS, HEADER_ROW, SHEET_NAME

assert HEADER_ROW == 2  # la fila 1 lleva los nombres técnicos del Excel real


def make_row(**overrides: object) -> dict[str, object]:
    """Fila "limpia" por defecto; los tests pisan solo las columnas que les interesan."""
    row: dict[str, object] = {
        "ID Environ": "BP001",
        "ID Origen o Descripción": "Biopsia de próstata",
        "Caja origen": "Caja histórica 1",
        "Tipo": "Vial",
        "Encargado": "GC",
        "Pasaje": 1,
        "Nucleo": "Si",
        "Seccion": "I",
        "Rack": "A",
        "Caja": 1,
        "Posición": "1A",
        "Fecha de entrada": "10-01-2023",
        "Caja Completa Si/No": "No",
        "Propietario de Caja": "GC",
        "Fecha de salida": None,
        "Comentarios": None,
    }
    row.update(overrides)
    return row


def build_workbook(rows: list[dict[str, object]]) -> Workbook:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = SHEET_NAME

    # Fila 1: nombres técnicos del Excel real (docs/DATOS.md); el importador no los usa.
    sheet.append([f"tbl_44_{index}" for index in range(len(COLUMNS))])
    # Fila 2: encabezados legibles, los que lee el importador.
    sheet.append(COLUMNS)

    for row in rows:
        sheet.append([row.get(column) for column in COLUMNS])

    return workbook


def write_workbook(path: Path, rows: list[dict[str, object]]) -> Path:
    build_workbook(rows).save(path)
    return path
