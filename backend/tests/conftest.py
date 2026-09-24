from pathlib import Path
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL is required for PostgreSQL tests")
    return url


@pytest.fixture(scope="session")
def migrated_engine(database_url: str):
    backend_dir = Path(__file__).resolve().parents[1]
    alembic_cfg = Config(str(backend_dir / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_cfg, "head")

    engine = create_engine(database_url, future=True)
    yield engine
    engine.dispose()


@pytest.fixture()
def clean_database(migrated_engine):
    with migrated_engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE TABLE movements, samples, boxes, racks, sections, users RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest.fixture()
def db_session(migrated_engine, clean_database) -> Session:
    SessionTesting = sessionmaker(bind=migrated_engine, autoflush=False, autocommit=False, future=True)
    session = SessionTesting()
    try:
        yield session
    finally:
        session.close()
