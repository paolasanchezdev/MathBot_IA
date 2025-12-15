from typing import Optional, List
import json
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from utils.accounts_repo import get_user_by_email, get_user_by_id, create_user, create_alumno_for_user
from utils.teachers_repo import upsert_teacher_profile
from utils.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_access_token_verbose,
    decode_refresh_token_verbose,
)
from fastapi import Header


router = APIRouter()


class LoginRequest(BaseModel):
    # Acepta Unicode y emails no estrictos (con acentos)
    email: str
    password: str


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db), response: Response = None):
    # Normalizar para evitar problemas con acentos/combining marks
    import unicodedata as _ud
    email_norm = _ud.normalize("NFKC", (body.email or "").strip())
    user = get_user_by_email(db, email_norm)
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    pw_hash = user.get("password_hash")
    if not pw_hash or not verify_password(body.password, pw_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    sub = {"id": user["id"], "email": user["email"], "rol": user.get("rol")}
    token = create_access_token(sub)
    refresh = create_refresh_token(sub)
    # Set cookies HttpOnly para alternativa basada en cookies
    try:
        if response is not None:
            max_age = int((60 * int((__import__('os').getenv('ACCESS_TOKEN_EXPIRE_MINUTES', '1440')))))
            response.set_cookie(
                key="access_token",
                value=token,
                httponly=True,
                samesite="Lax",
                secure=False,
                max_age=max_age,
                path="/",
            )
            r_max_age = int((60 * int((__import__('os').getenv('REFRESH_TOKEN_EXPIRE_MINUTES', str(60*24*7))))))
            response.set_cookie(
                key="refresh_token",
                value=refresh,
                httponly=True,
                samesite="Lax",
                secure=False,
                max_age=r_max_age,
                path="/",
            )
    except Exception:
        pass
    # No exponemos password_hash
    return {"access_token": token, "token_type": "bearer", "user": {k: v for k, v in user.items() if k != "password_hash"}}


@router.post("/logout")
def logout(response: Response):
    try:
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/")
    except Exception:
        pass
    return {"ok": True}


class RegisterRequest(BaseModel):
    nombre: str
    email: str
    password: str
    rol: str
    nivel: str | None = None
    especialidad: str | None = None
    docente_anios: Optional[List[int]] = None
    docente_especialidades: Optional[List[str]] = None
    docente_notas: Optional[str] = None


@router.post("/register")
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    import unicodedata as _ud
    email_norm = _ud.normalize("NFKC", (body.email or "").strip())
    nombre_norm = _ud.normalize("NFKC", (body.nombre or "").strip())
    rol_norm = _ud.normalize("NFKC", (body.rol or "").strip().lower())

    # ¿Existe email?
    if get_user_by_email(db, email_norm):
        raise HTTPException(status_code=409, detail="El email ya está registrado")

    try:
        user = create_user(db, nombre_norm, email_norm, body.password, rol_norm or "alumno")
        alumno_info = None
        alumno_error = None
        docente_info = None
        docente_error = None

        def _normalize_multi(value):
            if value is None:
                return []
            if isinstance(value, str):
                text_val = value.strip()
                if not text_val:
                    return []
                if text_val.startswith("["):
                    try:
                        parsed = json.loads(text_val)
                        if isinstance(parsed, list):
                            return _normalize_multi(parsed)
                    except Exception:
                        pass
                parts = [segment.strip() for segment in text_val.split(',')]
                return _normalize_multi([p for p in parts if p])
            if isinstance(value, (list, tuple, set)):
                cleaned = []
                for item in value:
                    if item is None:
                        continue
                    text_item = str(item).strip()
                    if not text_item:
                        continue
                    cleaned.append(item)
                return cleaned
            return _normalize_multi([value])

        student_roles = {"estudiante", "alumno", "student"}
        teacher_roles = {"docente", "maestro", "maestra", "profesor", "profesora", "teacher"}

        if rol_norm in student_roles:
            try:
                alumno_info = create_alumno_for_user(db, user["id"], body.nivel, body.especialidad)
            except Exception as e:
                alumno_error = str(e)

        if rol_norm in teacher_roles:
            try:
                raw_years = _normalize_multi(body.docente_anios)
                years = []
                for item in raw_years:
                    try:
                        years.append(int(str(item).strip()))
                    except Exception:
                        continue
                raw_specs = [str(x).strip() for x in _normalize_multi(body.docente_especialidades)]
                specs = [s for s in raw_specs if s]
                docente_info = upsert_teacher_profile(db, user["id"], years, specs, body.docente_notas)
            except Exception as e:
                docente_error = str(e)

        sub = {"id": user["id"], "email": email_norm, "rol": user.get("rol")}
        token = create_access_token(sub)
        refresh = create_refresh_token(sub)
        resp = {"access_token": token, "token_type": "bearer", "user": user, "refresh_token": refresh}
        if alumno_info:
            resp["alumno"] = alumno_info
        if alumno_error:
            resp["alumno_error"] = alumno_error
        if docente_info:
            resp["docente"] = docente_info
        if docente_error:
            resp["docente_error"] = docente_error
        return resp
    except Exception as e:
        # Devuelve detalle útil en desarrollo
        msg = str(e)
        raise HTTPException(status_code=400, detail=f"Error al crear usuario: {msg}")


def _get_bearer_token(authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def _get_refresh_from_request(request: Request, authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    # Intenta Header Bearer primero
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
    # Luego cookie HttpOnly
    try:
        tok = request.cookies.get("refresh_token")
        if tok:
            return tok
    except Exception:
        pass
    return None


@router.get("/me")
def me(db: Session = Depends(get_db), token: Optional[str] = Depends(_get_bearer_token)):
    if not token:
        raise HTTPException(status_code=401, detail="Falta token")
    claims = decode_access_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    uid = claims.get("id")
    user = get_user_by_id(db, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"user": user}


@router.post("/refresh")
def refresh_token(request: Request, response: Response, db: Session = Depends(get_db), token: Optional[str] = Depends(_get_refresh_from_request)):
    if not token:
        raise HTTPException(status_code=401, detail="Falta refresh token")
    sub, reason = decode_refresh_token_verbose(token)
    if sub is None:
        raise HTTPException(status_code=401, detail=f"Refresh inválido: {reason}")
    # Reemitir access (y opcionalmente refresh)
    new_access = create_access_token(sub)
    try:
        max_age = int((60 * int((__import__('os').getenv('ACCESS_TOKEN_EXPIRE_MINUTES', '1440')))))
        response.set_cookie(
            key="access_token",
            value=new_access,
            httponly=True,
            samesite="Lax",
            secure=False,
            max_age=max_age,
            path="/",
        )
        # Rotación suave del refresh
        new_refresh = create_refresh_token(sub)
        r_max_age = int((60 * int((__import__('os').getenv('REFRESH_TOKEN_EXPIRE_MINUTES', str(60*24*7))))))
        response.set_cookie(
            key="refresh_token",
            value=new_refresh,
            httponly=True,
            samesite="Lax",
            secure=False,
            max_age=r_max_age,
            path="/",
        )
    except Exception:
        pass
    # Opcionalmente devolver user breve
    uid = sub.get("id") if isinstance(sub, dict) else None
    user = get_user_by_id(db, uid) if uid is not None else None
    out = {"access_token": new_access, "token_type": "bearer"}
    if user:
        out["user"] = {k: v for k, v in user.items() if k != "password_hash"}
    return out


@router.get("/token/inspect")
def token_inspect(token: Optional[str] = Depends(_get_bearer_token)):
    """Diagnóstico de token (desarrollo). Devuelve claims o razón del fallo."""
    import os as _os
    if not (_os.getenv("DEBUG_JWT", "0").lower() in {"1", "true", "yes"}):
        raise HTTPException(status_code=403, detail="Token inspect deshabilitado")
    if not token:
        raise HTTPException(status_code=400, detail="Falta Authorization Bearer")
    sub, reason = decode_access_token_verbose(token)
    if sub is not None:
        return {"ok": True, "sub": sub}
    return {"ok": False, "reason": reason}
