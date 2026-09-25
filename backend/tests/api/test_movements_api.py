from .helpers import (
    as_user,
    create_rack,
    create_sample,
    create_section,
    create_user,
    freeze_payload,
    make_freezer,
    thaw_payload,
)


def test_freeze_creates_sample_and_movement(client, db_session):
    _, rack, box = make_freezer(client)

    response = client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    assert response.status_code == 201
    body = response.json()
    assert body["sample"]["status"] == "active"
    assert body["sample"]["position"] == "1A"
    assert body["sample"]["environ_id"] == "BP001"
    assert body["movement"]["action"] == "freeze"


def test_freeze_without_environ_id_is_rejected(client, db_session):
    _, rack, box = make_freezer(client)

    response = client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", environ_id=None),
    )

    assert response.status_code == 422


def test_freeze_on_occupied_position_returns_409_with_next_free(client, db_session):
    _, rack, box = make_freezer(client)
    client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    response = client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    assert response.status_code == 409
    assert response.json()["detail"]["next_free_position"] == "1B"


def test_freeze_rejects_auto_created_box_over_rack_capacity(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=2)

    response = client.post(
        "/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=7, position="1")
    )

    assert response.status_code == 422


def test_freeze_creates_box_automatically_when_missing(client, db_session):
    section, rack, _ = make_freezer(client, box_number=1)

    response = client.post(
        "/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=7, position="1")
    )

    assert response.status_code == 201
    assert response.json()["sample"]["location"] == f"{section['code']} · {rack['letter']}7 · 1"

    boxes = client.get("/boxes", params={"rack_id": rack["id"]}).json()
    new_box = next(box for box in boxes if box["number"] == 7)
    assert new_box["box_type"] == "plastic_100"


def test_freeze_requires_an_owner_even_when_core(client, db_session):
    """Núcleo es una marca, no un encargado: toda muestra queda a cargo de una persona."""
    _, rack, box = make_freezer(client)

    for is_core in (True, False):
        payload = freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", is_core=is_core)
        del payload["owner_initials"]
        response = client.post("/movements", json=payload)
        assert response.status_code == 422, is_core


def test_core_sample_keeps_its_person_as_owner(client, db_session):
    _, rack, box = make_freezer(client)

    payload = freeze_payload(
        rack_letter=rack["letter"], box_number=box["number"], position="1A", is_core=True, owner_initials="DB"
    )
    response = client.post("/movements", json=payload)
    assert response.status_code == 201

    sample = response.json()["sample"]
    assert sample["is_core"] is True
    owner = client.get(f"/users/{sample['owner_id']}").json()
    assert owner["initials"] == "DB"


def test_freeze_ignores_a_declared_box_is_full(client, db_session):
    """"¿La caja está llena?" ya no se pregunta: se calcula. Un valor enviado igual no
    puede dejar una caja "llena" con una sola muestra."""
    _, rack, box = make_freezer(client)

    payload = freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", box_is_full=True)
    assert client.post("/movements", json=payload).status_code == 201

    assert client.get(f"/boxes/{box['id']}").json()["is_full"] is False


def test_freeze_rejects_whitespace_only_type_other(client, db_session):
    _, rack, box = make_freezer(client)

    payload = freeze_payload(
        rack_letter=rack["letter"],
        box_number=box["number"],
        position="1A",
        sample_type="otros",
        type_other="   ",
    )
    response = client.post("/movements", json=payload)
    assert response.status_code == 422


def test_thaw_withdraws_sample_without_deleting_it(client, db_session):
    _, rack, box = make_freezer(client)
    freeze_response = client.post(
        "/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A")
    )
    sample_id = freeze_response.json()["sample"]["id"]

    response = client.post(
        "/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A")
    )
    assert response.status_code == 201
    assert response.json()["sample"]["status"] == "withdrawn"
    assert response.json()["movement"]["action"] == "thaw"

    still_there = client.get(f"/samples/{sample_id}")
    assert still_there.status_code == 200
    assert still_there.json()["status"] == "withdrawn"

    positions = client.get(f"/boxes/{box['id']}/positions").json()
    position_1a = next(entry for entry in positions if entry["position"] == "1A")
    assert position_1a["occupied"] is False


def test_thaw_without_active_sample_returns_404(client, db_session):
    _, rack, box = make_freezer(client)

    response = client.post(
        "/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A")
    )
    assert response.status_code == 404


def test_freeze_can_reuse_position_after_thaw(client, db_session):
    _, rack, box = make_freezer(client)
    client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))
    client.post("/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    response = client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", environ_id="BP002"),
    )
    assert response.status_code == 201
    assert response.json()["sample"]["environ_id"] == "BP002"


