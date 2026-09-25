"""La migración 0006 parte los usuarios combinados del Excel (`AS/MN`) en personas."""

from alembic import command
from sqlalchemy import text

from tests.conftest import _TABLES, _alembic_config


def test_migration_splits_combined_owners_into_people(engine):
    config = _alembic_config()
    command.downgrade(config, "0005_import_runs")
    try:
        with engine.begin() as connection:
            section_id = connection.execute(text("INSERT INTO sections (code) VALUES ('I') RETURNING id")).scalar_one()
            rack_id = connection.execute(
                text(
                    "INSERT INTO racks (section_id, letter, slot, capacity) "
                    "VALUES (:section, 'A', 'center', 20) RETURNING id"
                ),
                {"section": section_id},
            ).scalar_one()
            box_id = connection.execute(
                text("INSERT INTO boxes (rack_id, number, box_type) VALUES (:rack, 1, 'carton_81') RETURNING id"),
                {"rack": rack_id},
            ).scalar_one()
            existing_as = connection.execute(
                text("INSERT INTO users (initials, name, active) VALUES ('AS', 'Ana Soto', true) RETURNING id")
            ).scalar_one()
            combined = connection.execute(
                text("INSERT INTO users (initials, active) VALUES ('AS/MN', true) RETURNING id")
            ).scalar_one()
            single = connection.execute(
                text("INSERT INTO users (initials, active) VALUES ('GC', true) RETURNING id")
            ).scalar_one()
            shared_sample = connection.execute(
                text(
                    "INSERT INTO samples (type, owner_id, status, box_id, position) "
                    "VALUES ('rna', :owner, 'active', :box, '1A') RETURNING id"
                ),
                {"owner": combined, "box": box_id},
            ).scalar_one()
            own_sample = connection.execute(
                text(
                    "INSERT INTO samples (type, owner_id, status, box_id, position) "
                    "VALUES ('rna', :owner, 'active', :box, '1B') RETURNING id"
                ),
                {"owner": single, "box": box_id},
            ).scalar_one()

        command.upgrade(config, "head")

        with engine.connect() as connection:
            owners = {
                sample_id: sorted(initials for _, initials in rows)
                for sample_id, rows in _group(
                    connection.execute(
                        text(
                            "SELECT so.sample_id, u.initials FROM sample_owners so "
                            "JOIN users u ON u.id = so.user_id ORDER BY so.sample_id"
                        )
                    ).all()
                ).items()
            }
            initials = {row[0] for row in connection.execute(text("SELECT initials FROM users"))}
            ana = connection.execute(text("SELECT id FROM users WHERE initials = 'AS'")).scalar_one()

        assert owners == {shared_sample: ["AS", "MN"], own_sample: ["GC"]}
        assert "AS/MN" not in initials
        # La persona que ya existía se reutiliza, no se duplica.
        assert ana == existing_as
    finally:
        command.upgrade(config, "head")
        with engine.begin() as connection:
            connection.execute(text(f"TRUNCATE TABLE {_TABLES} RESTART IDENTITY CASCADE"))


def _group(rows):
    grouped: dict[int, list] = {}
    for row in rows:
        grouped.setdefault(row[0], []).append(row)
    return grouped
