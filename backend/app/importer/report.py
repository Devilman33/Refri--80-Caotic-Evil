"""Reporte de anomalías del importador: fila, columna, valor original, motivo."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Anomaly:
    row: int
    column: str
    value: str
    reason: str


def write_anomaly_report(anomalies: list[Anomaly], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["fila", "columna", "valor_original", "motivo"])
        for anomaly in anomalies:
            writer.writerow([anomaly.row, anomaly.column, anomaly.value, anomaly.reason])
