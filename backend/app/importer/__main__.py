"""CLI: `python -m app.importer <ruta.xlsx> [--dry-run]` (ver docs/DATOS.md)."""

from __future__ import annotations

import argparse
import pathlib
import sys

from app.database import SessionLocal
from app.importer.core import import_inventory
from app.importer.report import write_anomaly_report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.importer",
        description="Importa la hoja 'Inventario-80' del Excel de origen (docs/DATOS.md).",
    )
    parser.add_argument("ruta", type=pathlib.Path, help="Ruta al archivo .xlsx")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Procesa el archivo y genera el reporte sin escribir en la base de datos",
    )
    parser.add_argument(
        "--report",
        "--reporte",
        dest="reporte",
        type=pathlib.Path,
        default=None,
        help="Ruta del CSV de anomalías (por defecto: <ruta>.anomalias.csv)",
    )
    args = parser.parse_args(argv)

    report_path = args.reporte or args.ruta.with_suffix(".anomalias.csv")

    with SessionLocal() as session:
        result = import_inventory(args.ruta, session, dry_run=args.dry_run)

    write_anomaly_report(result.anomalies, report_path)

    summary = result.summary
    print(f"Filas leídas: {summary.total_rows}")
    print(f"Importadas: {summary.imported}")
    print(f"Retiradas: {summary.withdrawn}")
    print(f"Ya importadas (omitidas): {summary.skipped_already_imported}")
    print(f"Inválidas (omitidas): {summary.skipped_invalid}")
    print(f"Conflictos de posición resueltos: {summary.conflicts_resolved}")
    print(f"Anomalías reportadas: {summary.anomalies} -> {report_path}")
    if result.run_id is not None:
        print(f"Corrida registrada: #{result.run_id} (ver GET /imports/{result.run_id}/anomalies)")
    if args.dry_run:
        print("Modo --dry-run: no se escribió nada en la base de datos.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
