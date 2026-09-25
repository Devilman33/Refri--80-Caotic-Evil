from .helpers import create_box, create_rack, create_sample, create_section, create_user, freeze_payload, make_freezer


def test_create_and_list_sections(client, db_session):
    create_section(client, code="I")

    response = client.get("/sections")
    assert response.status_code == 200
    assert [section["code"] for section in response.json()] == ["I"]


def test_duplicate_section_code_conflicts(client, db_session):
    create_section(client, code="I")

    response = client.post("/sections", json={"code": "i"})
    assert response.status_code == 409


def test_delete_section_with_racks_conflicts(client, db_session):
    section = create_section(client, code="I")
    create_rack(client, section_id=section["id"], letter="A", slot="center")

    response = client.delete(f"/sections/{section['id']}")
    assert response.status_code == 409


def test_create_section_rejects_invalid_code(client, db_session):
    response = client.post("/sections", json={"code": "V"})
    assert response.status_code == 422


def test_create_rack_requires_existing_section(client, db_session):
    response = client.post("/racks", json={"section_id": 999999, "letter": "A", "slot": "center"})
    assert response.status_code == 404


def test_create_rack_and_filter_by_section(client, db_session):
    section = create_section(client, code="I")
    other_section = create_section(client, code="II")
    create_rack(client, section_id=section["id"], letter="A", slot="center")
    create_rack(client, section_id=other_section["id"], letter="C", slot="center")

    response = client.get("/racks", params={"section_id": section["id"]})
    assert response.status_code == 200
    assert [rack["letter"] for rack in response.json()] == ["A"]


def test_duplicate_rack_letter_conflicts(client, db_session):
    section = create_section(client, code="I")
    create_rack(client, section_id=section["id"], letter="A", slot="center")

    response = client.post("/racks", json={"section_id": section["id"], "letter": "a", "slot": "right"})
    assert response.status_code == 409


def test_create_rack_rejects_invalid_letter(client, db_session):
    section = create_section(client, code="I")

    response = client.post("/racks", json={"section_id": section["id"], "letter": "1", "slot": "center"})
    assert response.status_code == 422


def test_create_box_and_positions(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")

    response = client.get(f"/boxes/{box['id']}/positions")
    assert response.status_code == 200
    positions = response.json()
    assert len(positions) == 81
    assert positions[0] == {
        "position": "1A",
        "occupied": False,
        "sample_id": None,
        "environ_id": None,
        "is_core": None,
        "owners": [],
    }
    assert all(not entry["occupied"] for entry in positions)


def test_box_positions_report_is_core_for_the_nucleo_warning(client, db_session):
    _, rack, box = make_freezer(client)
    client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", is_core=True),
    )
    client.post(
        "/movements",
        json=freeze_payload(
            rack_letter=rack["letter"],
            box_number=box["number"],
            position="1B",
            environ_id="BP002",
            is_core=False,
            owner_initials=["DB"],
        ),
    )

    positions = {entry["position"]: entry for entry in client.get(f"/boxes/{box['id']}/positions").json()}
    assert positions["1A"]["occupied"] is True
    assert positions["1A"]["is_core"] is True
    # Núcleo es una marca: la posición dice igual de quién es la muestra.
    assert positions["1A"]["owners"] == ["GC"]
    assert positions["1B"]["owners"] == ["DB"]
    assert positions["1B"]["occupied"] is True
    assert positions["1B"]["is_core"] is False
    assert positions["1C"]["occupied"] is False
    assert positions["1C"]["is_core"] is None


def test_duplicate_box_number_in_rack_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")

    response = client.post("/boxes", json={"rack_id": rack["id"], "number": 1, "box_type": "plastic_100"})
    assert response.status_code == 409


def test_create_box_rejects_number_over_rack_capacity(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=2)

    response = client.post("/boxes", json={"rack_id": rack["id"], "number": 3, "box_type": "carton_81"})
    assert response.status_code == 422


def test_reduce_rack_capacity_below_existing_box_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=30)
    create_box(client, rack_id=rack["id"], number=5, box_type="carton_81")

    response = client.patch(f"/racks/{rack['id']}", json={"capacity": 2})
    assert response.status_code == 409


def test_delete_box_with_samples_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    owner = create_user(client, initials="GC")

    response = client.post(
        "/samples",
        json={
            "type": "vial_celulas",
            "owner_ids": [owner["id"]],
            "box_id": box["id"],
            "position": "1A",
            "operator_initials": "GC",
            "date": "2026-01-15",
        },
    )
    assert response.status_code == 201

    response = client.delete(f"/boxes/{box['id']}")
    assert response.status_code == 409


def test_change_section_code_with_samples_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/sections/{section['id']}", json={"code": "II"})
    assert response.status_code == 409


def test_change_rack_letter_with_samples_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/racks/{rack['id']}", json={"letter": "B"})
    assert response.status_code == 409


def test_change_rack_section_with_samples_conflicts(client, db_session):
    section = create_section(client, code="I")
    other_section = create_section(client, code="II")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/racks/{rack['id']}", json={"section_id": other_section["id"]})
    assert response.status_code == 409


def test_change_rack_letter_without_samples_ok(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")

    response = client.patch(f"/racks/{rack['id']}", json={"letter": "B"})
    assert response.status_code == 200
    assert response.json()["letter"] == "B"


def test_change_box_type_with_samples_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/boxes/{box['id']}", json={"box_type": "plastic_100"})
    assert response.status_code == 409


def test_change_box_number_over_rack_capacity_rejected(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center", capacity=2)
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")

    response = client.patch(f"/boxes/{box['id']}", json={"number": 3})
    assert response.status_code == 422


def test_change_rack_slot_with_samples_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    response = client.patch(f"/racks/{rack['id']}", json={"slot": "right"})
    assert response.status_code == 409
