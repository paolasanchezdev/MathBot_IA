import os
from typing import Any, Dict, Optional, Tuple, List

from sqlalchemy import MetaData, Table, inspect, select, or_, and_, join, func
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from utils.security import hash_password


def _role_map(raw: str) -> str:
    """Mapea roles recibidos a los valores válidos del enum en DB.
    Permite override por .env: ROLE_STUDENT, ROLE_TEACHER.
    """
    r = (raw or "").strip().lower()
    map_cfg = {
        "student": os.getenv("ROLE_STUDENT") or os.getenv("ROLE_ALUMNO") or "alumno",
        "estudiante": os.getenv("ROLE_STUDENT") or os.getenv("ROLE_ALUMNO") or "alumno",
        "alumno": os.getenv("ROLE_ALUMNO") or "alumno",
        "teacher": os.getenv("ROLE_TEACHER") or os.getenv("ROLE_MAESTRO") or "maestro",
        "profesor": os.getenv("ROLE_TEACHER") or os.getenv("ROLE_MAESTRO") or "maestro",
        "maestro": os.getenv("ROLE_MAESTRO") or "maestro",
        "docente": os.getenv("ROLE_MAESTRO") or "maestro",
        "admin": os.getenv("ROLE_ADMIN") or "administrador",
        "administrator": os.getenv("ROLE_ADMIN") or "administrador",
    }
    return map_cfg.get(r, r or "alumno")


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.getenv(name)
    return v if (v is not None and str(v).strip() != "") else default


def _reflect_table(engine: Engine, name: str) -> Optional[Table]:
    try:
        md = MetaData()
        return Table(name, md, autoload_with=engine)
    except Exception:
        return None


def get_user_mapping() -> Dict[str, str]:
    return {
        "table": _env("USERS_TABLE", "usuarios"),
        "pk": _env("USERS_PK", "id_usuario"),
        "email": _env("USERS_EMAIL", "email"),
        "password_hash": _env("USERS_PASSWORD_HASH", "password_hash"),
        "name": _env("USERS_NAME", "nombre"),
        "role": _env("USERS_ROLE", "rol"),
    }


def get_alumno_mapping() -> Dict[str, str]:
    return {
        "table": _env("ALUMNOS_TABLE", "alumnos"),
        "pk": _env("ALUMNOS_PK", "id_alumno"),
        # Columna en alumnos que referencia al usuario. Se ajusta con introspección en reflect_alumnos_table.
        # Prioridad: env ALUMNOS_USER_FK -> columna existente id_usuario -> fallback a pk.
        "user_fk": _env("ALUMNOS_USER_FK"),
        "nivel": _env("ALUMNOS_NIVEL", "nivel"),
        "anio": _env("ALUMNOS_ANIO", "bachillerato_anio"),
        "especialidad": _env("ALUMNOS_ESPECIALIDAD", "especialidad"),
    }


def reflect_user_table(engine: Engine) -> Tuple[Optional[Table], Dict[str, str]]:
    m = get_user_mapping()
    tbl = _reflect_table(engine, m["table"]) if m["table"] else None
    return tbl, m


def reflect_alumnos_table(engine: Engine) -> Tuple[Optional[Table], Dict[str, str]]:
    m = get_alumno_mapping()
    tbl = _reflect_table(engine, m["table"]) if m["table"] else None
    # Ajuste inteligente del user_fk si no viene dado por env
    try:
        if tbl is not None and not m.get("user_fk"):
            if hasattr(tbl.c, "id_usuario"):
                m["user_fk"] = "id_usuario"
            else:
                # Fallback: usar la misma PK si el esquema iguala alumno.id a usuario.id
                m["user_fk"] = m["pk"]
    except Exception:
        # último recurso
        if not m.get("user_fk"):
            m["user_fk"] = m["pk"]
    return tbl, m


def get_user_by_email(db: Session, email: str) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    if u is None:
        return None
    col = getattr(u.c, um["email"], None)
    if col is None:
        return None
    # Normalización/insensibilidad a mayúsculas y (opcional) acentos
    import unicodedata as _ud
    email_norm = _ud.normalize("NFKC", (email or "").strip())
    use_unaccent = (os.getenv("USE_UNACCENT", "false").lower() in {"1", "true", "yes"})
    cond = func.lower(col) == func.lower(email_norm)
    if use_unaccent:
        try:
            cond = func.unaccent(func.lower(col)) == func.unaccent(func.lower(email_norm))
        except Exception:
            # Si falla (extensión no instalada), usar fallback
            pass
    row = db.execute(select(u).where(cond).limit(1)).fetchone()
    if not row:
        return None
    data = row._mapping
    return {
        "id": data.get(um["pk"]),
        "nombre": data.get(um["name"]),
        "email": data.get(um["email"]),
        "rol": data.get(um["role"]),
        "password_hash": data.get(um["password_hash"]),
    }


