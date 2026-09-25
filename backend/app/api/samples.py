from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.api.deps import DbSession, get_or_404
from app.config import get_settings
from app.importer.cleaning import parse_posicion
from app.models import Box, Movement, MovementAction, Rack, Sample, SampleStatus, SampleType, Section, User
from app.schemas.common import Page
from app.schemas.movement import MovementRead
from app.schemas.sample import (
    IdLookupResult,
    SampleCreate,
    SampleRead,
    SampleUpdate,
    SampleWithLocation,
    check_type_other,
)
from app.services import csv_export
from app.services.location import sample_with_location
from app.services.search import SampleFiltersDep, build_sample_query
from app.services.users import NUCLEO_INITIALS, get_or_create_user

_TYPE_LABELS = {
    "vial_celulas": "Vial de Células",
    "rna": "RNA",
    "rna_later": "RNA later",
    "proteinas": "Proteínas",
    "medio_condicionado": "Medio Condicionado",
    "reactivo": "Reactivo",
    "plasma": "Plasma",
    "otros": "Otros",
}

_STATUS_LABELS = {"active": "Activa", "withdrawn": "Retirada"}

router = APIRouter(prefix="/samples", tags=["muestras"])

_LOCATION_LOAD = joinedload(Sample.box).joinedload(Box.rack).joinedload(Rack.section)

# Columnas que la tabla del frontend permite ordenar (SamplesTable.tsx). El orden
# se aplica en la consulta paginada: ordenar solo la página ya traída daría un
# resultado engañoso con más de una página.
_SORT_COLUMNS = {
    "environ_id": (Sample.environ_id,),
    "description": (Sample.description,),
    "type": (Sample.type,),
    "owner": (User.initials,),
    "passage": (Sample.passage,),
    "status": (Sample.status,),
    "location": (Section.code, Rack.letter, Box.number, Sample.position),
    "created_at": (Sample.created_at,),
}


def _check_nucleo_owner(owner: User, *, is_core: bool | None) -> None:
    """Si Núcleo = Sí, el encargado debe ser el usuario reservado Núcleo Environ
    (docs/FORMULARIO.md), igual que ya exige el flujo de `POST /movements`."""
    if is_core and owner.initials != NUCLEO_INITIALS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Una muestra con Núcleo=Sí debe estar a cargo del usuario reservado 'NUCLEO'",
        )


@router.post("", response_model=SampleRead, status_code=status.HTTP_201_CREATED)
def create_sample(payload: SampleCreate, db: DbSession) -> Sample:
    """Alta directa de una muestra: registra además el movimiento de congelamiento
    (igual que `POST /movements`) para no dejar el historial vacío."""
    owner = get_or_404(db, User, payload.owner_id, "Usuario encargado no encontrado")
    box = get_or_404(db, Box, payload.box_id, "Caja no encontrada")
    _check_nucleo_owner(owner, is_core=payload.is_core)

    position, inferred_box_type, reason = parse_posicion(payload.position)
    if reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Posición inválida: {reason}")
    if inferred_box_type != box.box_type:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"La posición '{payload.position}' no es válida para una caja de tipo '{box.box_type}'",
        )

    operator = get_or_create_user(db, payload.operator_initials)
    sample = Sample(
        environ_id=payload.environ_id,
        description=payload.description,
        type=payload.type.value,
        type_other=payload.type_other,
        owner_id=payload.owner_id,
        passage=payload.passage,
        is_core=payload.is_core,
        box_id=payload.box_id,
        position=position,
        notes=payload.notes,
    )
    db.add(sample)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "La posición ya está ocupada por una muestra activa"
        ) from exc

    movement = Movement(
        sample_id=sample.id,
        action=MovementAction.FREEZE.value,
        date=payload.date,
        operator_id=operator.id,
        box_id=payload.box_id,
        position=position,
        note=payload.note,
    )
    db.add(movement)
    db.commit()
    db.refresh(sample)
    return sample


