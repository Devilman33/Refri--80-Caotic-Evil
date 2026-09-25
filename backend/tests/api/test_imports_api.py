"""Anomalías del importador persistidas y su triage.

`docs/DATOS.md` define el reporte de anomalías "para que el laboratorio lo corrija", así
que sin estado de triage la mitad de la idea quedaba afuera.
"""

from app.importer.core import import_inventory
from app.models import AnomalyStatus, ImportAnomaly, ImportRun
from app.seed.seed import seed_layout
from tests.fixtures.synthetic_inventory import make_row, write_workbook


def _workbook(tmp_path, rows, name="inventario.xlsx"):
    return write_workbook(tmp_path / name, rows)


# El Excel real trae el pasaje con coma decimal (es-CL), que el importador reporta en vez
# de tragarse. Es la anomalía más fácil de generar a voluntad.
_POSICIONES = [f"{col}{row}" for col in range(1, 10) for row in "ABCDEFGHI"]


def _sucias(cantidad: int, *, desde: int = 0) -> list[dict]:
    """Filas con un pasaje que el importador no puede interpretar.

    `desde` corre las posiciones: dos archivos distintos que usaran las mismas posiciones
    generarían anomalías de conflicto además de las de pasaje, y el test mediría otra cosa.
    """
    return [
        make_row(
            **{
                "ID Environ": f"BP{desde + index:03d}",
                "Posición": _POSICIONES[desde + index],
                "Pasaje": "2,5",
            }
        )
        for index in range(cantidad)
    ]


def test_import_persists_the_run_and_its_anomalies(client, db_session, tmp_path):
    seed_layout(db_session)
    path = _workbook(tmp_path, _sucias(3))

    result = import_inventory(path, db_session)

    assert result.run_id is not None
    run = db_session.get(ImportRun, result.run_id)
    assert run.total_rows == 3
    assert run.anomalies_count == 3
    assert db_session.query(ImportAnomaly).filter_by(run_id=run.id).count() == 3


def test_dry_run_persists_nothing(client, db_session, tmp_path):
    """El flag promete no escribir nada, y eso incluye la corrida: un ensayo no es un
    hecho del historial."""
    seed_layout(db_session)
    path = _workbook(tmp_path, _sucias(2))

    result = import_inventory(path, db_session, dry_run=True)

    assert result.run_id is None
    assert db_session.query(ImportRun).count() == 0
    assert result.summary.anomalies == 2  # el reporte se calcula igual


def test_reimporting_reports_the_same_anomalies_without_duplicating(client, db_session, tmp_path):
    """Reimportar sigue siendo idempotente (lo promete el README) Y honesto.

    El parseo de cada fila ocurre SIEMPRE; lo que se saltea es la persistencia. Si se
    salteara el parseo, la segunda corrida reportaría ~cero anomalías y la serie de
    calidad de datos mostraría una caída a cero que se lee como "lo arreglamos" cuando el
    Excel sigue igual de sucio.
    """
    seed_layout(db_session)
    path = _workbook(tmp_path, _sucias(2))
    primera = import_inventory(path, db_session)

    segunda = import_inventory(path, db_session)

    assert segunda.summary.anomalies == primera.summary.anomalies == 2
    assert segunda.summary.imported == 0
    assert segunda.summary.skipped_already_imported == 2
    # Idempotencia: no se duplicaron muestras.
    assert client.get("/samples").json()["total"] == 2
    # Pero la corrida sí queda registrada, con sus anomalías.
    assert db_session.query(ImportRun).count() == 2
    assert db_session.query(ImportAnomaly).filter_by(run_id=segunda.run_id).count() == 2


def test_a_changed_file_is_a_different_source(client, db_session, tmp_path):
    """La identidad es el hash del CONTENIDO: si el laboratorio corrige el Excel, es otro
    origen y sus filas se importan de nuevo en vez de saltearse."""
    seed_layout(db_session)
    import_inventory(_workbook(tmp_path, _sucias(2)), db_session)

    corregido = _workbook(tmp_path, _sucias(2, desde=2), name="corregido.xlsx")
    segunda = import_inventory(corregido, db_session)

    assert segunda.summary.skipped_already_imported == 0
    assert db_session.query(ImportRun).count() == 2


