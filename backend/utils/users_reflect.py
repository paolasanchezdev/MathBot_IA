import os
from typing import List, Optional, Tuple, Dict, Any

from sqlalchemy import MetaData, Table, inspect, select, or_, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session


_LIKELY_USER_TABLES = [
    # prioridad: alumnos
    "alumnos",
    "estudiantes",
    "students",
    "usuarios",
    "users",
]

_SENSITIVE_COLS = {"password", "pass", "passwd", "contrasena", "hash", "token", "salt"}
_NAME_COLS = [
    "nombre",
    "apellidos",
    "apellido",
    "first_name",
    "last_name",
    "name",
    "username",
]
_EMAIL_COLS = ["correo", "correo_electronico", "email", "mail"]


def _choose_users_table_name(engine: Engine) -> Optional[str]:
    configured = (os.getenv("USERS_TABLE") or os.getenv("ALUMNOS_TABLE") or "").strip()
    insp = inspect(engine)
    tables = set(insp.get_table_names(schema="public"))
    if configured:
        if configured in tables:
            return configured
    for t in _LIKELY_USER_TABLES:
        if t in tables:
            return t
    return None


def reflect_users_table(engine: Engine) -> Tuple[Optional[Table], Optional[str], List[str]]:
    """Reflect a users/alumnos table. Returns (table, pk_col, safe_columns)."""
    table_name = _choose_users_table_name(engine)
    if not table_name:
        return None, None, []
    md = MetaData()
    tbl = Table(table_name, md, autoload_with=engine, schema=None)

    # Primary key column (first pk if composite)
    insp = inspect(engine)
    pk_cols = insp.get_pk_constraint(table_name, schema=None).get("constrained_columns") or []
    pk = pk_cols[0] if pk_cols else None

    # Safe columns: all except sensitive
    cols = [c.name for c in tbl.columns]
    safe = [c for c in cols if c.lower() not in _SENSITIVE_COLS]
    return tbl, pk, safe


def row_to_safe_dict(row: Any, safe_cols: List[str]) -> Dict[str, Any]:
    return {c: getattr(row, c) if hasattr(row, c) else row._mapping.get(c) for c in safe_cols}


def list_users(db: Session, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    engine = db.get_bind()
    tbl, pk, safe = reflect_users_table(engine)
    if tbl is None:
        return {"error": "Tabla de usuarios no encontrada"}
    q = select(tbl).limit(max(1, min(limit, 200))).offset(max(0, offset))
    rows = db.execute(q).fetchall()
    return {
        "table": tbl.name,
        "pk": pk,
        "count": len(rows),
        "items": [row_to_safe_dict(r, safe) for r in rows],
    }


def get_user_by_id(db: Session, user_id: Any) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    tbl, pk, safe = reflect_users_table(engine)
    if tbl is None or not pk:
        return None
    q = select(tbl).where(getattr(tbl.c, pk) == user_id).limit(1)
    row = db.execute(q).fetchone()
    if not row:
        return None
    return row_to_safe_dict(row, safe)


def search_users(db: Session, query: str, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    engine = db.get_bind()
    tbl, pk, safe = reflect_users_table(engine)
    if tbl is None:
        return {"error": "Tabla de usuarios no encontrada"}

    cols = {c.lower(): getattr(tbl.c, c) for c in [c.name for c in tbl.columns]}
    matches = []
    for name_col in _NAME_COLS + _EMAIL_COLS:
        col = cols.get(name_col)
        if col is not None:
            matches.append(col.ilike(f"%{query}%"))
    # fallback: si no hay columnas conocidas, buscar en columnas de texto
    if not matches:
        for c in tbl.c:
            try:
                if getattr(c.type, "python_type", str) is str:
                    matches.append(c.ilike(f"%{query}%"))
            except Exception:
                continue

    q = select(tbl).where(or_(*matches)) if matches else select(tbl).limit(limit)
    q = q.limit(max(1, min(limit, 200))).offset(max(0, offset))
    rows = db.execute(q).fetchall()
    return {
        "table": tbl.name,
        "pk": pk,
        "count": len(rows),
        "items": [row_to_safe_dict(r, safe) for r in rows],
    }


def guess_user_id_column(db: Session) -> Optional[str]:
    engine = db.get_bind()
    _tbl, pk, _safe = reflect_users_table(engine)
    return pk
