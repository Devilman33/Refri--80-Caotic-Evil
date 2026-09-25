"""Los cuatro contadores de `/alerts`.

Cada uno tiene que ser distinguible de los otros: si `full_boxes` y `nearly_full_boxes`
cayeran en el mismo estado de la UI, uno de los dos sería un número sobre el que nadie
puede actuar.
"""

from .helpers import create_box, create_rack, create_sample, create_section, create_user, freeze_payload, make_freezer


def _fill_box(client, rack_letter: str, box_number: int, positions: list[str]) -> None:
    for index, position in enumerate(positions):
        client.post(
            "/movements",
            json=freeze_payload(
                rack_letter=rack_letter,
                box_number=box_number,
                position=position,
                environ_id=f"BP{index:03d}",
            ),
        )


def test_alerts_are_empty_when_everything_is_consistent(client, db_session):
    """El estado vacío es una feature: "nada que revisar" es información que el
    laboratorio quiere, no un placeholder."""
    make_freezer(client)

    body = client.get("/alerts").json()

    assert body == {
        "unassigned_samples": 0,
        "nearly_full_boxes": 0,
        "full_boxes": 0,
        "inconsistent_full_boxes": 0,
        "boxes": [],
    }


def test_alerts_count_unassigned_samples(client, db_session):
    """El importador marca con SIN_ASIG las filas sin Encargado (~20 % del Excel)."""
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="SIN_ASIG")
    other = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")
    create_sample(client, owner_id=other["id"], box_id=box["id"], position="1B")

    body = client.get("/alerts").json()

    assert body["unassigned_samples"] == 1


def test_full_and_nearly_full_are_separate_counters(client, db_session):
    """Dos contadores distintos con dos destinos distintos, no un solo saco."""
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=30)
    create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    create_box(client, rack_id=rack["id"], number=2, box_type="carton_81")

    # Caja 1: llena de verdad (81 de 81).
    positions_full = [f"{column}{row}" for column in range(1, 10) for row in "ABCDEFGHI"]
    _fill_box(client, "A", 1, positions_full)
    # Caja 2: 76 de 81 = 93,8 %, casi llena pero no llena.
    _fill_box(client, "A", 2, positions_full[:76])

    body = client.get("/alerts").json()

    assert body["full_boxes"] == 1
    assert body["nearly_full_boxes"] == 1
    assert body["inconsistent_full_boxes"] == 0


def test_box_declared_full_with_free_positions_is_flagged(client, db_session):
    """La alerta más accionable de las cuatro: describe un dato equivocado, no una caja
    incómoda. Alguien marcó "llena" y todavía entra un tubo."""
    _, rack, box = make_freezer(client)
    client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", box_is_full=True),
    )

    body = client.get("/alerts").json()

    assert body["inconsistent_full_boxes"] == 1
    assert body["full_boxes"] == 1  # declarada completa: también cuenta como llena
    assert body["nearly_full_boxes"] == 0
    assert [entry["box_id"] for entry in body["boxes"]] == [box["id"]]


def test_alerts_do_not_count_withdrawn_samples(client, db_session):
    """Nunca se borran muestras: una retirada deja de ocupar posición y deja de contar."""
    _, rack, box = make_freezer(client)
    owner = create_user(client, initials="SIN_ASIG")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    assert client.get("/alerts").json()["unassigned_samples"] == 1

    client.post(
        "/movements",
        json={
            "action": "thaw",
            "date": "2026-02-01",
            "operator_initials": "GC",
            "rack_letter": rack["letter"],
            "box_number": box["number"],
            "position": "1A",
        },
    )

    assert client.get("/alerts").json()["unassigned_samples"] == 0
