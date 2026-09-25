from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession, get_or_404
from app.models import User
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.users import derive_initials

router = APIRouter(prefix="/users", tags=["usuarios"])

_DUPLICATE_MESSAGE = "Ya existe un usuario con esas iniciales"


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DbSession) -> User:
    """Crea un usuario (encargado y/u operador).

    Se puede registrar solo con el nombre completo: las iniciales se derivan de él.
    """
    name = payload.name.strip() if payload.name else None
    initials = payload.initials.strip().upper() if payload.initials else derive_initials(db, name or "")
    user = User(initials=initials, name=name, active=payload.active)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(user)
    return user


@router.get("", response_model=list[UserRead])
def list_users(db: DbSession) -> list[User]:
    return db.query(User).order_by(User.initials).all()


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, db: DbSession) -> User:
    return get_or_404(db, User, user_id, "Usuario no encontrado")


@router.patch("/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, db: DbSession) -> User:
    user = get_or_404(db, User, user_id, "Usuario no encontrado")
    data = payload.model_dump(exclude_unset=True)
    if "initials" in data and data["initials"] is not None:
        data["initials"] = data["initials"].strip().upper()
    for field, value in data.items():
        setattr(user, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE_MESSAGE) from exc
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: DbSession) -> None:
    user = get_or_404(db, User, user_id, "Usuario no encontrado")
    db.delete(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No se puede eliminar: el usuario tiene muestras u otros registros asociados",
        ) from exc
