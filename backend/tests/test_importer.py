"""Tests de integración del importador sobre el Excel sintético (issue #2):
normalizaciones, retiros, conflictos, idempotencia y reporte de anomalías.
"""

from datetime import date

from app.importer.core import import_inventory
from app.importer.report import write_anomaly_report
from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, SampleType, User
from app.seed.seed import seed_layout
from tests.fixtures.synthetic_inventory import make_row, write_workbook


def _seed(db_session) -> None:
    seed_layout(db_session)


def test_import_normalizes_fields_and_creates_sample(db_session, tmp_path):
    _seed(db_session)
    rows = [
        make_row(
            **{
                "ID Environ": "BP007",
                "Tipo": "MC",
                "Nucleo": "si",
                "Seccion": "1",
                "Encargado": "JCI BPG",
                "Pasaje": "N/A",
                "Fecha de entrada": "10/01/23",
            }
        )
    ]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session)

    assert result.summary.total_rows == 1
    assert result.summary.imported == 1
    assert result.summary.skipped_invalid == 0

    sample = db_session.query(Sample).filter_by(source_row=3).one()
    assert sample.environ_id == "BP007"
    assert sample.type == "medio_condicionado"
    assert sample.is_core is True
    assert sample.passage is None
    assert sample.status == SampleStatus.ACTIVE.value
    assert sample.owner.initials == "JCI"

    # "Seccion" = "1" normaliza a "I", que es la sección real del rack A sembrado.
    assert not any(a.column == "Seccion" for a in result.anomalies)
    # El encargado combinado se reporta aunque se haya podido resolver.
    assert any(a.column == "Encargado" and a.value == "JCI BPG" for a in result.anomalies)


def test_import_missing_type_is_skipped_and_reported(db_session, tmp_path):
    _seed(db_session)
    rows = [make_row(**{"Tipo": None})]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session)

    assert result.summary.imported == 0
    assert result.summary.skipped_invalid == 1
    assert db_session.query(Sample).count() == 0
    assert any(a.column == "Tipo" and a.reason == "Tipo vacío" for a in result.anomalies)


def test_import_unknown_rack_is_skipped_and_reported(db_session, tmp_path):
    _seed(db_session)
    rows = [make_row(**{"Rack": "Z"})]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session)

    assert result.summary.skipped_invalid == 1
    assert db_session.query(Sample).count() == 0
    assert any(a.column == "Rack" for a in result.anomalies)


def test_import_oversized_field_is_skipped_and_reported(db_session, tmp_path):
    """Una fila con un valor más largo que la columna del modelo (aquí ID Environ,
    VARCHAR(60)) se reporta y se salta en vez de abortar el flush completo."""
    _seed(db_session)
    rows = [make_row(**{"ID Environ": "X" * 61})]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session)

    assert result.summary.imported == 0
    assert result.summary.skipped_invalid == 1
    assert db_session.query(Sample).count() == 0
    assert any(a.column == "ID Environ" and "caracteres" in a.reason for a in result.anomalies)


def test_import_withdrawal_creates_sample_and_thaw_movement(db_session, tmp_path):
    _seed(db_session)
    rows = [make_row(**{"Fecha de salida": "21-4-25 VF (revisado)"})]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session)

    assert result.summary.imported == 1
    assert result.summary.withdrawn == 1

    sample = db_session.query(Sample).filter_by(source_row=3).one()
    assert sample.status == SampleStatus.WITHDRAWN.value

    movements = db_session.query(Movement).filter_by(sample_id=sample.id).order_by(Movement.action).all()
    actions = {m.action for m in movements}
    assert actions == {MovementAction.FREEZE.value, MovementAction.THAW.value}

    thaw = next(m for m in movements if m.action == MovementAction.THAW.value)
    assert thaw.date == date(2025, 4, 21)
    assert thaw.note == "21-4-25 VF (revisado)"
    assert thaw.operator.initials == "VF"

    # La posición retirada queda libre para otra muestra activa.
    box = db_session.query(Box).one()
    assert box.samples[0].status == SampleStatus.WITHDRAWN.value


