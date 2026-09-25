"""Filtros de búsqueda de muestras, en un solo lugar.

`/samples/search` y `/samples/export` tienen que filtrar **idéntico**: si divergen, el
laboratorio exporta un CSV que no coincide con lo que vio en pantalla y no hay nada en la
respuesta que lo delate (200, columnas correctas, filas de menos).

Por eso los filtros se declaran una sola vez, como dependencia de FastAPI, y no se aplican
a mano en cada endpoint. Dos de ellos tienen alias (`type`, `status`): copiarlos a mano y
olvidarse de un alias haría que `?type=rna` filtrara la búsqueda y no el export, en
silencio.

La paginación y el orden NO viven acá a propósito: el export no pagina, y si compartiera
el modelo publicaría en /docs parámetros que ignora.
"""

# Sin `from __future__ import annotations` a proposito: FastAPI resuelve las anotaciones
# de `__init__` en tiempo de ejecucion para inyectar los Query(...), y con anotaciones
# diferidas las ve como strings y falla con "is not fully defined".
from dataclasses import dataclass
from datetime import date
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Query as OrmQuery, Session

from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, SampleType, Section, User
from app.services.owners import has_owner

# Tope de IDs que se pueden pegar de una vez. Una lista más larga que esto casi siempre es
# un pegado accidental de una columna entera del Excel.
MAX_ID_LIST = 500

# Separadores de un pegado real: Excel da saltos de línea, un scanner puede dar tabs, y
# alguien que escribe a mano usa comas o espacios.
_ID_SEPARATORS = ",;\n\r\t "


def parse_id_list(raw: str) -> list[str]:
    """Normaliza un pegado de IDs a una lista sin repetidos, conservando el orden.

    Saca las comillas que Excel agrega al copiar celdas: sin eso, `"BP001"` no matchea
    nunca y el operador ve "no encontrado" para un tubo que sí está.
    """
    for separator in _ID_SEPARATORS:
        raw = raw.replace(separator, "\n")
    seen: set[str] = set()
    result: list[str] = []
    for chunk in raw.split("\n"):
        value = chunk.strip().strip("\"'").strip().upper()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


@dataclass
class SampleFilters:
    """Los 13 filtros de la búsqueda. Consumido con `Depends()` por los dos endpoints."""

    environ_id: str | None = None
    environ_id_exact: str | None = None
    description: str | None = None
    owner_initials: str | None = None
    sample_type: SampleType | None = None
    is_core: bool | None = None
    passage: int | None = None
    status_: SampleStatus | None = None
    date_from: date | None = None
    date_to: date | None = None
    section_code: str | None = None
    rack_letter: str | None = None
    box_number: int | None = None

    def __init__(
        self,
        environ_id: str | None = Query(
            default=None, description="Coincidencia PARCIAL. Para una lista exacta usá environ_id_exact."
        ),
        environ_id_exact: str | None = Query(
            default=None,
            description=(
                "Lista de IDs Environ con coincidencia EXACTA, separados por coma, punto y coma, "
                f"espacio o salto de línea. Máximo {MAX_ID_LIST}."
            ),
        ),
        description: str | None = None,
        owner_initials: str | None = None,
        sample_type: SampleType | None = Query(default=None, alias="type"),
        is_core: bool | None = None,
        passage: int | None = None,
        status_: SampleStatus | None = Query(default=None, alias="status"),
        date_from: date | None = None,
        date_to: date | None = None,
        section_code: str | None = None,
        rack_letter: str | None = None,
        box_number: int | None = None,
    ) -> None:
        # `environ_id` filtra parcial y `environ_id_exact` filtra exacto: se parecen
        # demasiado como para dejar que convivan en silencio. Un typo entre los dos no
        # daría error, solo resultados distintos a los esperados.
        if environ_id and environ_id_exact:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "No se pueden combinar 'environ_id' (parcial) con 'environ_id_exact' (lista exacta): "
                "filtran distinto. Usá uno de los dos.",
            )
        if environ_id_exact is not None:
            ids = parse_id_list(environ_id_exact)
            if len(ids) > MAX_ID_LIST:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Se pegaron {len(ids)} IDs y el máximo es {MAX_ID_LIST}. "
                    "Dividí la lista en tandas más chicas.",
                )
            self.id_list = ids
        else:
            self.id_list = []

        self.environ_id = environ_id
        self.environ_id_exact = environ_id_exact
        self.description = description
        self.owner_initials = owner_initials
        self.sample_type = sample_type
        self.is_core = is_core
        self.passage = passage
        self.status_ = status_
        self.date_from = date_from
        self.date_to = date_to
        self.section_code = section_code
        self.rack_letter = rack_letter
        self.box_number = box_number


SampleFiltersDep = Annotated[SampleFilters, Depends()]


def build_sample_query(db: Session, filters: SampleFilters) -> OrmQuery:
    """Consulta con los joins de ubicación y los filtros aplicados, sin orden ni paginado."""
    query = (
        db.query(Sample)
        .join(Box, Sample.box_id == Box.id)
        .join(Rack, Box.rack_id == Rack.id)
        .join(Section, Rack.section_id == Section.id)
    )
    if filters.environ_id:
        query = query.filter(Sample.environ_id.ilike(f"%{filters.environ_id}%"))
    if filters.id_list:
        # Insensible a mayúsculas sin perder el índice de environ_id en el caso común:
        # el Excel los escribe en mayúscula y `parse_id_list` ya normalizó la entrada.
        query = query.filter(Sample.environ_id.in_(filters.id_list))
    if filters.description:
        query = query.filter(Sample.description.ilike(f"%{filters.description}%"))
    if filters.owner_initials:
        query = query.filter(has_owner(filters.owner_initials))
    if filters.sample_type is not None:
        query = query.filter(Sample.type == filters.sample_type.value)
    if filters.is_core is not None:
        query = query.filter(Sample.is_core == filters.is_core)
    if filters.passage is not None:
        query = query.filter(Sample.passage == filters.passage)
    if filters.status_ is not None:
        query = query.filter(Sample.status == filters.status_.value)
    if filters.section_code:
        query = query.filter(Section.code == filters.section_code.strip().upper())
    if filters.rack_letter:
        query = query.filter(Rack.letter == filters.rack_letter.strip().upper())
    if filters.box_number is not None:
        query = query.filter(Box.number == filters.box_number)
    if filters.date_from or filters.date_to:
        freeze_dates = select(Movement.sample_id).where(Movement.action == MovementAction.FREEZE.value)
        if filters.date_from:
            freeze_dates = freeze_dates.where(Movement.date >= filters.date_from)
        if filters.date_to:
            freeze_dates = freeze_dates.where(Movement.date <= filters.date_to)
        query = query.filter(Sample.id.in_(freeze_dates))
    return query
