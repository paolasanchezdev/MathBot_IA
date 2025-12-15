from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from db import get_db
from utils.teachers_repo import get_teacher_profile
from utils.accounts_repo import (
    get_user_by_id,
    get_alumno_by_id,
    update_user,
    upsert_alumno_for_user,
    get_user_secret_by_id,
    email_in_use,
)
from utils.security import decode_access_token, verify_password


router = APIRouter()


def _subject_from_auth(authorization: Optional[str] = Header(default=None)) -> int:
    if not authorization:
        raise HTTPException(status_code=401, detail="Falta Authorization")
    try:
        scheme, token = authorization.split(" ", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail="Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Se requiere Bearer token")
    sub = decode_access_token(token)
    if not sub or sub.get("id") is None:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    return sub["id"]


def _subject_from_request(request: Request, authorization: Optional[str] = Header(default=None)) -> int:
    """Obtiene el sujeto desde Authorization Bearer o cookie HttpOnly 'access_token'."""
    token: Optional[str] = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Falta token")
    sub = decode_access_token(token)
    if not sub or sub.get("id") is None:
        raise HTTPException(status_code=401, detail="Token invǭlido o expirado")
    return sub["id"]


@router.get("/me")
def account_me(db: Session = Depends(get_db), user_id: int = Depends(_subject_from_request)):
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    alumno = get_alumno_by_id(db, user_id)
    docente = get_teacher_profile(db, user_id)
    return {"user": user, "alumno": alumno, "docente": docente}


class AccountUpdate(BaseModel):
    nombre: Optional[str] = None
    email: Optional[EmailStr] = None
    # Alumno
    nivel: Optional[str] = None
    especialidad: Optional[str] = None


@router.put("/me")
def account_update(body: AccountUpdate, db: Session = Depends(get_db), user_id: int = Depends(_subject_from_request)):
    try:
        # Normalizar entradas
        import unicodedata as _ud
        nombre = _ud.normalize("NFKC", body.nombre or "") if body.nombre is not None else None
        email = _ud.normalize("NFKC", body.email) if body.email is not None else None

        # Validar email en uso
        if email is not None and email_in_use(db, email, exclude_user_id=user_id):
            raise HTTPException(status_code=409, detail="El email ya está en uso")

        updated_user = update_user(db, user_id, nombre=nombre, email=email)
        if not updated_user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        # Validar valores permitidos para alumno
        updated_alumno = None
        if body.nivel is not None or body.especialidad is not None:
            allowed_levels = [
                (lvl.strip()) for lvl in (
                    ("1º Año de Bachillerato,2º Año de Bachillerato," + ("" + ("")).strip())
                ).split(",") if lvl.strip()
            ]
            nivel = body.nivel
            if nivel is not None and allowed_levels and nivel not in allowed_levels:
                raise HTTPException(status_code=400, detail="Nivel no válido")
            allowed_specs = [s for s in ("", "Software", "Automotriz", "General", "Salud")]
            esp = body.especialidad
            if esp is not None and esp not in allowed_specs:
                raise HTTPException(status_code=400, detail="Especialidad no válida")
            updated_alumno = upsert_alumno_for_user(db, user_id, nivel=nivel, especialidad=esp)
        return {"user": updated_user, "alumno": updated_alumno}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo actualizar: {e}")


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/password")
def account_change_password(body: PasswordChange, db: Session = Depends(get_db), user_id: int = Depends(_subject_from_request)):
    # Reglas de fortaleza mínimas
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 8 caracteres")
    # Verificar actual
    sec = get_user_secret_by_id(db, user_id)
    if not sec or not sec.get("password_hash"):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if not verify_password(body.current_password, sec["password_hash"]):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
    # Actualizar
    try:
        updated = update_user(db, user_id, password=body.new_password)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo cambiar la contraseña: {e}")

