"""Traslado de una subcaja entera: todas sus muestras activas cambian de ubicación y
cada una deja su evento de traslado."""

from .helpers import create_box, create_rack, freeze_payload, make_freezer, thaw_payload


def _freeze(client, rack, box, position, **overrides):
    response = client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position=position, **overrides),
    )
    assert response.status_code == 201, response.text
    return response.json()["sample"]


def _move(client, box, *, rack_letter, box_number, **overrides):
    payload = {"date": "2026-03-01", "operator_initials": "GC", "rack_letter": rack_letter, "box_number": box_number}
    payload.update(overrides)
    return client.post(f"/boxes/{box['id']}/move", json=payload)


def test_moving_a_box_relocates_all_its_active_samples(client, db_session):
    section, rack, box = make_freezer(client, section_code="I", rack_letter="A", box_number=3)
    first = _freeze(client, rack, box, "1A")
    second = _freeze(client, rack, box, "2B", environ_id="BP002")
    other_rack = create_rack(client, section_id=section["id"], letter="B", slot="right")

    response = _move(client, box, rack_letter="B", box_number=7, note="Reordenamiento del estante")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["moved"] == 2
    assert body["from_label"] == "I · A3"
    assert body["to_label"] == "I · B7"
    assert body["box"]["rack_id"] == other_rack["id"]

    for sample, position in ((first, "1A"), (second, "2B")):
        moved = client.get(f"/samples/{sample['id']}").json()
        assert moved["location"] == f"I · B7 · {position}"
        history = client.get(f"/samples/{sample['id']}/movements").json()
        assert history[-1]["action"] == "move"
        assert history[-1]["from_location"] == f"I · A3 · {position}"
        assert history[-1]["note"] == "Reordenamiento del estante"


def test_moving_a_box_keeps_the_history_of_withdrawn_samples_in_place(client, db_session):
    """Un retiro de antes del traslado ocurrió en el lugar viejo, y ahí se tiene que ver."""
    _, rack, box = make_freezer(client, rack_letter="A", box_number=3)
    withdrawn = _freeze(client, rack, box, "1A")
    client.post("/movements", json=thaw_payload(rack_letter="A", box_number=3, position="1A"))
    _freeze(client, rack, box, "1B", environ_id="BP002")

    assert _move(client, box, rack_letter="A", box_number=9).status_code == 200

    assert client.get(f"/samples/{withdrawn['id']}").json()["location"] == "I · A3 · 1A"
    origin = client.get(f"/boxes/{box['id']}").json()
    assert origin["number"] == 3
    assert origin["is_full"] is False


def test_moving_a_box_onto_one_with_samples_is_rejected(client, db_session):
    _, rack, box = make_freezer(client, rack_letter="A", box_number=3)
    _freeze(client, rack, box, "1A")
    occupied = create_box(client, rack_id=rack["id"], number=4)
    _freeze(client, rack, occupied, "5E", environ_id="BP009")

    response = _move(client, box, rack_letter="A", box_number=4)

    assert response.status_code == 409
    assert client.get("/samples/search", params={"box_number": 3}).json()["total"] == 1


def test_moving_a_box_reuses_an_empty_box_in_the_destination(client, db_session):
    _, rack, box = make_freezer(client, rack_letter="A", box_number=3)
    _freeze(client, rack, box, "1A")
    empty = create_box(client, rack_id=rack["id"], number=4, box_type="plastic_100")

    response = _move(client, box, rack_letter="A", box_number=4)

    assert response.status_code == 200
    assert response.json()["box"]["id"] == empty["id"]
    assert response.json()["box"]["box_type"] == "carton_81"


def test_moving_an_empty_box_or_to_the_same_place_is_rejected(client, db_session):
    _, rack, box = make_freezer(client, rack_letter="A", box_number=3)

    assert _move(client, box, rack_letter="A", box_number=5).status_code == 422

    _freeze(client, rack, box, "1A")
    assert _move(client, box, rack_letter="A", box_number=3).status_code == 422


def test_moving_a_box_beyond_rack_capacity_is_rejected(client, db_session):
    _, rack, box = make_freezer(client, rack_letter="A", box_number=3, rack_capacity=5)
    _freeze(client, rack, box, "1A")

    assert _move(client, box, rack_letter="A", box_number=6).status_code == 422