@router.get("", response_model=Page[SampleRead])
def list_samples(
    db: DbSession,
    status_: SampleStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[SampleRead]:
    query = db.query(Sample)
    if status_ is not None:
        query = query.filter(Sample.status == status_.value)
    total = query.count()
    items = query.order_by(Sample.id).offset((page - 1) * page_size).limit(page_size).all()
    return Page[SampleRead](items=items, total=total, page=page, page_size=page_size)


@router.get("/search", response_model=Page[SampleWithLocation])
def search_samples(
    db: DbSession,
    filters: SampleFiltersDep,
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[SampleWithLocation]:
    """Búsqueda con filtros combinables; cada resultado trae su ubicación legible.

    Los filtros viven en `services/search.py` y los comparte con el export: si se
    declararan dos veces, olvidarse de un alias haría que un filtro afectara a uno y no al
    otro, con un 200 y un CSV plausible.
    """
    query = build_sample_query(db, filters).options(_LOCATION_LOAD)

    total = query.count()
    if sort_by is not None:
        if sort_by not in _SORT_COLUMNS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"sort_by inválido: {sort_by}")
        columns = _SORT_COLUMNS[sort_by]
        order = [column.desc() if sort_dir == "desc" else column.asc() for column in columns]
        query = query.order_by(*order, Sample.id)
    else:
        query = query.order_by(Sample.id)
    samples = query.offset((page - 1) * page_size).limit(page_size).all()
    items = [sample_with_location(sample) for sample in samples]
    return Page[SampleWithLocation](items=items, total=total, page=page, page_size=page_size)


@router.get("/by-ids", response_model=IdLookupResult)
def lookup_by_ids(db: DbSession, filters: SampleFiltersDep) -> IdLookupResult:
    """Busca una lista de IDs pegada o escaneada y dice cuáles NO están.

    Con 40 tubos en la mano, la pregunta del laboratorio no es "cuáles encontraste" sino
    "cuáles me faltan". Por eso devuelve `missing` y no pagina: la lista está acotada a 500
    IDs, así que el resultado entero entra en una respuesta.

    El diff se hace acá y no en el cliente a propósito. Contra una respuesta paginada, un
    diff en el frontend reportaría como faltantes todos los que quedaron fuera de la
    página, que es exactamente la respuesta equivocada a la única pregunta que importa.
    """
    if not filters.id_list:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Falta 'environ_id_exact' con la lista de IDs a buscar.",
        )

    samples = (
        build_sample_query(db, filters)
        .options(_LOCATION_LOAD)
        .order_by(Section.code, Rack.letter, Box.number, Sample.position)
        .all()
    )
    encontrados = {sample.environ_id for sample in samples if sample.environ_id}
    faltantes = [environ_id for environ_id in filters.id_list if environ_id not in encontrados]

    return IdLookupResult(
        items=[sample_with_location(sample) for sample in samples],
        total=len(samples),
        missing=faltantes,
    )


# IMPORTANTE: esta ruta va ANTES de `/{sample_id}`. FastAPI resuelve por orden de
# declaración, así que si estuviera después, `/samples/export` entraría por la ruta del id
# e intentaría parsear "export" como entero: 422, y ningún test que llame a la función
# directamente lo detectaría.
@router.get("/export", response_class=Response)
def export_samples(db: DbSession, filters: SampleFiltersDep) -> Response:
    """El resultado de una búsqueda como CSV, con los mismos filtros que `/search`.

    Devuelve `text/csv` y el nombre del archivo en `Content-Disposition`; por eso la ruta no
    lleva extensión, a diferencia del resto de la API.
    """
    query = build_sample_query(db, filters)
    total = query.count()
    limit = get_settings().export_max_rows
    if total > limit:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"La búsqueda devuelve {total} filas y el máximo exportable es {limit}. "
            "Filtrá por sección, rack o encargado para achicarla.",
        )

    # Consulta de columnas, no de entidades: el CSV solo necesita texto, y traer modelos
    # completos costaría dos validaciones de Pydantic por fila para tirarlas enseguida.
    rows = (
        query.with_entities(
            Sample.environ_id,
            Sample.description,
            Sample.type,
            Sample.type_other,
            User.initials,
            Sample.passage,
            Sample.is_core,
            Sample.status,
            Section.code,
            Rack.letter,
            Box.number,
            Sample.position,
            Sample.created_at,
        )
        .order_by(Section.code, Rack.letter, Box.number, Sample.position)
        .all()
    )

    body = csv_export.build_csv(rows, _TYPE_LABELS, _STATUS_LABELS)
    filename = csv_export.export_filename(
        {
            "owner_initials": filters.owner_initials,
            "section_code": filters.section_code,
            "rack_letter": filters.rack_letter,
            "status": filters.status_.value if filters.status_ else None,
            "type": filters.sample_type.value if filters.sample_type else None,
        }
    )
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{sample_id}", response_model=SampleWithLocation)
def get_sample(sample_id: int, db: DbSession) -> SampleWithLocation:
    sample = db.query(Sample).options(_LOCATION_LOAD).filter(Sample.id == sample_id).one_or_none()
    if sample is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Muestra no encontrada")
    return sample_with_location(sample)


@router.patch("/{sample_id}", response_model=SampleRead)
def update_sample(sample_id: int, payload: SampleUpdate, db: DbSession) -> Sample:
    sample = get_or_404(db, Sample, sample_id, "Muestra no encontrada")
    data = payload.model_dump(exclude_unset=True)
    if "owner_id" in data and data["owner_id"] is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "owner_id no puede ser nulo")
    if "type" in data and data["type"] is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "type no puede ser nulo")
    owner = sample.owner
    if data.get("owner_id") is not None:
        owner = get_or_404(db, User, data["owner_id"], "Usuario encargado no encontrado")
    effective_type = SampleType(data["type"].value) if data.get("type") is not None else SampleType(sample.type)
    effective_type_other = data.get("type_other", sample.type_other)
    try:
        check_type_other(effective_type, effective_type_other)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    if data.get("type") is not None:
        data["type"] = data["type"].value
    _check_nucleo_owner(owner, is_core=data.get("is_core", sample.is_core))
    for field, value in data.items():
        setattr(sample, field, value)
    db.commit()
    db.refresh(sample)
    return sample


@router.get("/{sample_id}/movements", response_model=list[MovementRead])
def sample_movements(sample_id: int, db: DbSession) -> list[Movement]:
    """Historial de eventos (ingresos y retiros) de una muestra."""
    get_or_404(db, Sample, sample_id, "Muestra no encontrada")
    return (
        db.query(Movement)
        .filter(Movement.sample_id == sample_id)
        .order_by(Movement.date, Movement.id)
        .all()
    )