def test_import_position_conflict_keeps_last_row_active(db_session, tmp_path):
    _seed(db_session)
    rows = [
        make_row(**{"ID Environ": "BP001", "Posición": "1A"}),
        make_row(**{"ID Environ": "BP002", "Posición": "1A"}),
    ]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session)

    assert result.summary.imported == 2
    assert result.summary.conflicts_resolved == 1

    losing = db_session.query(Sample).filter_by(source_row=3).one()
    winning = db_session.query(Sample).filter_by(source_row=4).one()

    assert losing.status == SampleStatus.WITHDRAWN.value
    losing_thaw = (
        db_session.query(Movement)
        .filter_by(sample_id=losing.id, action=MovementAction.THAW.value)
        .one()
    )
    assert "conflicto de posición" in losing_thaw.note.lower()
    assert winning.status == SampleStatus.ACTIVE.value

    assert any(a.column == "Posición" and a.row == 3 and "conflicto" in a.reason.lower() for a in result.anomalies)


def test_import_conflict_against_previously_active_sample(db_session, tmp_path):
    """Una muestra activa ya existente (p. ej. de una importación anterior, con un
    `source_row` distinto al de este archivo) también participa en la resolución
    de conflictos de posición."""
    _seed(db_session)
    rack = db_session.query(Rack).filter_by(letter="A").one()
    box = Box(rack_id=rack.id, number=1, box_type="carton_81")
    db_session.add(box)
    db_session.flush()
    owner = User(initials="GC")
    db_session.add(owner)
    db_session.flush()
    existing = Sample(
        type=SampleType.VIAL_CELULAS.value,
        owner_id=owner.id,
        status=SampleStatus.ACTIVE.value,
        box_id=box.id,
        position="2B",
        source_row=999,
    )
    db_session.add(existing)
    db_session.commit()

    path = write_workbook(tmp_path / "inventario.xlsx", [make_row(**{"Posición": "2B", "ID Environ": "BP099"})])
    result = import_inventory(path, db_session)

    assert result.summary.conflicts_resolved == 1
    new_sample = db_session.query(Sample).filter_by(environ_id="BP099").one()
    assert new_sample.status == SampleStatus.WITHDRAWN.value

    existing_refreshed = db_session.get(Sample, existing.id)
    assert existing_refreshed.status == SampleStatus.ACTIVE.value


def test_import_is_idempotent(db_session, tmp_path):
    _seed(db_session)
    rows = [make_row(**{"ID Environ": "BP001"}), make_row(**{"ID Environ": "BP002", "Posición": "2A"})]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    first = import_inventory(path, db_session)
    assert first.summary.imported == 2
    assert db_session.query(Sample).count() == 2

    second = import_inventory(path, db_session)
    assert second.summary.imported == 0
    assert second.summary.skipped_already_imported == 2
    assert db_session.query(Sample).count() == 2


def test_import_dry_run_does_not_write_to_database(db_session, tmp_path):
    _seed(db_session)
    rows = [make_row()]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session, dry_run=True)

    assert result.summary.imported == 1
    assert db_session.query(Sample).count() == 0
    assert db_session.query(User).count() == 0


def test_import_writes_anomaly_report_csv(db_session, tmp_path):
    _seed(db_session)
    rows = [make_row(**{"Tipo": None, "ID Environ": None})]
    path = write_workbook(tmp_path / "inventario.xlsx", rows)

    result = import_inventory(path, db_session)

    report_path = tmp_path / "reporte.csv"
    write_anomaly_report(result.anomalies, report_path)

    content = report_path.read_text(encoding="utf-8")
    lines = content.strip().splitlines()
    assert lines[0] == "fila,columna,valor_original,motivo"
    assert any(line.startswith("3,Tipo,") for line in lines[1:])
    assert any(line.startswith("3,ID Environ,") for line in lines[1:])
