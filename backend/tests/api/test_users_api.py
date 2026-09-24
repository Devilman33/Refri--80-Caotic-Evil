from .helpers import create_user


def test_create_and_get_user(client, db_session):
    created = create_user(client, initials="gc", name="Gabriela")
    assert created["initials"] == "GC"

    response = client.get(f"/users/{created['id']}")
    assert response.status_code == 200
    assert response.json()["name"] == "Gabriela"


def test_list_users(client, db_session):
    create_user(client, initials="GC")
    create_user(client, initials="DB")

    response = client.get("/users")
    assert response.status_code == 200
    initials = {user["initials"] for user in response.json()}
    assert initials == {"GC", "DB"}


def test_create_user_duplicate_initials_conflicts(client, db_session):
    create_user(client, initials="GC")

    response = client.post("/users", json={"initials": "gc"})
    assert response.status_code == 409


def test_update_user(client, db_session):
    created = create_user(client, initials="GC")

    response = client.patch(f"/users/{created['id']}", json={"active": False})
    assert response.status_code == 200
    assert response.json()["active"] is False
    assert response.json()["initials"] == "GC"


def test_get_missing_user_404(client, db_session):
    response = client.get("/users/999999")
    assert response.status_code == 404


def test_delete_user(client, db_session):
    created = create_user(client, initials="GC")

    response = client.delete(f"/users/{created['id']}")
    assert response.status_code == 204

    response = client.get(f"/users/{created['id']}")
    assert response.status_code == 404
