"""Fixtures de pytest. Los tests corren contra un Postgres real (DATABASE_URL),
ver docs/DATOS.md y .github/workflows/ci.yml para cómo se levanta en CI.
"""

import os
import pathlib
import re

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent

# Las tablas de importación NO tienen FK hacia este conjunto, así que el CASCADE del
# TRUNCATE no las alcanza: si no se listan explícitamente, las corridas y sus
# anomalías se filtran de un test al siguiente.
_TABLES = "import_anomalies, import_runs, movements, samples, boxes, racks, sections, users"

# Nombre exacto documentado en README.md y .github/workflows/ci.yml. Un simple
# substring ("test" in nombre) también aceptaría bases como "contest" o
# "latest-test"; exigimos el nombre exacto (o el opt-in explícito de abajo)
# porque este fixture borra el schema "public" completo.
_TEST_DATABASE_NAME = "refri_test"


def _require_database_url() -> str:
    """El error mas probable de la primera corrida es olvidar la variable.

    Antes esto era `os.environ["DATABASE_URL"]` a nivel de modulo, asi que
    `pytest` moria con un `KeyError: 'DATABASE_URL'` pelado durante la coleccion: sin
    decir que variable, con que valor ni como crear la base. Unas lineas mas abajo vive
    el mejor mensaje de error del repo (`_check_is_test_database`); este ahora esta a
    su altura.
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    raise RuntimeError(
        "Falta la variable de entorno DATABASE_URL.\n"
        f"  Los tests corren contra un Postgres real y usan la base '{_TEST_DATABASE_NAME}',\n"
        "  que borran y recrean entera.\n"
        "  Crearla una sola vez:\n"
        "    docker compose exec db createdb -U refri refri_test\n"
        "  Y despues, desde backend/:\n"
        "    POSIX:      DATABASE_URL=postgresql+psycopg://refri:refri@localhost:5432/refri_test pytest\n"
        "    PowerShell: $env:DATABASE_URL=\"postgresql+psycopg://refri:refri@localhost:5432/refri_test\"; pytest\n"
        "  Ojo: conftest lee la VARIABLE DE ENTORNO, no el .env del backend."
    )


DATABASE_URL = _require_database_url()




def _check_is_test_database(database_url: str) -> None:
    """Corta si `DATABASE_URL` no apunta a la base de test documentada: este
    fixture borra el schema `public` entero y no debe correr contra la base de
    desarrollo/Docker (ver docs/DATOS.md y README, que usan `refri_test`)."""
    database_name = make_url(database_url).database or ""
    if database_name == _TEST_DATABASE_NAME:
        return
    if os.environ.get("REFRI_ALLOW_DESTRUCTIVE_TESTS") == database_name:
        return
    raise RuntimeError(
        f"DATABASE_URL apunta a '{database_name}', que no es la base de test documentada "
        f"('{_TEST_DATABASE_NAME}'). Los tests borran el schema 'public' completo; usá "
        f"'{_TEST_DATABASE_NAME}' o, si es intencional, exportá "
        f"REFRI_ALLOW_DESTRUCTIVE_TESTS='{database_name}' para confirmarlo explícitamente."
    )


def _alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", DATABASE_URL)
    return config


@pytest.fixture(scope="session", autouse=True)
def apply_migrations() -> None:
    """Deja el esquema limpio corriendo `alembic upgrade head` de verdad,
    para que los tests verifiquen la migración y no solo los modelos."""
    _check_is_test_database(DATABASE_URL)
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    engine.dispose()

    command.upgrade(_alembic_config(), "head")


@pytest.fixture()
def engine():
    engine = create_engine(DATABASE_URL, future=True)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(engine):
    Session = sessionmaker(bind=engine, future=True)
    session = Session()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        with engine.begin() as connection:
            connection.execute(text(f"TRUNCATE TABLE {_TABLES} RESTART IDENTITY CASCADE"))


#: Operador por defecto de los payloads de tests/api/helpers.py, y por lo tanto también
#: el encargado por defecto de lo que congelan.
SESSION_INITIALS = "GC"

_SESSION_PATHS = re.compile(r"^/movements$|^/samples/\d+(/movements)?$|^/boxes/\d+/move$")


class SessionClient(TestClient):
    """Simula la sesión de la página: las escrituras que exigen saber quién es el usuario
    (header `X-User-Id`) salen como `GC` si el test no manda otro header.

    Sin esto, cada test que congela o retira tendría que crear el usuario y armar el
    header a mano, y lo que verifica quedaría enterrado en preparación. Los tests de
    permisos mandan el header explícito; los de "sin sesión" usan un `TestClient` pelado.
    """

    def request(self, method, url, **kwargs):  # type: ignore[override]
        headers = dict(kwargs.pop("headers", None) or {})
        if method.upper() != "GET" and "X-User-Id" not in headers and _SESSION_PATHS.match(str(url)):
            headers["X-User-Id"] = str(self._session_user_id())
        return super().request(method, url, headers=headers, **kwargs)

    def _session_user_id(self) -> int:
        users = super().request("GET", "/users").json()
        for user in users:
            if user["initials"] == SESSION_INITIALS:
                return user["id"]
        response = super().request("POST", "/users", json={"initials": SESSION_INITIALS})
        assert response.status_code == 201, response.text
        return response.json()["id"]


@pytest.fixture()
def client():
    from app.main import app

    with SessionClient(app) as test_client:
        yield test_client
