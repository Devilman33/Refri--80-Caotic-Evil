from .helpers import freeze_payload, make_freezer, thaw_payload


def test_freeze_creates_sample_and_movement(client, db_session):
    _, rack, box = make_freezer(client)

    response = client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    assert response.status_code == 201
    body = response.json()
    assert body["sample"]["status"] == "active"
    assert body["sample"]["position"] == "1A"
    assert body["sample"]["environ_id"] == "BP001"
    assert body["movement"]["action"] == "freeze"


def test_freeze_on_occupied_position_returns_409_with_next_free(client, db_session):
    _, rack, box = make_freezer(client)
    client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    response = client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    assert response.status_code == 409
    assert response.json()["detail"]["next_free_position"] == "1B"


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


def test_freeze_requires_non_core_owner_when_not_core(client, db_session):
    _, rack, box = make_freezer(client)

    payload = freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", is_core=False)

    response = client.post("/movements", json=payload)
    assert response.status_code == 422


def test_freeze_not_core_uses_declared_owner(client, db_session):
    _, rack, box = make_freezer(client)

    payload = freeze_payload(
        rack_letter=rack["letter"],
        box_number=box["number"],
        position="1A",
        is_core=False,
        non_core_owner_initials="DB",
    )
    response = client.post("/movements", json=payload)
    assert response.status_code == 201

    sample_id = response.json()["sample"]["id"]
    owner_id = response.json()["sample"]["owner_id"]
    owner = client.get(f"/users/{owner_id}").json()
    assert owner["initials"] == "DB"
    assert sample_id


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
