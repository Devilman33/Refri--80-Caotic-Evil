"""Racks y cajas administrados desde la página (parte 3): mover un rack de estante, darlos
de baja conservando el historial, y crear racks nuevos."""

from .helpers import create_box, create_rack, create_section, freeze_payload, thaw_payload


def _freezer(client):
    """Estantes I y III con sus dos lugares ocupados, como el freezer real."""
    one = create_section(client, code="I")
    three = create_section(client, code="III")
    racks = {
        "A": create_rack(client, section_id=one["id"], letter="A", slot="center"),
        "B": create_rack(client, section_id=one["id"], letter="B", slot="right"),
        "E": create_rack(client, section_id=three["id"], letter="E", slot="center"),
        "F": create_rack(client, section_id=three["id"], letter="F", slot="right"),
    }
    return racks


def _freeze(client, rack_letter, box_number, position, **overrides):
    response = client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack_letter, box_number=box_number, position=position, **overrides),
    )
    assert response.status_code == 201, response.text
    return response.json()["sample"]


def _move_rack(client, rack, **overrides):
    payload = {"section_code": "I", "slot": "right", "date": "2026-09-25", "operator_initials": "GC"}
    payload.update(overrides)
    return client.post(f"/racks/{rack['id']}/move", json=payload)


def test_moving_a_rack_to_an_occupied_place_asks_to_swap(client, db_session):
    racks = _freezer(client)

    response = _move_rack(client, racks["F"])

    assert response.status_code == 409
    assert response.json()["detail"]["occupant_letter"] == "B"


def test_swapping_racks_relocates_every_sample_and_keeps_the_history(client, db_session):
    racks = _freezer(client)
    in_f = _freeze(client, "F", 12, "3B")
    withdrawn = _freeze(client, "F", 12, "4C", environ_id="BP002")
    client.post("/movements", json=thaw_payload(rack_letter="F", box_number=12, position="4C"))
    in_b = _freeze(client, "B", 1, "1A", environ_id="BP003")

    response = _move_rack(client, racks["F"], swap=True, note="Reordenamiento")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["swapped_with"]["letter"] == "B"
    assert body["moved_samples"] == 2  # las dos activas; la retirada no se mueve

    assert client.get(f"/samples/{in_f['id']}").json()["location"] == "I · F12 · 3B"
    assert client.get(f"/samples/{in_b['id']}").json()["location"] == "III · B1 · 1A"

    # El congelamiento ocurrió en el estante III y así sigue diciéndolo.
    history = client.get(f"/samples/{in_f['id']}/movements").json()
    assert history[0]["location"] == "III · F12 · 3B"
    assert history[-1]["action"] == "move"
    assert history[-1]["from_location"] == "III · F12 · 3B"
    assert history[-1]["location"] == "I · F12 · 3B"
    # Y el retiro de antes del traslado también.
    retiro = client.get(f"/samples/{withdrawn['id']}/movements").json()[-1]
    assert retiro["action"] == "thaw" and retiro["location"] == "III · F12 · 4C"


def test_moving_a_rack_to_a_free_place(client, db_session):
    racks = _freezer(client)
    create_section(client, code="II")

    response = _move_rack(client, racks["F"], section_code="II", slot="center")

    assert response.status_code == 200
    assert response.json()["swapped_with"] is None
    assert response.json()["rack"]["slot"] == "center"


def test_a_rack_with_samples_cannot_be_deactivated_but_an_empty_one_can(client, db_session):
    racks = _freezer(client)
    _freeze(client, "F", 1, "1A")

    assert client.post(f"/racks/{racks['F']['id']}/deactivate").status_code == 409

    client.post("/movements", json=thaw_payload(rack_letter="F", box_number=1, position="1A"))
    response = client.post(f"/racks/{racks['F']['id']}/deactivate")

    assert response.status_code == 200
    assert response.json()["active"] is False and response.json()["slot"] is None
    assert [rack["letter"] for rack in client.get("/racks").json()] == ["A", "B", "E"]
    assert len(client.get("/racks", params={"include_inactive": True}).json()) == 4
    # Su caja también sale de la ocupación y del visor.
    assert all(box["rack_letter"] != "F" for box in client.get("/occupancy/boxes").json())
    # No se puede congelar en un rack dado de baja.
    response = client.post("/movements", json=freeze_payload(rack_letter="F", box_number=1, position="1A"))
    assert response.status_code == 422


def test_a_deactivated_rack_frees_its_place_for_a_new_rack(client, db_session):
    racks = _freezer(client)
    client.post(f"/racks/{racks['F']['id']}/deactivate")
    three = next(section for section in client.get("/sections").json() if section["code"] == "III")

    created = create_rack(client, section_id=three["id"], letter="J", slot="right")

    assert created["letter"] == "J"
    # Reactivar F exige un lugar libre: el suyo ya lo tomó J.
    response = client.post(f"/racks/{racks['F']['id']}/activate", json={"section_code": "III", "slot": "right"})
    assert response.status_code == 409


def test_an_empty_box_can_be_deactivated_and_its_place_reused(client, db_session):
    racks = _freezer(client)
    box = create_box(client, rack_id=racks["A"]["id"], number=3, box_type="carton_81")
    sample = _freeze(client, "A", 3, "1A")

    assert client.post(f"/boxes/{box['id']}/deactivate").status_code == 409

    client.post("/movements", json=thaw_payload(rack_letter="A", box_number=3, position="1A"))
    assert client.post(f"/boxes/{box['id']}/deactivate").json()["active"] is False
    assert all(entry["id"] != box["id"] for entry in client.get("/boxes").json())

    # Una caja plástica nueva en el mismo lugar reutiliza el registro; el historial queda.
    new_sample = _freeze(client, "A", 3, "7")
    reused = client.get(f"/boxes/{box['id']}").json()
    assert reused["active"] is True and reused["box_type"] == "plastic_100"
    assert new_sample["box_id"] == box["id"]
    assert client.get(f"/samples/{sample['id']}/movements").json()[-1]["location"] == "I · A3 · 1A"
