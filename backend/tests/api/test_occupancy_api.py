from .helpers import create_sample, create_user, make_freezer


def test_freezer_occupancy_counts_active_samples_only(client, db_session):
    _, _, box = make_freezer(client, box_type="plastic_100")
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1")

    response = client.get("/occupancy/freezer")
    assert response.status_code == 200
    body = response.json()
    assert body["capacity"] == 100
    assert body["active"] == 1
    assert body["percent"] == 1.0


def test_section_and_rack_and_box_occupancy(client, db_session):
    section, rack, box = make_freezer(client, section_code="II", rack_letter="C", box_number=5, box_type="carton_81")
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1B")

    sections = client.get("/occupancy/sections").json()
    section_entry = next(entry for entry in sections if entry["code"] == "II")
    assert section_entry["active"] == 2
    assert section_entry["capacity"] == 81

    racks = client.get("/occupancy/racks", params={"section_code": "II"}).json()
    assert len(racks) == 1
    assert racks[0]["active"] == 2
    assert racks[0]["letter"] == "C"

    boxes = client.get("/occupancy/boxes", params={"rack_letter": "C"}).json()
    assert len(boxes) == 1
    assert boxes[0]["active"] == 2
    assert boxes[0]["capacity"] == 81
    assert round(boxes[0]["percent"], 2) == round(2 / 81 * 100, 2)


def test_occupancy_ignores_withdrawn_samples(client, db_session):
    _, _, box = make_freezer(client, box_type="carton_81")
    owner = create_user(client, initials="GC")
    sample = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    from app.models import Sample, SampleStatus

    db_sample = db_session.get(Sample, sample["id"])
    db_sample.status = SampleStatus.WITHDRAWN.value
    db_session.commit()

    response = client.get("/occupancy/freezer")
    assert response.json()["active"] == 0
