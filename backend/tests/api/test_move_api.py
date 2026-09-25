"""Traslado de una muestra.

`.github/copilot-instructions.md` lista tres movimientos —ingreso, traslado, retiro— y el
traslado no existía. Mover un tubo obligaba a descongelar y volver a congelar, y eso crea
una muestra NUEVA: el historial quedaba partido en dos `sample.id`.
"""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Movement, MovementAction

from .helpers import create_box, create_rack, create_section, freeze_payload, make_freezer, thaw_payload


def _freeze(client, rack_letter: str, box_number: int, position: str, **overrides) -> dict:
    response = client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack_letter, box_number=box_number, position=position, **overrides),
    )
    assert response.status_code == 201, response.text
    return response.json()["sample"]


def _move(client, sample_id: int, *, rack_letter: str, box_number: int, position: str, **overrides):
    payload = {
        "date": "2026-03-01",
        "operator_initials": "MN",
        "rack_letter": rack_letter,
        "box_number": box_number,
        "position": position,
    }
    payload.update(overrides)
    return client.post(f"/samples/{sample_id}/movements", json=payload)


def test_move_changes_location_and_records_origin(client, db_session):
    _, rack, box = make_freezer(client)
    create_box(client, rack_id=rack["id"], number=2, box_type="carton_81")
    sample = _freeze(client, rack["letter"], box["number"], "1A")

    response = _move(client, sample["id"], rack_letter=rack["letter"], box_number=2, position="3B")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sample"]["position"] == "3B"
    assert body["movement"]["action"] == "move"
    # Origen y destino en la misma fila: el historial muestra de dónde a dónde sin
    # recorrer la cadena de eventos hacia atrás.
    assert body["movement"]["from_position"] == "1A"
    assert body["movement"]["from_location"].endswith("· 1A")
    assert body["movement"]["location"].endswith("· 3B")
    assert body["movement"]["operator_initials"] == "MN"


def test_move_keeps_the_same_sample_id(client, db_session):
    """El punto del bloque: la muestra es la misma, no una copia."""
    _, rack, box = make_freezer(client)
    sample = _freeze(client, rack["letter"], box["number"], "1A")

    _move(client, sample["id"], rack_letter=rack["letter"], box_number=box["number"], position="2A")

    assert client.get("/samples").json()["total"] == 1
    assert client.get(f"/samples/{sample['id']}").json()["position"] == "2A"


