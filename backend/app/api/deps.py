from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db

DbSession = Annotated[Session, Depends(get_db)]


def get_or_404(db: Session, model: type, ident: int, message: str):
    obj = db.get(model, ident)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, message)
    return obj
