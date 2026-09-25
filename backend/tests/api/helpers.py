"""Crea datos de prueba a través de la API en vez de por ORM directo, para que el
setup de cada test también ejercite los endpoints CRUD."""

from __future__ import annotations

from fastapi.testclient import TestClient


def create_user(client: TestClient, *, initials: str = "GC", name: str | None = None, active: bool = True) -> dict:
    response = client.post("/users", json={"initials": initials, "name": name, "active": active})
    assert response.status_code == 201, response.text
    return response.json()


def create_section(client: TestClient, *, code: str = "I") -> dict:
    response = client.post("/sections", json={"code": code})
    assert response.status_code == 201, response.text
    return response.json()


def create_rack(client: TestClient, *, section_id: int, letter: str = "A", slot: str = "center", capacity: int = 30) -> dict:
    response = client.post(
        "/racks", json={"section_id": section_id, "letter": letter, "slot": slot, "capacity": capacity}
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_box(client: TestClient, *, rack_id: int, number: int = 1, box_type: str = "carton_81") -> dict:
    response = client.post("/boxes", json={"rack_id": rack_id, "number": number, "box_type": box_type})
    assert response.status_code == 201, response.text
    return response.json()


def create_sample(client: TestClient, *, owner_id: int, box_id: int, position: str = "1A", **overrides) -> dict:
    payload = {
        "type": "vial_celulas",
        "owner_id": owner_id,
        "box_id": box_id,
        "position": position,
        "operator_initials": "GC",
        "date": "2026-01-15",
    }
    payload.update(overrides)
    response = client.post("/samples", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def make_freezer(
    client: TestClient,
    *,
    section_code: str = "I",
    rack_letter: str = "A",
    slot: str = "center",
    box_number: int = 1,
    box_type: str = "carton_81",
    rack_capacity: int = 30,
) -> tuple[dict, dict, dict]:
    section = create_section(client, code=section_code)
    rack = create_rack(client, section_id=section["id"], letter=rack_letter, slot=slot, capacity=rack_capacity)
    box = create_box(client, rack_id=rack["id"], number=box_number, box_type=box_type)
    return section, rack, box


def freeze_payload(*, rack_letter: str, box_number: int, position: str, **overrides) -> dict:
    payload = {
        "action": "freeze",
        "date": "2026-01-15",
        "operator_initials": "GC",
        "rack_letter": rack_letter,
        "box_number": box_number,
        "position": position,
        "environ_id": "BP001",
        "description": "Biopsia de próstata",
        "sample_type": "vial_celulas",
        "is_core": True,
    }
    payload.update(overrides)
    return payload


def thaw_payload(*, rack_letter: str, box_number: int, position: str, **overrides) -> dict:
    payload = {
        "action": "thaw",
        "date": "2026-02-01",
        "operator_initials": "GC",
        "rack_letter": rack_letter,
        "box_number": box_number,
        "position": position,
    }
    payload.update(overrides)
    return payload
