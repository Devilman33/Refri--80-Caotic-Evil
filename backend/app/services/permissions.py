from fastapi import HTTPException, status

from app.models import Sample, User
from app.services.alerts import UNASSIGNED_INITIALS


def ensure_can_modify(sample: Sample, user: User) -> None:
    """Solo los encargados de una muestra (cualquiera de ellos, si son varios) pueden
    editarla, trasladarla o retirarla.

    Excepción: las muestras sin encargado (centinela del importador). Si nadie pudiera
    tocarlas, tampoco se les podría asignar un encargado, y la alerta de "muestras sin
    encargado" avisaría de algo que la página no deja arreglar.
    """
    owners = sample.owners
    if any(owner.id == user.id for owner in owners):
        return
    if not owners or any(owner.initials == UNASSIGNED_INITIALS for owner in owners):
        return
    names = ", ".join(owner.name or owner.initials for owner in owners)
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        f"Esta muestra está a cargo de {names}: solo sus encargados pueden modificarla",
    )
