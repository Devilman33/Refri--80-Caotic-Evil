from .helpers import create_box, create_rack, create_sample, create_section, create_user


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


def test_create_box_and_positions(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    box = create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")

    response = client.get(f"/boxes/{box['id']}/positions")
    assert response.status_code == 200
    positions = response.json()
    assert len(positions) == 81
    assert positions[0] == {"position": "1A", "occupied": False, "sample_id": None, "environ_id": None}
    assert all(not entry["occupied"] for entry in positions)


def test_duplicate_box_number_in_rack_conflicts(client, db_session):
    section = create_section(client, code="I")
    rack = create_rack(client, section_id=section["id"], letter="A", slot="center")
    create_box(client, rack_id=rack["id"], number=1, box_type="carton_81")

    response = client.post("/boxes", json={"rack_id": rack["id"], "number": 1, "box_type": "plastic_100"})
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
            "owner_id": owner["id"],
            "box_id": box["id"],
            "position": "1A",
            "operator_initials": "GC",
            "date": "2026-01-15",
        },
    )
    assert response.status_code == 201

    response = client.delete(f"/boxes/{box['id']}")
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
