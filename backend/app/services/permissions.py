from fastapi import HTTPException, status

from app.models import Sample, User
from app.services.alerts import UNASSIGNED_INITIALS


def ensure_can_modify(sample: Sample, user: User) -> None:
    """Solo el encargado de una muestra puede editarla, trasladarla o retirarla.

    Excepción: las muestras sin encargado (centinela del importador). Si nadie pudiera
    tocarlas, tampoco se les podría asignar un encargado, y la alerta de "muestras sin
    encargado" avisaría de algo que la página no deja arreglar.
    """
    if sample.owner_id == user.id:
        return
    owner = sample.owner
    if owner is not None and owner.initials == UNASSIGNED_INITIALS:
        return
    owner_label = (owner.name or owner.initials) if owner is not None else "otra persona"
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        f"Esta muestra está a cargo de {owner_label}: solo su encargado puede modificarla",
    )
