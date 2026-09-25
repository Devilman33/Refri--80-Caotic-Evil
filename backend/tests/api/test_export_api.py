"""El export CSV.

El test más importante de este archivo no es ninguno de los de contenido: es
`test_export_route_is_not_captured_by_sample_id`, porque se pega a la URL y no a la
función. FastAPI resuelve rutas por orden de declaración, así que si `/export` quedara
después de `/{sample_id}` todos los demás tests pasarían y el endpoint devolvería 422 en
producción.
"""

from app.config import get_settings

from .helpers import create_sample, create_user, freeze_payload, make_freezer


def _seed(client, *, count: int = 3) -> None:
    _, rack, box = make_freezer(client)
    for index in range(count):
        client.post(
            "/movements",
            json=freeze_payload(
                rack_letter=rack["letter"],
                box_number=box["number"],
                position=f"{index + 1}A",
                environ_id=f"BP{index:03d}",
            ),
        )


def _rows(body: bytes) -> list[str]:
    text = body.decode("utf-8-sig")
    return [line for line in text.splitlines() if line]


def test_export_route_is_not_captured_by_sample_id(client, db_session):
    response = client.get("/samples/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")


def test_export_starts_with_utf8_bom(client, db_session):
    """Sin BOM, Excel abre el archivo en la codificación del sistema y "Núcleo" y
    "Posición" salen rotos. Excel es el único consumidor que importa acá."""
    _seed(client)

    body = client.get("/samples/export").content

    assert body.startswith(b"\xef\xbb\xbf")
    assert "Núcleo" in body.decode("utf-8-sig").splitlines()[0]


def test_export_honors_the_same_filters_as_search(client, db_session):
    _seed(client, count=3)

    searched = client.get("/samples/search", params={"environ_id": "BP001"}).json()
    exported = _rows(client.get("/samples/export", params={"environ_id": "BP001"}).content)

    assert searched["total"] == 1
    assert len(exported) == 2  # encabezado + 1 fila
    assert "BP001" in exported[1]


def test_export_and_search_expose_the_same_filter_params(client, db_session):
    """La única red contra la divergencia de alias.

    Dos de los filtros tienen alias (`type`, `status`). Si los endpoints declararan sus
    parámetros por separado, olvidarse de un alias haría que `?type=rna` filtrara la
    búsqueda y no el export, con un 200 y un CSV plausible.
    """
    schema = client.get("/openapi.json").json()

    def filter_params(path: str) -> set[str]:
        params = {param["name"] for param in schema["paths"][path]["get"].get("parameters", [])}
        return params - {"sort_by", "sort_dir", "page", "page_size"}

    assert filter_params("/samples/export") == filter_params("/samples/search")


def test_export_neutralizes_formula_injection(client, db_session):
    """El dato viene de un Excel que edita gente y vuelve a un Excel: una descripción que
    empiece con `=` se ejecuta al abrir el archivo."""
    _, _, box = make_freezer(client)
    owner = create_user(client, initials="GC")
    create_sample(
        client,
        owner_id=owner["id"],
        box_id=box["id"],
        position="1A",
        description="=SUM(A1:A9)",
        environ_id="BP900",
    )

    exported = _rows(client.get("/samples/export").content)

    assert "'=SUM(A1:A9)" in exported[1]


def test_export_with_zero_results_returns_only_headers(client, db_session):
    response = client.get("/samples/export", params={"environ_id": "NO_EXISTE"})

    assert response.status_code == 200
    assert len(_rows(response.content)) == 1


def test_export_over_the_cap_returns_422(client, db_session):
    """El tope es configurable justamente para poder probar el borde sin crear 25.000
    filas: un test que necesita más datos que los que el freezer puede tener no se puede
    escribir."""
    _seed(client, count=3)
    settings = get_settings()
    original = settings.export_max_rows
    settings.export_max_rows = 2
    try:
        response = client.get("/samples/export")
    finally:
        settings.export_max_rows = original

    assert response.status_code == 422
    assert "máximo exportable es 2" in response.json()["detail"]


def test_export_filename_includes_enumerated_filters_only(client, db_session):
    _seed(client)

    response = client.get("/samples/export", params={"section_code": "I", "description": "=malicioso"})

    disposition = response.headers["content-disposition"]
    assert "seccion-I" in disposition
    # El texto libre NO entra en el encabezado: solo filtros de valores cerrados.
    assert "malicioso" not in disposition


def test_export_joins_several_owners_like_the_excel(client, db_session):
    _, rack, box = make_freezer(client)
    response = client.post(
        "/movements",
        json=freeze_payload(rack_letter=rack["letter"], box_number=box["number"], position="1A", owner_initials=["MN", "AS"]),
    )
    assert response.status_code == 201, response.text

    body = client.get("/samples/export").content.decode("utf-8-sig")

    assert "AS/MN" in body
