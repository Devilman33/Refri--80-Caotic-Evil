"""Modelos genéricos compartidos por varios endpoints."""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Resultado paginado: `items` de la página actual más el total real de filas."""

    items: list[T]
    total: int
    page: int
    page_size: int