def test_box_is_full_is_computed_on_freeze_and_thaw(client, db_session):
    """Llena = todas las posiciones ocupadas. Se sube con el último ingreso y se baja con
    el primer retiro, sin que nadie lo declare."""
    _, rack, box = make_freezer(client, box_type="plastic_100")
    for position in range(1, 101):
        response = client.post(
            "/movements",
            json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position=str(position)),
        )
        assert response.status_code == 201, response.text
        expected_full = position == 100
        assert client.get(f"/boxes/{box['id']}").json()["is_full"] is expected_full

    client.post("/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="50"))

    assert client.get(f"/boxes/{box['id']}").json()["is_full"] is False


def test_thaw_records_the_reason(client, db_session):
    """Retirar = cambiar estado + registrar quién, cuándo y motivo."""
    _, rack, box = make_freezer(client)
    client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    response = client.post(
        "/movements",
        json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", note="Extracción de RNA"),
    )

    assert response.status_code == 201
    assert response.json()["movement"]["note"] == "Extracción de RNA"


def test_only_the_owner_can_thaw_a_sample(client, db_session):
    _, rack, box = make_freezer(client)
    client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", owner_initials="DB"),
    )
    other = create_user(client, initials="VF", name="Valentina Fuentes")
    owner = next(user for user in client.get("/users").json() if user["initials"] == "DB")
    thaw = thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A")

    rejected = client.post("/movements", json=thaw, headers=as_user(other["id"]))
    assert rejected.status_code == 403
    assert client.get(f"/boxes/{box['id']}/positions").json()[0]["occupied"] is True

    accepted = client.post("/movements", json=thaw, headers=as_user(owner["id"]))
    assert accepted.status_code == 201


def test_anyone_can_thaw_a_sample_without_owner(client, db_session):
    """Las muestras sin encargado (centinela del importador) no quedan bloqueadas."""
    _, rack, box = make_freezer(client)
    unassigned = create_user(client, initials="SIN_ASIG")
    create_sample(client, owner_id=unassigned["id"], box_id=box["id"], position="1A")
    other = create_user(client, initials="VF")

    response = client.post(
        "/movements",
        json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"),
        headers=as_user(other["id"]),
    )

    assert response.status_code == 201


def test_movements_require_a_session(db_session):
    """Sin elegir quién es, no se registra nada: el cambio tiene que tener autor."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as anonymous:
        response = anonymous.post(
            "/movements", json=freeze_payload(rack_letter="A", box_number=1, position="1A")
        )

    assert response.status_code == 401


def test_movement_history_exposes_operator_initials(client, db_session):
    """C2: la regla de dominio exige registrar *quién* retiró una muestra. El dato se
    guardaba en `operator_id` pero no salía por la API, así que la UI no podía mostrarlo."""
    _, rack, box = make_freezer(client)
    created = client.post(
        "/movements",
        json=freeze_payload(
            rack_letter=rack["letter"], box_number=box["number"], position="1A", operator_initials="mn"
        ),
    )
    sample_id = created.json()["sample"]["id"]

    movements = client.get(f"/samples/{sample_id}/movements").json()

    assert [movement["operator_initials"] for movement in movements] == ["MN"]


def test_movements_endpoint_rejects_unimplemented_action(client, db_session):
    """Guarda del fallthrough: este endpoint implementa freeze y thaw. Una acción nueva
    caía en `_freeze` sin validar y explotaba con un 500."""
    _, rack, box = make_freezer(client)
    payload = freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A")
    payload["action"] = "move"

    response = client.post("/movements", json=payload)

    assert response.status_code == 422
    assert client.get("/samples").json()["total"] == 0


def test_concurrent_box_creation_during_freeze_keeps_operator(client, db_session):
    """A9: dos congelamientos simultáneos en una caja que aún no existe.

    Se fuerza la carrera creando la caja entre el chequeo y el flush. El punto fino es que
    el rescate NO puede ser un rollback completo: eso descartaría el INSERT del operador que
    ya se flusheó, y como operator_id es nullable el evento saldría sin operador — un 201
    que incumple en silencio la regla de registrar quién.
    """
    from app.api import movements as movements_module

    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=30)

    original = movements_module.ensure_box_number_within_capacity

    def create_box_behind_our_back(rack_obj, number):
        original(rack_obj, number)
        # Otro request ganó la carrera y creó la caja justo ahora.
        client.post("/boxes", json={"rack_id": rack["id"], "number": number, "box_type": "carton_81"})

    movements_module.ensure_box_number_within_capacity = create_box_behind_our_back
    try:
        response = client.post(
            "/movements", json=freeze_payload(rack_letter="A", box_number=7, position="1A")
        )
    finally:
        movements_module.ensure_box_number_within_capacity = original

    assert response.status_code == 201, response.text
    sample_id = response.json()["sample"]["id"]
    movements = client.get(f"/samples/{sample_id}/movements").json()
    assert movements[0]["operator_initials"] == "GC"
    assert movements[0]["operator_id"] is not None


def test_cannot_renumber_a_box_that_has_samples(client, db_session):
    """A8: cambiar el número reubica todas las muestras sin un evento de movimiento."""
    _, rack, box = make_freezer(client)
    client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    response = client.patch(f"/boxes/{box['id']}", json={"number": 9})

    assert response.status_code == 409
    assert "sin registrar el movimiento" in response.json()["detail"]
    assert client.get(f"/boxes/{box['id']}").json()["number"] == box["number"]


def test_can_renumber_an_empty_box(client, db_session):
    _, rack, box = make_freezer(client)

    response = client.patch(f"/boxes/{box['id']}", json={"number": 9})

    assert response.status_code == 200
    assert response.json()["number"] == 9
