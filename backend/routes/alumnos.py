from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db import get_db
from utils.accounts_repo import list_alumnos, get_alumno_by_id


router = APIRouter()


@router.get("/")
def alumnos_list(
    q: Optional[str] = Query(default=None, description="Buscar por nombre/email/nivel"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    try:
        return list_alumnos(db, q, limit, offset)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"alumnos_list error: {e}")


@router.get("/{alumno_id}")
def alumnos_get(alumno_id: str, db: Session = Depends(get_db)):
    try:
        data = get_alumno_by_id(db, alumno_id)
        if not data:
            try:
                data = get_alumno_by_id(db, int(alumno_id))
            except Exception:
                pass
        if not data:
            raise HTTPException(status_code=404, detail="Alumno no encontrado")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"alumnos_get error: {e}")