def get_user_secret_by_id(db: Session, user_id: Any) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    if u is None:
        return None
    row = db.execute(select(u).where(getattr(u.c, um["pk"]) == user_id).limit(1)).fetchone()
    if not row:
        return None
    data = row._mapping
    return {
        "id": data.get(um["pk"]),
        "password_hash": data.get(um["password_hash"]),
        "email": data.get(um["email"]),
        "nombre": data.get(um["name"]),
    }


def email_in_use(db: Session, email: str, exclude_user_id: Any | None = None) -> bool:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    if u is None:
        return False
    from sqlalchemy import func as _f
    cond = _f.lower(getattr(u.c, um["email"])) == _f.lower(email)
    if exclude_user_id is not None:
        cond = cond & (getattr(u.c, um["pk"]) != exclude_user_id)
    row = db.execute(select(u.c[um["pk"]]).where(cond).limit(1)).fetchone()
    return bool(row)


def get_user_by_id(db: Session, user_id: Any) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    if u is None:
        return None
    col = getattr(u.c, um["pk"], None)
    if col is None:
        return None
    row = db.execute(select(u).where(col == user_id).limit(1)).fetchone()
    if not row:
        return None
    data = row._mapping
    return {
        "id": data.get(um["pk"]),
        "nombre": data.get(um["name"]),
        "email": data.get(um["email"]),
        "rol": data.get(um["role"]),
    }


def list_alumnos(db: Session, q: Optional[str], limit: int, offset: int) -> Dict[str, Any]:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    a, am = reflect_alumnos_table(engine)
    if a is None:
        return {"error": "Tabla alumnos no encontrada"}

    # Si no hay usuarios, devolver solo alumnos
    if u is None:
        qry = select(a).limit(limit).offset(offset)
        rows = db.execute(qry).fetchall()
        items = []
        for r in rows:
            m = r._mapping
            items.append({
                "id": m.get(am["pk"]),
                "nivel": m.get(am["nivel"]),
                "bachillerato_anio": m.get(am["anio"]),
                "especialidad": m.get(am["especialidad"]),
            })
        return {"count": len(items), "items": items}

    # Join usuarios x alumnos
    on_cond = getattr(a.c, am["user_fk"]) == getattr(u.c, um["pk"])  # type: ignore
    j = join(a, u, on_cond)
    cols = [
        getattr(a.c, am["pk"]).label("id"),
        getattr(u.c, um["name"]).label("nombre"),
        getattr(u.c, um["email"]).label("email"),
        getattr(u.c, um["role"]).label("rol"),
        getattr(a.c, am["nivel"]).label("nivel"),
        getattr(a.c, am["anio"]).label("bachillerato_anio"),
        getattr(a.c, am["especialidad"]).label("especialidad"),
    ]

    qry = select(*cols).select_from(j)
    if q and q.strip():
        term = f"%{q.strip()}%"
        preds = []
        # Always include user name/email
        preds.append(getattr(u.c, um["name"]).ilike(term))
        preds.append(getattr(u.c, um["email"]).ilike(term))
        # Add text filters only for textual columns
        try:
            if getattr(getattr(a.c, am["nivel"]).type, "python_type", str) is str:
                preds.append(getattr(a.c, am["nivel"]).ilike(term))
        except Exception:
            pass
        try:
            if getattr(getattr(a.c, am["especialidad"]).type, "python_type", str) is str:
                preds.append(getattr(a.c, am["especialidad"]).ilike(term))
        except Exception:
            pass
        qry = qry.where(or_(*preds))

    qry = qry.limit(limit).offset(offset)
    rows = db.execute(qry).fetchall()
    items = [dict(r._mapping) for r in rows]
    return {"count": len(items), "items": items}


def get_alumno_by_id(db: Session, alumno_id: Any) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    a, am = reflect_alumnos_table(engine)
    if a is None:
        return None

    # Si no hay tabla de usuarios reflejada, intentar por PK y luego por FK de usuario
    if u is None:
        # Intento 1: buscar por PK de alumno
        row = db.execute(select(a).where(getattr(a.c, am["pk"]) == alumno_id).limit(1)).fetchone()
        if not row:
            # Intento 2: buscar por FK a usuario (si existe)
            try:
                cond = getattr(a.c, am["user_fk"]) == alumno_id
                row = db.execute(select(a).where(cond).limit(1)).fetchone()
            except Exception:
                row = None
        if not row:
            return None
        m = row._mapping
        return {
            "id": m.get(am["pk"]),
            "nivel": m.get(am["nivel"]),
            "bachillerato_anio": m.get(am["anio"]),
            "especialidad": m.get(am["especialidad"]),
        }

    on_cond = getattr(a.c, am["user_fk"]) == getattr(u.c, um["pk"])  # type: ignore
    j = join(a, u, on_cond)
    cols = [
        getattr(a.c, am["pk"]).label("id"),
        getattr(u.c, um["name"]).label("nombre"),
        getattr(u.c, um["email"]).label("email"),
        getattr(u.c, um["role"]).label("rol"),
        getattr(a.c, am["nivel"]).label("nivel"),
        getattr(a.c, am["anio"]).label("bachillerato_anio"),
        getattr(a.c, am["especialidad"]).label("especialidad"),
    ]
    # Intento 1: por PK del alumno
    qry_pk = select(*cols).select_from(j).where(getattr(a.c, am["pk"]) == alumno_id).limit(1)
    row = db.execute(qry_pk).fetchone()
    if not row:
        # Intento 2: por FK del usuario (permite pasar user_id)
        try:
            cond_fk = getattr(a.c, am["user_fk"]) == alumno_id
            qry_fk = select(*cols).select_from(j).where(cond_fk).limit(1)
            row = db.execute(qry_fk).fetchone()
        except Exception:
            row = None
    if not row:
        return None
    return dict(row._mapping)


