from .helpers import create_sample, create_user, make_freezer


def test_freezer_occupancy_counts_active_samples_only(client, db_session):
    _, _, box = make_freezer(client, box_type="plastic_100", rack_capacity=1)
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1")

    response = client.get("/occupancy/freezer")
    assert response.status_code == 200
    body = response.json()
    assert body["capacity"] == 100
    assert body["active"] == 1
    assert body["percent"] == 1.0


def test_section_and_rack_and_box_occupancy(client, db_session):
    section, rack, box = make_freezer(
        client, section_code="II", rack_letter="C", box_number=5, box_type="carton_81", rack_capacity=5
    )
    owner = create_user(client, initials="GC")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")
    create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1B")

    sections = client.get("/occupancy/sections").json()
    section_entry = next(entry for entry in sections if entry["code"] == "II")
    assert section_entry["active"] == 2
    # Capacidad real de la caja 5 (81) + 4 subcajas sin crear, asumidas cartón (81 c/u).
    assert section_entry["capacity"] == 81 * 5

    racks = client.get("/occupancy/racks", params={"section_code": "II"}).json()
    assert len(racks) == 1
    assert racks[0]["active"] == 2
    assert racks[0]["letter"] == "C"
    assert racks[0]["capacity"] == 81 * 5

    boxes = client.get("/occupancy/boxes", params={"rack_letter": "C"}).json()
    assert len(boxes) == 1
    assert boxes[0]["active"] == 2
    assert boxes[0]["capacity"] == 81
    assert round(boxes[0]["percent"], 2) == round(2 / 81 * 100, 2)
    # Datos que usa la vista de % de uso (issue #7) para enlazar al visor.
    assert boxes[0]["rack_id"] == rack["id"]
    assert boxes[0]["box_type"] == "carton_81"
    assert "is_full" in boxes[0]


def test_rack_occupancy_counts_unconfigured_boxes_as_capacity(client, db_session):
    """Un rack con capacidad configurada para más cajas de las creadas debe reflejar
    esa capacidad física (docs/DATOS.md), no solo la de las cajas que ya existen."""
    _, rack, _ = make_freezer(client, box_type="plastic_100", box_number=1, rack_capacity=30)

    racks = client.get("/occupancy/racks").json()
    rack_entry = next(entry for entry in racks if entry["rack_id"] == rack["id"])
    # 1 caja plástica real (100) + 29 subcajas sin crear, asumidas cartón (81 c/u).
    assert rack_entry["capacity"] == 100 + 29 * 81


def test_occupancy_ignores_withdrawn_samples(client, db_session):
    _, _, box = make_freezer(client, box_type="carton_81", rack_capacity=1)
    owner = create_user(client, initials="GC")
    sample = create_sample(client, owner_id=owner["id"], box_id=box["id"], position="1A")

    from app.models import Sample, SampleStatus

    db_sample = db_session.get(Sample, sample["id"])
    db_sample.status = SampleStatus.WITHDRAWN.value
    db_session.commit()

    response = client.get("/occupancy/freezer")
    assert response.json()["active"] == 0
