from .helpers import freeze_payload, make_freezer


def test_autocomplete_requires_environ_id_or_owner(client, db_session):
    response = client.get("/autocomplete/suggestions")
    assert response.status_code == 422


def test_autocomplete_returns_empty_suggestion_when_no_match(client, db_session):
    response = client.get("/autocomplete/suggestions", params={"environ_id": "NOPE"})
    assert response.status_code == 200
    assert response.json() == {
        "environ_id": None,
        "description": None,
        "sample_type": None,
        "type_other": None,
        "passage": None,
        "is_core": None,
        "owner_initials": None,
        "rack_letter": None,
        "box_number": None,
        "box_id": None,
        "next_free_position": None,
    }


def test_autocomplete_suggests_last_matching_sample_and_next_free_position(client, db_session):
    _, rack, box = make_freezer(client)
    client.post(
        "/movements",
        json=freeze_payload(
            rack_letter=rack["letter"],
            box_number=box["number"],
            position="1A",
            environ_id="BP001",
            passage=2,
        ),
    )
    client.post(
        "/movements",
        json=freeze_payload(
            rack_letter=rack["letter"],
            box_number=box["number"],
            position="1B",
            environ_id="BP001",
            passage=3,
        ),
    )

    response = client.get("/autocomplete/suggestions", params={"environ_id": "BP001"})
    assert response.status_code == 200
    body = response.json()
    assert body["environ_id"] == "BP001"
    assert body["passage"] == 3
    assert body["rack_letter"] == rack["letter"]
    assert body["box_number"] == box["number"]
    assert body["next_free_position"] == "1C"
