"""Búsqueda por una lista de IDs pegada o escaneada.

La pregunta que esta feature contesta no es "cuáles encontraste" sino "cuáles me faltan":
alguien tiene 40 tubos en la mano y una lista en el Excel.
"""

import pytest

from app.services.search import MAX_ID_LIST, parse_id_list

from .helpers import freeze_payload, make_freezer


def _seed(client, ids: list[str]) -> None:
    _, rack, box = make_freezer(client)
    positions = [f"{column}{row}" for column in range(1, 10) for row in "ABCDEFGHI"]
    for position, environ_id in zip(positions, ids):
        client.post(
            "/movements",
            json=freeze_payload(
                rack_letter=rack["letter"], box_number=box["number"], position=position, environ_id=environ_id
            ),
        )


@pytest.mark.parametrize(
    "raw,esperado",
    [
        ("BP001,BP002", ["BP001", "BP002"]),
        ("BP001; BP002", ["BP001", "BP002"]),
        ("BP001\nBP002", ["BP001", "BP002"]),
        ("BP001\tBP002", ["BP001", "BP002"]),
        ("BP001 BP002", ["BP001", "BP002"]),
        # Excel pone comillas al copiar celdas; sin sacarlas, `"BP001"` no matchea nunca
        # y el operador ve "no encontrado" para un tubo que sí está.
        ('"BP001","BP002"', ["BP001", "BP002"]),
        ("bp001", ["BP001"]),
        # Pegar dos veces el mismo ID no debería consultarlo dos veces ni reportarlo doble.
        ("BP001, BP001, BP002", ["BP001", "BP002"]),
        ("  BP001  ,, BP002 ", ["BP001", "BP002"]),
    ],
)
def test_parse_id_list_handles_real_paste_shapes(raw, esperado):
    assert parse_id_list(raw) == esperado


def test_lookup_reports_the_missing_ids(client, db_session):
    _seed(client, ["BP001", "BP002"])

    body = client.get("/samples/by-ids", params={"environ_id_exact": "BP001,BP999,BP002,BP777"}).json()

    assert body["total"] == 2
    # En el orden en que se pegaron: así se pueden tachar de la lista de papel.
    assert body["missing"] == ["BP999", "BP777"]


def test_lookup_does_not_paginate(client, db_session):
    """El diff vive en el servidor justamente por esto.

    `page_size` está topeado en 200. Si el cliente hiciera el diff contra una respuesta
    paginada, todos los IDs que quedaran fuera de la página se reportarían como faltantes.
    """
    ids = [f"BP{index:03d}" for index in range(81)]
    _seed(client, ids)

    body = client.get("/samples/by-ids", params={"environ_id_exact": ",".join(ids)}).json()

    assert body["total"] == 81
    assert len(body["items"]) == 81
    assert body["missing"] == []


def test_lookup_matches_exactly_not_partially(client, db_session):
    """`environ_id` filtra parcial y `environ_id_exact` exacto. Si este hiciera match
    parcial, pegar "BP1" traería BP100 y el laboratorio creería tener un tubo que no es."""
    _seed(client, ["BP001", "BP0010"])

    body = client.get("/samples/by-ids", params={"environ_id_exact": "BP001"}).json()

    assert body["total"] == 1
    assert body["items"][0]["environ_id"] == "BP001"


def test_lookup_rejects_combining_partial_and_exact(client, db_session):
    """Los dos parámetros se parecen demasiado: un typo entre ellos no daría error, solo
    resultados distintos a los esperados."""
    response = client.get(
        "/samples/search", params={"environ_id": "BP", "environ_id_exact": "BP001"}
    )

    assert response.status_code == 422
    assert "environ_id_exact" in response.json()["detail"]


def test_lookup_over_the_cap_returns_422(client, db_session):
    demasiados = ",".join(f"BP{index:05d}" for index in range(MAX_ID_LIST + 1))

    response = client.get("/samples/by-ids", params={"environ_id_exact": demasiados})

    assert response.status_code == 422
    assert str(MAX_ID_LIST) in response.json()["detail"]


def test_lookup_without_ids_returns_422(client, db_session):
    response = client.get("/samples/by-ids")

    assert response.status_code == 422
