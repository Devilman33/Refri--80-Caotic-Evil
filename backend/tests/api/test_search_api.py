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
    _freeze(client, rack, box, position="1B", is_core=False, owner_initials=["DB"])

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


def test_search_sort_applies_before_pagination(client, db_session):
    """El orden debe abarcar todo el resultado, no solo la página devuelta
    (si no, ordenar en el frontend con datos ya paginados es engañoso)."""
    _, rack, box = make_freezer(client, box_type="plastic_100")
    for index, environ_id in zip(range(1, 4), ["BP003", "BP001", "BP002"]):
        _freeze(client, rack, box, position=str(index), environ_id=environ_id)

    response = client.get(
        "/samples/search",
        params={"sort_by": "environ_id", "sort_dir": "asc", "page": 1, "page_size": 2},
    )
    body = response.json()
    assert [item["environ_id"] for item in body["items"]] == ["BP001", "BP002"]

    response = client.get(
        "/samples/search",
        params={"sort_by": "environ_id", "sort_dir": "desc", "page": 1, "page_size": 2},
    )
    body = response.json()
    assert [item["environ_id"] for item in body["items"]] == ["BP003", "BP002"]


def test_search_sort_rejects_unknown_column(client, db_session):
    response = client.get("/samples/search", params={"sort_by": "not_a_column"})
    assert response.status_code == 422


def test_search_by_owner_finds_samples_shared_with_others(client, db_session):
    """Buscar por MN encuentra también las muestras que MN comparte con AS."""
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", owner_initials=["AS", "MN"])
    _freeze(client, rack, box, position="1B", owner_initials=["AS"])

    assert client.get("/samples/search", params={"owner_initials": "MN"}).json()["total"] == 1
    assert client.get("/samples/search", params={"owner_initials": "AS"}).json()["total"] == 2
    ordered = client.get("/samples/search", params={"sort_by": "owner", "sort_dir": "desc"}).json()
    assert [item["position"] for item in ordered["items"]] == ["1A", "1B"]


def test_search_q_matches_environ_id_or_description(client, db_session):
    """El buscador global busca en ID Environ O en Descripción (ID Origen), sin duplicar."""
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", environ_id="BP001", description="Hígado")
    _freeze(client, rack, box, position="1B", environ_id="PR002", description="BP001-origen")
    _freeze(client, rack, box, position="1C", environ_id="PR003", description="Pulmón")

    body = client.get("/samples/search", params={"q": "bp001"}).json()
    assert body["total"] == 2
    assert sorted(item["position"] for item in body["items"]) == ["1A", "1B"]

    body = client.get("/samples/search", params={"q": "pulm"}).json()
    assert [item["position"] for item in body["items"]] == ["1C"]


def test_search_q_combines_with_other_filters(client, db_session):
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", environ_id="BP001")
    _freeze(client, rack, box, position="1B", environ_id="BP002")
    client.post("/movements", json=thaw_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A"))

    body = client.get("/samples/search", params={"q": "BP", "status": "active"}).json()
    assert [item["environ_id"] for item in body["items"]] == ["BP002"]


def test_search_q_treats_wildcards_literally(client, db_session):
    """`%` y `_` son texto, no comodines de ILIKE."""
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A", environ_id="BP_01")
    _freeze(client, rack, box, position="1B", environ_id="BPX01")

    assert [item["environ_id"] for item in client.get("/samples/search", params={"q": "BP_01"}).json()["items"]] == [
        "BP_01"
    ]
    assert client.get("/samples/search", params={"q": "%"}).json()["total"] == 0


def test_search_q_blank_is_ignored(client, db_session):
    _, rack, box = make_freezer(client)
    _freeze(client, rack, box, position="1A")
    assert client.get("/samples/search", params={"q": "   "}).json()["total"] == 1


def test_search_q_rejects_exact_id_list(client, db_session):
    response = client.get("/samples/search", params={"q": "BP", "environ_id_exact": "BP001"})
    assert response.status_code == 422
