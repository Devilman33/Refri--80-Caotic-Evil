from .helpers import as_user, create_sample, create_user, make_freezer


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


def test_create_sample_normalizes_carton_position_case(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1a")
    assert created["position"] == "1A"


def test_create_sample_rejects_position_for_wrong_box_type(client, db_session):
    _, _, box = make_freezer(client, box_type="plastic_100")
    owner = create_user(client, initials="GC")

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
    assert response.status_code == 422


def test_create_sample_requires_type_other_for_otros(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")

    response = client.post(
        "/samples",
        json={
            "type": "otros",
            "owner_id": owner["id"],
            "box_id": box["id"],
            "position": "1A",
            "operator_initials": "GC",
            "date": "2026-01-15",
        },
    )
    assert response.status_code == 422


def test_core_sample_can_be_owned_by_a_person(client, db_session):
    """Núcleo es una marca: una muestra de Núcleo sigue a cargo de una persona."""
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A", is_core=True)
    assert created["is_core"] is True
    assert created["owner_id"] == owner["id"]

    response = client.patch(f"/samples/{created['id']}", json={"is_core": False})
    assert response.status_code == 200
    assert response.json()["is_core"] is False


def test_only_the_owner_can_edit_a_sample(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="DB", name="Daniela Bravo")
    other = create_user(client, initials="VF")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    rejected = client.patch(f"/samples/{created['id']}", json={"passage": 4}, headers=as_user(other["id"]))
    assert rejected.status_code == 403
    assert "Daniela Bravo" in rejected.json()["detail"]

    accepted = client.patch(f"/samples/{created['id']}", json={"passage": 4}, headers=as_user(owner["id"]))
    assert accepted.status_code == 200


def test_editing_requires_an_active_session_user(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="DB")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")
    client.patch(f"/users/{owner['id']}", json={"active": False})

    response = client.patch(f"/samples/{created['id']}", json={"passage": 4}, headers=as_user(owner["id"]))

    assert response.status_code == 401


def test_update_sample_rejects_type_otros_without_type_other(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/samples/{created['id']}", json={"type": "otros"})
    assert response.status_code == 422


def test_update_sample_rejects_clearing_type_other_while_type_is_otros(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(
        client, owner_id=owner["id"], box_id=box["id"], position="1A", type="otros", type_other="Congelado especial"
    )

    response = client.patch(f"/samples/{created['id']}", json={"type_other": None})
    assert response.status_code == 422


def test_update_sample_rejects_null_owner_id(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/samples/{created['id']}", json={"owner_id": None})
    assert response.status_code == 422


def test_update_sample_rejects_null_type(client, db_session):
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    created = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/samples/{created['id']}", json={"type": None})
    assert response.status_code == 422


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
