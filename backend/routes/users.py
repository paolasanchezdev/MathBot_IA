from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db import get_db
from utils.users_reflect import list_users, search_users, get_user_by_id, guess_user_id_column


router = APIRouter()


@router.get("/")
def users_list(
    q: Optional[str] = Query(default=None, description="Búsqueda por nombre/email"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    try:
        if q and q.strip():
            return search_users(db, q.strip(), limit=limit, offset=offset)
        return list_users(db, limit=limit, offset=offset)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"users_list error: {e}")


@router.get("/{user_id}")
def users_get(user_id: str, db: Session = Depends(get_db)):
    try:
        data = get_user_by_id(db, user_id)
        if not data:
            # si la PK no es texto, intentar castear a int
            try:
                uid = int(user_id)
                data = get_user_by_id(db, uid)
            except Exception:
                pass
        if not data:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"users_get error: {e}")


@router.get("/meta/pk")
def users_pk_meta(db: Session = Depends(get_db)):
    try:
        pk = guess_user_id_column(db)
        if not pk:
            raise HTTPException(status_code=404, detail="No se pudo determinar la PK")
        return {"pk": pk}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"users_pk_meta error: {e}")

