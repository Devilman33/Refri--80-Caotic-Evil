"""Fixtures de pytest. Los tests corren contra un Postgres real (DATABASE_URL),
ver docs/DATOS.md y .github/workflows/ci.yml para cómo se levanta en CI.
"""

import os
import pathlib

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
DATABASE_URL = os.environ["DATABASE_URL"]

_TABLES = "movements, samples, boxes, racks, sections, users"


def _check_is_test_database(database_url: str) -> None:
    """Corta si `DATABASE_URL` no apunta a una base de test: este fixture
    borra el schema `public` entero y no debe correr contra la base de
    desarrollo/Docker (ver docs/DATOS.md y README, que usan `refri_test`)."""
    database_name = make_url(database_url).database or ""
    if "test" not in database_name.lower():
        raise RuntimeError(
            f"DATABASE_URL apunta a '{database_name}', que no parece una base de test "
            "(el nombre no contiene 'test'). Los tests borran el schema 'public' completo; "
            "usá una base separada como 'refri_test' para no perder datos reales."
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


@pytest.fixture()
def client():
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
