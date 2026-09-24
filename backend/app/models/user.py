from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    """Persona que puede ser encargada de muestras u operar movimientos.

    Se crea a partir de las iniciales que trae el Excel (`docs/DATOS.md`).
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    initials: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"User(id={self.id!r}, initials={self.initials!r})"
