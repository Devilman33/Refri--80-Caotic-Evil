import unicodedata

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import User

_MAX_INITIALS = 10


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


def derive_initials(session: Session, name: str) -> str:
    """Iniciales para alguien que se registró solo con su nombre completo.

    Las iniciales siguen siendo la clave corta que usan el Excel y el Google Form
    (`GC`, `JCI`), así que toda persona necesita unas. Si ya están tomadas se agrega un
    número (`GC2`) en vez de fallar: quien se registra no tiene por qué saber que otra
    persona con las mismas iniciales ya existe.
    """
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    words = [word for word in ascii_name.replace("-", " ").split() if word[:1].isalpha()]
    base = "".join(word[0] for word in words).upper()[: _MAX_INITIALS - 1] or "U"
    candidate = base
    suffix = 2
    while session.query(User.id).filter_by(initials=candidate).first() is not None:
        candidate = f"{base}{suffix}"
        suffix += 1
    return candidate