def test_anomalies_are_grouped_by_reason(client, db_session, tmp_path):
    """"1.412 filas con fecha imposible" es una decisión que alguien puede tomar.
    "Página 1 de 37" no es nada."""
    seed_layout(db_session)
    run_id = import_inventory(_workbook(tmp_path, _sucias(5)), db_session).run_id

    grupos = client.get(f"/imports/{run_id}/anomalies/groups").json()

    assert len(grupos) == 1
    assert grupos[0]["reason"] == "Pasaje no entero"
    assert grupos[0]["total"] == 5
    assert grupos[0]["pending"] == 5


def test_resolving_a_group_marks_all_of_its_anomalies(client, db_session, tmp_path):
    seed_layout(db_session)
    run_id = import_inventory(_workbook(tmp_path, _sucias(4)), db_session).run_id

    response = client.patch(
        f"/imports/{run_id}/anomalies",
        json={"operator_initials": "mn", "reason": "Pasaje no entero", "status": "resolved"},
    )

    assert response.status_code == 200
    assert response.json()["updated"] == 4

    grupos = client.get(f"/imports/{run_id}/anomalies/groups").json()
    assert grupos[0]["pending"] == 0

    primera = client.get(f"/imports/{run_id}/anomalies").json()["items"][0]
    assert primera["status"] == "resolved"
    assert primera["resolved_by"] == "MN"
    assert primera["resolved_at"] is not None


def test_reopening_an_anomaly_clears_who_and_when(client, db_session, tmp_path):
    """Si no, quedaría la firma de una resolución que ya no existe."""
    seed_layout(db_session)
    run_id = import_inventory(_workbook(tmp_path, _sucias(2)), db_session).run_id
    client.patch(
        f"/imports/{run_id}/anomalies",
        json={"operator_initials": "MN", "reason": "Pasaje no entero", "status": "resolved"},
    )

    client.patch(
        f"/imports/{run_id}/anomalies",
        json={"operator_initials": "MN", "reason": "Pasaje no entero", "status": "pending"},
    )

    primera = client.get(f"/imports/{run_id}/anomalies").json()["items"][0]
    assert primera["status"] == "pending"
    assert primera["resolved_by"] is None
    assert primera["resolved_at"] is None


def test_resolving_without_a_target_is_refused(client, db_session, tmp_path):
    """Marcar TODA una corrida de una vez no es algo que se quiera hacer sin querer."""
    seed_layout(db_session)
    run_id = import_inventory(_workbook(tmp_path, _sucias(2)), db_session).run_id

    response = client.patch(f"/imports/{run_id}/anomalies", json={"operator_initials": "MN"})

    assert response.status_code == 422


def test_anomaly_values_are_truncated(client, db_session, tmp_path):
    """Las celdas son texto libre y pueden traer nombres del personal (docs/DATOS.md), y
    el endpoint no tiene autenticación."""
    seed_layout(db_session)
    run_id = import_inventory(_workbook(tmp_path, _sucias(1)), db_session).run_id
    anomalia = db_session.query(ImportAnomaly).filter_by(run_id=run_id).one()
    anomalia.value = "x" * 200
    db_session.commit()

    valor = client.get(f"/imports/{run_id}/anomalies").json()["items"][0]["value"]

    assert len(valor) <= 81
    assert valor.endswith("…")


def test_runs_are_listed_newest_first(client, db_session, tmp_path):
    seed_layout(db_session)
    import_inventory(_workbook(tmp_path, _sucias(1), name="a.xlsx"), db_session)
    import_inventory(_workbook(tmp_path, _sucias(2, desde=1), name="b.xlsx"), db_session)

    corridas = client.get("/imports").json()

    assert [entry["source_name"] for entry in corridas] == ["b.xlsx", "a.xlsx"]
    assert corridas[0]["anomalies_count"] == 2


def test_anomalies_can_be_filtered_by_status(client, db_session, tmp_path):
    seed_layout(db_session)
    run_id = import_inventory(_workbook(tmp_path, _sucias(3)), db_session).run_id
    ids = [entry["id"] for entry in client.get(f"/imports/{run_id}/anomalies").json()["items"][:2]]
    client.patch(
        f"/imports/{run_id}/anomalies", json={"operator_initials": "MN", "ids": ids, "status": "accepted"}
    )

    pendientes = client.get(f"/imports/{run_id}/anomalies", params={"status": "pending"}).json()

    assert pendientes["total"] == 1


def test_unknown_run_returns_404(client, db_session):
    assert client.get("/imports/999/anomalies").status_code == 404
    assert client.get("/imports/999/anomalies/groups").status_code == 404
