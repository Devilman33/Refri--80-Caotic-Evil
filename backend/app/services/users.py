from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import User

# El Núcleo Environ no es una persona: se modela como un usuario reservado para
# poder usar la misma columna `owner_id` que las muestras de propietario individual
# (docs/FORMULARIO.md: "Si Núcleo = Sí, el encargado es el Núcleo Environ").
NUCLEO_INITIALS = "NUCLEO"


def get_or_create_user(session: Session, initials: str, *, name: str | None = None) -> User:
    initials = initials.strip().upper()
    if not initials:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Las iniciales no pueden estar vacías")
    user = session.query(User).filter_by(initials=initials).one_or_none()
    if user is None:
        user = User(initials=initials, name=name)
        session.add(user)
        session.flush()
    return user
