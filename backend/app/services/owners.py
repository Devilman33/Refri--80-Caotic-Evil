"""Expresiones SQL sobre los encargados de una muestra (tabla `sample_owners`).

Una muestra puede tener varios encargados, así que "filtrar por encargado", "ordenar por
encargado" o "exportar el encargado" ya no son un join simple: viven acá para que la
búsqueda, el export, las alertas y el autocompletado los resuelvan igual.
"""

from sqlalchemy import func, literal_column, select
from sqlalchemy.dialects.postgresql import aggregate_order_by

from app.models import Sample, User, sample_owners


def has_owner(initials: str):
    """Condición: la muestra tiene a esa persona entre sus encargados."""
    return Sample.owners.any(User.initials == initials.strip().upper())


def owners_label():
    """Iniciales de todos los encargados, ordenadas y unidas con `/` (`AS/MN`): la misma
    forma en que las escribe el Excel."""
    return (
        select(func.string_agg(User.initials, aggregate_order_by(literal_column("'/'"), User.initials)))
        .select_from(sample_owners.join(User, sample_owners.c.user_id == User.id))
        .where(sample_owners.c.sample_id == Sample.id)
        .correlate(Sample)
        .scalar_subquery()
    )
