from sqlalchemy.orm import Session

from app.models import User


def get_or_create_user(session: Session, initials: str, *, name: str | None = None) -> User:
    initials = initials.strip().upper()
    user = session.query(User).filter_by(initials=initials).one_or_none()
    if user is None:
        user = User(initials=initials, name=name)
        session.add(user)
        session.flush()
    return user
