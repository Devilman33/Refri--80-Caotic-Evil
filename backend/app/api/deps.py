from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

DbSession = Annotated[Session, Depends(get_db)]


def get_or_404(db: Session, model: type, ident: int, message: str):
    obj = db.get(model, ident)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, message)
    return obj


def get_current_user(db: DbSession, x_user_id: Annotated[int | None, Header()] = None) -> User:
    """La persona que eligió quién es al entrar a la página (header `X-User-Id`).

    Es identificación, no autenticación: no hay contraseña (docs/adr/0002-autenticacion.md).
    Alcanza para lo que se pidió, que cada uno no toque por error las muestras de otro, y
    para dejar registrado quién hizo cada cambio.
    """
    if x_user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifícate para registrar cambios")
    user = db.get(User, x_user_id)
    if user is None or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "El usuario de la sesión no existe o está desactivado")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
