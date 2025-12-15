from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from utils.accounts_repo import get_user_by_id
from utils.security import decode_access_token
from utils.teachers_repo import (
    ensure_teacher_profile,
    get_teacher_profile,
    list_teacher_students,
    upsert_teacher_profile,
)


router = APIRouter()

_TEACHER_ROLES = {"maestro", "maestra", "docente", "profesor", "profesora", "teacher"}


def _resolve_token(request: Request, authorization: Optional[str]) -> Optional[str]:
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
    try:
        cookie_token = request.cookies.get("access_token")
        if cookie_token:
            return cookie_token
    except Exception:
        pass
    return None


def _teacher_subject(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> int:
    token = _resolve_token(request, authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Falta token de acceso")
    claims = decode_access_token(token)
    if not claims or claims.get("id") is None:
        raise HTTPException(status_code=401, detail="Token invalido o expirado")
    teacher_id = claims["id"]
    user = get_user_by_id(db, teacher_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    role = str(user.get("rol") or "").strip().lower()
    if role not in _TEACHER_ROLES:
        raise HTTPException(status_code=403, detail="Se requiere rol docente")
    ensure_teacher_profile(db, teacher_id)
    return teacher_id


class TeacherProfileUpdate(BaseModel):
    anios: Optional[List[int]] = None
    especialidades: Optional[List[str]] = None
    notas: Optional[str] = None


@router.get("/me")
def teacher_me(teacher_id: int = Depends(_teacher_subject), db: Session = Depends(get_db)):
    profile = get_teacher_profile(db, teacher_id)
    if not profile:
        profile = ensure_teacher_profile(db, teacher_id)
    summary = list_teacher_students(db, teacher_id, limit=5, offset=0)
    return {
        "teacher": profile,
        "stats": summary.get("stats", {}),
        "total_students": summary.get("count", 0),
        "students_preview": summary.get("items", []),
    }


@router.put("/me")
def teacher_update(
    body: TeacherProfileUpdate,
    teacher_id: int = Depends(_teacher_subject),
    db: Session = Depends(get_db),
):
    years = body.anios or []
    specs = [s for s in (body.especialidades or []) if s]
    profile = upsert_teacher_profile(db, teacher_id, years, specs, body.notas)
    return {"teacher": profile}


@router.get("/me/students")
def teacher_students(
    teacher_id: int = Depends(_teacher_subject),
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None, description="Buscar por nombre, email o nivel"),
    anio: Optional[int] = Query(default=None, ge=0),
    especialidad: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    summary = list_teacher_students(
        db,
        teacher_id,
        q=q,
        anio=anio,
        especialidad=especialidad,
        limit=limit,
        offset=offset,
    )
    return summary

