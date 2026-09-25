from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func

from app.api.deps import DbSession, get_or_404
from app.models import AnomalyStatus, ImportAnomaly, ImportRun
from app.schemas.common import Page
from app.schemas.imports import (
    AnomalyGroup,
    AnomalyRead,
    AnomalyResolveRequest,
    AnomalyResolveResult,
    ImportRunRead,
)
from app.services.users import get_or_create_user

router = APIRouter(prefix="/imports", tags=["importaciones"])

# Las celdas del Excel son texto libre y pueden traer nombres del personal
# (docs/DATOS.md, "Propietario de Caja": `12-05-25 VF`). Se sirven recortadas: alcanza
# para reconocer el problema sin publicar el campo entero en un endpoint sin autenticación.
_MAX_VALUE_CHARS = 80


def _truncate(value: str) -> str:
    return value if len(value) <= _MAX_VALUE_CHARS else value[:_MAX_VALUE_CHARS] + "…"


@router.get("", response_model=list[ImportRunRead])
def list_runs(db: DbSession, limit: int = Query(default=20, ge=1, le=100)) -> list[ImportRun]:
    """Las importaciones, de la más reciente a la más vieja.

    Es la serie de calidad de datos: dos corridas seguidas responden "¿mejoró el Excel del
    laboratorio desde la última vez?", que es la única métrica que a este proyecto le
    importa, y sale gratis de los contadores que el importador ya calculaba.
    """
    return db.query(ImportRun).order_by(ImportRun.id.desc()).limit(limit).all()


@router.get("/{run_id}/anomalies/groups", response_model=list[AnomalyGroup])
def anomaly_groups(db: DbSession, run_id: int) -> list[AnomalyGroup]:
    """Anomalías agrupadas por motivo. Es la vista por defecto, y no un extra.

    Una lista plana de varios miles de filas es una hoja de cálculo en una página web:
    "página 1 de 37" no es accionable. "1.412 filas con fecha fuera de rango" sí: es una
    decisión que alguien puede tomar en un minuto, y habilita marcar el grupo entero.
    """
    get_or_404(db, ImportRun, run_id, "Importación no encontrada")
    rows = (
        db.query(
            ImportAnomaly.reason,
            ImportAnomaly.column,
            func.count(ImportAnomaly.id),
            func.count(ImportAnomaly.id).filter(ImportAnomaly.status == AnomalyStatus.PENDING.value),
        )
        .filter(ImportAnomaly.run_id == run_id)
        .group_by(ImportAnomaly.reason, ImportAnomaly.column)
        .order_by(func.count(ImportAnomaly.id).desc())
        .all()
    )
    return [
        AnomalyGroup(reason=reason, column=column, total=total, pending=pending)
        for reason, column, total, pending in rows
    ]


@router.get("/{run_id}/anomalies", response_model=Page[AnomalyRead])
def list_anomalies(
    db: DbSession,
    run_id: int,
    reason: str | None = None,
    column: str | None = None,
    anomaly_status: AnomalyStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[AnomalyRead]:
    get_or_404(db, ImportRun, run_id, "Importación no encontrada")
    query = db.query(ImportAnomaly).filter(ImportAnomaly.run_id == run_id)
    if reason:
        query = query.filter(ImportAnomaly.reason == reason)
    if column:
        query = query.filter(ImportAnomaly.column == column)
    if anomaly_status is not None:
        query = query.filter(ImportAnomaly.status == anomaly_status.value)

    total = query.count()
    anomalies = query.order_by(ImportAnomaly.row, ImportAnomaly.id).offset((page - 1) * page_size).limit(page_size).all()
    items = [
        AnomalyRead(
            id=anomaly.id,
            row=anomaly.row,
            column=anomaly.column,
            value=_truncate(anomaly.value),
            reason=anomaly.reason,
            status=AnomalyStatus(anomaly.status),
            resolved_by=anomaly.resolved_by,
            resolved_at=anomaly.resolved_at,
        )
        for anomaly in anomalies
    ]
    return Page[AnomalyRead](items=items, total=total, page=page, page_size=page_size)


@router.patch("/{run_id}/anomalies", response_model=AnomalyResolveResult)
def resolve_anomalies(db: DbSession, run_id: int, payload: AnomalyResolveRequest) -> AnomalyResolveResult:
    """Marca un grupo entero de anomalías, o unas pocas por id.

    Por grupo y no solo por fila: el laboratorio corrige CLASES de errores ("todas las
    fechas mal tipeadas de esta columna"), y marcar de a una varios miles de veces es peor
    que no tener triage.
    """
    get_or_404(db, ImportRun, run_id, "Importación no encontrada")

    query = db.query(ImportAnomaly).filter(ImportAnomaly.run_id == run_id)
    if payload.ids:
        query = query.filter(ImportAnomaly.id.in_(payload.ids))
    elif payload.reason:
        query = query.filter(ImportAnomaly.reason == payload.reason)
        if payload.column:
            query = query.filter(ImportAnomaly.column == payload.column)
    else:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Indicá 'ids' o 'reason': marcar TODAS las anomalías de una corrida de una vez "
            "no es una operación que se quiera hacer sin querer.",
        )

    operator = get_or_create_user(db, payload.operator_initials)
    now = datetime.now(timezone.utc)
    updated = 0
    for anomaly in query.all():
        anomaly.status = payload.status.value
        # Volver a "pendiente" borra quién y cuándo: si no, quedaría una firma de una
        # resolución que ya no existe.
        anomaly.resolved_by = None if payload.status == AnomalyStatus.PENDING else operator.initials
        anomaly.resolved_at = None if payload.status == AnomalyStatus.PENDING else now
        updated += 1

    db.commit()
    return AnomalyResolveResult(updated=updated, status=payload.status)
