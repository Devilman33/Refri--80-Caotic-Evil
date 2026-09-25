from .helpers import create_sample, create_user, make_freezer


def test_create_sample_conflicts_on_occupied_position(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.post(
        "/samples",
        json={
            "type": "vial_celulas",
            "owner_id": owner["id"],
            "box_id": box["id"],
            "position": "1A",
            "operator_initials": "GC",
            "date": "2026-01-15",
        },
    )
    assert response.status_code == 409


def test_get_sample_includes_readable_location(client, db_session):
    _, rack, box = make_freezer(client, section_code="III", rack_letter="F", box_number=12)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="3B")

    response = client.get(f"/samples/{created['id']}")
    assert response.status_code == 200
    assert response.json()["location"] == "III · F12 · 3B"


def test_update_sample_only_allows_descriptive_fields(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/samples/{created['id']}", json={"description": "Actualizada", "passage": 3})
    assert response.status_code == 200
    body = response.json()
    assert body["description"] == "Actualizada"
    assert body["passage"] == 3
    assert body["box_id"] == box["id"]
    assert body["position"] == "1A"


def test_list_samples_paginated(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1B")

    response = client.get("/samples", params={"page": 1, "page_size": 1})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert len(body["items"]) == 1


def test_sample_movements_history_starts_with_freeze(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.get(f"/samples/{created['id']}/movements")
    assert response.status_code == 200
    movements = response.json()
    assert len(movements) == 1
    assert movements[0]["action"] == "freeze"
    assert movements[0]["position"] == "1A"


def test_get_missing_sample_404(client, db_session):
    response = client.get("/samples/999999")
    assert response.status_code == 404