def test_sample_lifecycle_keeps_one_row_per_physical_tube(client, db_session):
    """El test de las 2 de la mañana de un viernes.

    Congelar, descongelar, volver a congelar y mover. Son DOS filas en `samples` y cuatro
    eventos: la segunda congelación crea una muestra nueva a propósito, porque `environ_id`
    no identifica un tubo (docs/DATOS.md: un mismo ID cubre hasta cientos). Que sean dos y
    no una es la decisión, y este test la fija para que nadie la "arregle" después.
    """
    _, rack, box = make_freezer(client)
    primera = _freeze(client, rack["letter"], box["number"], "1A")
    client.post("/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))
    segunda = _freeze(client, rack["letter"], box["number"], "1A", environ_id="BP001")
    _move(client, segunda["id"], rack_letter=rack["letter"], box_number=box["number"], position="5C")

    assert primera["id"] != segunda["id"]
    assert client.get("/samples").json()["total"] == 2

    acciones = [movement["action"] for movement in client.get(f"/samples/{primera['id']}/movements").json()]
    assert acciones == ["freeze", "thaw"]
    acciones_segunda = [movement["action"] for movement in client.get(f"/samples/{segunda['id']}/movements").json()]
    assert acciones_segunda == ["freeze", "move"]


def test_move_to_occupied_position_returns_409_with_next_free(client, db_session):
    _, rack, box = make_freezer(client)
    sample = _freeze(client, rack["letter"], box["number"], "1A")
    _freeze(client, rack["letter"], box["number"], "1B", environ_id="BP002")

    response = _move(client, sample["id"], rack_letter=rack["letter"], box_number=box["number"], position="1B")

    assert response.status_code == 409
    # Mismo cuerpo que ya devuelve POST /movements, no uno nuevo.
    assert response.json()["detail"]["next_free_position"] == "1C"


def test_move_to_the_same_position_returns_422(client, db_session):
    """Sin esta guarda, el chequeo de ocupación daría 409 "ya está ocupada" contra la
    propia muestra: un mensaje que no se entiende."""
    _, rack, box = make_freezer(client)
    sample = _freeze(client, rack["letter"], box["number"], "1A")

    response = _move(client, sample["id"], rack_letter=rack["letter"], box_number=box["number"], position="1A")

    assert response.status_code == 422
    assert "ya está en esa posición" in response.json()["detail"]


def test_move_a_withdrawn_sample_returns_422(client, db_session):
    _, rack, box = make_freezer(client)
    sample = _freeze(client, rack["letter"], box["number"], "1A")
    client.post("/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    response = _move(client, sample["id"], rack_letter=rack["letter"], box_number=box["number"], position="2A")

    assert response.status_code == 422
    assert "retirada" in response.json()["detail"]


def test_move_to_position_incompatible_with_box_type_returns_422(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=30)
    create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    create_box(client, rack_id=rack["id"], number=2, box_type="plastic_100")
    sample = _freeze(client, "A", 1, "1A")

    # "1A" es una posición de cartón; la caja 2 es plástica (1..100).
    response = _move(client, sample["id"], rack_letter="A", box_number=2, position="1A")

    assert response.status_code == 422
    assert "plastic_100" in response.json()["detail"]


def test_move_creates_the_destination_box_if_missing(client, db_session):
    _, rack, box = make_freezer(client)
    sample = _freeze(client, rack["letter"], box["number"], "1A")

    response = _move(client, sample["id"], rack_letter=rack["letter"], box_number=7, position="1A")

    assert response.status_code == 201
    assert any(entry["number"] == 7 for entry in client.get("/boxes").json())


def test_move_beyond_rack_capacity_returns_422(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=2)
    create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    sample = _freeze(client, "A", 1, "1A")

    response = _move(client, sample["id"], rack_letter="A", box_number=9, position="1A")

    assert response.status_code == 422


def test_move_to_unknown_sample_returns_404(client, db_session):
    make_freezer(client)

    assert _move(client, 9999, rack_letter="A", box_number=1, position="1A").status_code == 404


def test_database_rejects_a_move_without_origin(client, db_session):
    """La garantía vive en la base y no solo en la aplicación: un bug del código no puede
    dejar un traslado sin origen, que es justo lo que el traslado viene a registrar."""
    _, rack, box = make_freezer(client)
    sample = _freeze(client, rack["letter"], box["number"], "1A")

    db_session.add(
        Movement(
            sample_id=sample["id"],
            action=MovementAction.MOVE.value,
            date="2026-03-01",
            box_id=box["id"],
            position="2A",
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_freeze_and_thaw_leave_the_origin_columns_null(client, db_session):
    """El contrapositivo: que nadie las llene "por las dudas"."""
    _, rack, box = make_freezer(client)
    sample = _freeze(client, rack["letter"], box["number"], "1A")
    client.post("/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    for movement in client.get(f"/samples/{sample['id']}/movements").json():
        assert movement["from_box_id"] is None
        assert movement["from_position"] is None
        assert movement["from_location"] is None


def test_movements_endpoint_still_rejects_move(client, db_session):
    """`POST /movements` es el endpoint del formulario y sigue implementando solo dos
    acciones, aunque el enum ahora tenga tres."""
    _, rack, box = make_freezer(client)
    payload = freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A")
    payload["action"] = "move"

    assert client.post("/movements", json=payload).status_code == 422
