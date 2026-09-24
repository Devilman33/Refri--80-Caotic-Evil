from .helpers import freeze_payload, make_freezer, thaw_payload


def _freeze(client, rack, box, **overrides):
    response = client.post("/movements", json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], **overrides))
    assert response.status_code == 201, response.text
    return response.json()["sample"]


def test_search_filters_by_environ_id_partial_match(client, db_session):
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", environ_id="BP001")
    _freeze(client, rack, box, position="1B", environ_id="PR002")

    response = client.get("/samples/search", params={"environ_id": "bp"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["environ_id"] == "BP001"
    assert body["items"][0]["location"] == f"I · {rack['letter']}{box['number']} · 1A"


def test_search_filters_by_owner_and_core(client, db_session):
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", is_core=True)
    _freeze(client, rack, box, position="1B", is_core=False, non_core_owner_initials="DB")

    response = client.get("/samples/search", params={"owner_initials": "DB"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["is_core"] is False

    response = client.get("/samples/search", params={"is_core": "true"})
    assert response.json()["total"] == 1


def test_search_filters_by_type_and_status(client, db_session):
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", sample_type="plasma")
    _freeze(client, rack, box, position="1B", sample_type="rna")
    client.post("/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    response = client.get("/samples/search", params={"type": "rna"})
    assert response.json()["total"] == 1

    response = client.get("/samples/search", params={"status": "withdrawn"})
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["position"] == "1A"


def test_search_filters_by_location(client, db_session):
    _, rack_a, box_a = make_freezer(client, section_code="III", rack_letter="F", box_number=12)
    _, rack_b, box_b = make_freezer(client, section_code="IV", rack_letter="G", box_number=1)
    _freeze(client, rack_a, box_a, position="1A")
    _freeze(client, rack_b, box_b, position="1A")

    response = client.get("/samples/search", params={"section_code": "III"})
    assert response.json()["total"] == 1

    response = client.get("/samples/search", params={"rack_letter": "G", "box_number": 1})
    assert response.json()["total"] == 1


def test_search_filters_by_date_range(client, db_session):
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", date="2026-01-10")
    _freeze(client, rack, box, position="1B", date="2026-03-05")

    response = client.get("/samples/search", params={"date_from": "2026-03-01", "date_to": "2026-03-31"})
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["position"] == "1B"


def test_search_is_paginated(client, db_session):
    _, rack, box = make_freezer(client, box_type="plastic_100")
    for index in range(1, 4):
        _freeze(client, rack, box, position=str(index), environ_id=f"BP{index:03d}")

    response = client.get("/samples/search", params={"page": 1, "page_size": 2})
    body = response.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