def create_user(db: Session, nombre: str, email: str, password: str, rol: str = "alumno") -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    if u is None:
        return None
    # Hash seguro
    pwd_hash = hash_password(password)
    rol_db = _role_map(rol)
    values = {
        um["name"]: nombre,
        um["email"]: email,
        um["role"]: rol_db,
        um["password_hash"]: pwd_hash,
    }
    ins = u.insert().values(**values).returning(getattr(u.c, um["pk"]))
    try:
        new_id = db.execute(ins).scalar()
        db.commit()
    except Exception as e:
        db.rollback()
        raise e
    return {"id": new_id, "nombre": nombre, "email": email, "rol": rol_db}


def create_alumno_for_user(
    db: Session,
    user_id: Any,
    nivel: Optional[str] = None,
    especialidad: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    a, am = reflect_alumnos_table(engine)
    if a is None:
        return None

    # Derivar año si procede
    anio_val = None
    try:
        txt = (nivel or "").lower()
        if "1" in txt:
            anio_val = 1
        elif "2" in txt:
            anio_val = 2
    except Exception:
        anio_val = None

    values = {
        am["nivel"]: nivel,
        am["especialidad"]: especialidad,
    }
    # Si hay columna año, agregar si la inferimos
    try:
        if hasattr(a.c, am["anio"]) and (anio_val is not None):
            values[am["anio"]] = anio_val
    except Exception:
        pass

    # Relación con usuario
    try:
        # Si el FK de alumnos es la misma PK, forzamos el id
        if am["user_fk"] == am["pk"]:
            values[am["pk"]] = user_id
        else:
            values[am["user_fk"]] = user_id
    except Exception:
        values[am["user_fk"]] = user_id

    ins = a.insert().values(**values)
    try:
        db.execute(ins)
        db.commit()
    except Exception as e:
        db.rollback()
        raise e
    return {
        "id": user_id,
        "nivel": nivel,
        "bachillerato_anio": anio_val,
        "especialidad": especialidad,
    }


def update_user(
    db: Session,
    user_id: Any,
    nombre: Optional[str] = None,
    email: Optional[str] = None,
    password: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    u, um = reflect_user_table(engine)
    if u is None:
        return None
    values: Dict[str, Any] = {}
    if nombre is not None:
        values[um["name"]] = nombre
    if email is not None:
        values[um["email"]] = email
    if password is not None and str(password).strip() != "":
        values[um["password_hash"]] = hash_password(password)
    if not values:
        # nothing to do
        return get_user_by_id(db, user_id)
    try:
        stmt = u.update().where(getattr(u.c, um["pk"]) == user_id).values(**values)
        db.execute(stmt)
        db.commit()
        return get_user_by_id(db, user_id)
    except Exception as e:
        db.rollback()
        raise e


def upsert_alumno_for_user(
    db: Session,
    user_id: Any,
    nivel: Optional[str] = None,
    especialidad: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    a, am = reflect_alumnos_table(engine)
    if a is None:
        return None

    # Inferir año
    anio_val = None
    try:
        txt = (nivel or "").lower()
        if "1" in txt:
            anio_val = 1
        elif "2" in txt:
            anio_val = 2
    except Exception:
        anio_val = None

    # Construir valores a escribir
    values: Dict[str, Any] = {}
    if nivel is not None:
        values[am["nivel"]] = nivel
    if especialidad is not None:
        values[am["especialidad"]] = especialidad
    try:
        if anio_val is not None and hasattr(a.c, am["anio"]):
            values[am["anio"]] = anio_val
    except Exception:
        pass

    # Determinar condición de búsqueda existente
    cond_col_name = am["pk"] if am["user_fk"] == am["pk"] else am["user_fk"]
    cond_col = getattr(a.c, cond_col_name)
    row = db.execute(select(a).where(cond_col == user_id).limit(1)).fetchone()

    try:
        if row:
            if values:
                stmt = a.update().where(cond_col == user_id).values(**values)
                db.execute(stmt)
        else:
            # insertar nuevo
            ins_vals = dict(values)
            if am["user_fk"] == am["pk"]:
                ins_vals[am["pk"]] = user_id
            else:
                ins_vals[am["user_fk"]] = user_id
            db.execute(a.insert().values(**ins_vals))
        db.commit()
    except Exception as e:
        db.rollback()
        raise e

    return {
        "id": user_id,
        "nivel": nivel,
        "bachillerato_anio": anio_val,
        "especialidad": especialidad,
    }
