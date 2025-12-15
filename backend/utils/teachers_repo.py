import os
import json
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    MetaData,
    Table,
    Text,
    and_,
    delete as sa_delete,
    func,
    inspect,
    or_,
    select,
    update as sa_update,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from utils.accounts_repo import (
    reflect_alumnos_table,
    reflect_user_table,
)


_DEF_TEACHER_TABLE = "docentes"
_DEF_TEACHER_PK = "id_docente"
_DEF_TEACHER_YEARS = "anios"
_DEF_TEACHER_SPECIALTIES = "especialidades"
_DEF_TEACHER_NOTES = "notas"
_DEF_TEACHER_CREATED = "created_at"
_DEF_TEACHER_UPDATED = "updated_at"

_DEF_LINK_TABLE = "docente_alumnos"
_DEF_LINK_TEACHER_FK = "id_docente"
_DEF_LINK_STUDENT_FK = "id_alumno"
_DEF_LINK_MANUAL = "asignacion_manual"
_DEF_LINK_CREATED = "created_at"


def _env(name: str, default: Optional[str]) -> Optional[str]:
    value = os.getenv(name)
    if value is None:
        return default
    txt = str(value).strip()
    return txt if txt else default


def get_teacher_mapping() -> Dict[str, str]:
    return {
        "table": _env("TEACHERS_TABLE", _DEF_TEACHER_TABLE) or _DEF_TEACHER_TABLE,
        "pk": _env("TEACHERS_PK", _DEF_TEACHER_PK) or _DEF_TEACHER_PK,
        "years": _env("TEACHERS_YEARS_COLUMN", _DEF_TEACHER_YEARS) or _DEF_TEACHER_YEARS,
        "specialties": _env("TEACHERS_SPECIALTIES_COLUMN", _DEF_TEACHER_SPECIALTIES) or _DEF_TEACHER_SPECIALTIES,
        "notes": _env("TEACHERS_NOTES_COLUMN", _DEF_TEACHER_NOTES) or _DEF_TEACHER_NOTES,
        "created_at": _env("TEACHERS_CREATED_AT_COLUMN", _DEF_TEACHER_CREATED) or _DEF_TEACHER_CREATED,
        "updated_at": _env("TEACHERS_UPDATED_AT_COLUMN", _DEF_TEACHER_UPDATED) or _DEF_TEACHER_UPDATED,
    }

def get_teacher_students_mapping() -> Dict[str, str]:
    return {
        "table": _env("TEACHER_STUDENTS_TABLE", _DEF_LINK_TABLE) or _DEF_LINK_TABLE,
        "teacher_fk": _env("TEACHER_STUDENTS_TEACHER_FK", _DEF_LINK_TEACHER_FK) or _DEF_LINK_TEACHER_FK,
        "student_fk": _env("TEACHER_STUDENTS_STUDENT_FK", _DEF_LINK_STUDENT_FK) or _DEF_LINK_STUDENT_FK,
        "manual": _env("TEACHER_STUDENTS_MANUAL_COLUMN", _DEF_LINK_MANUAL) or _DEF_LINK_MANUAL,
        "created_at": _env("TEACHER_STUDENTS_CREATED_COLUMN", _DEF_LINK_CREATED) or _DEF_LINK_CREATED,
    }


def _ensure_teacher_tables(engine: Engine) -> None:
    insp = inspect(engine)
    tm = get_teacher_mapping()
    lm = get_teacher_students_mapping()
    metadata = MetaData()

    created = False

    if not insp.has_table(tm["table"]):
        Table(
            tm["table"],
            metadata,
            Column(tm["pk"], Integer, primary_key=True),
            Column(tm["years"], Text, nullable=False, server_default="[]"),
            Column(tm["specialties"], Text, nullable=False, server_default="[]"),
            Column(tm["notes"], Text, nullable=True),
            Column(tm["created_at"], DateTime(timezone=False), server_default=func.now(), nullable=False),
            Column(tm["updated_at"], DateTime(timezone=False), server_default=func.now(), nullable=False),
        )
        created = True

    if not insp.has_table(lm["table"]):
        Table(
            lm["table"],
            metadata,
            Column(lm["teacher_fk"], Integer, primary_key=True),
            Column(lm["student_fk"], Integer, primary_key=True),
            Column(lm["manual"], Boolean, nullable=False, server_default="0"),
            Column(lm["created_at"], DateTime(timezone=False), server_default=func.now(), nullable=False),
        )
        created = True

    if created:
        metadata.create_all(engine)


def reflect_teacher_table(engine: Engine) -> Tuple[Optional[Table], Dict[str, str]]:
    _ensure_teacher_tables(engine)
    tm = get_teacher_mapping()
    metadata = MetaData()
    try:
        table = Table(tm["table"], metadata, autoload_with=engine)
        return table, tm
    except Exception:
        return None, tm


def reflect_teacher_students_table(engine: Engine) -> Tuple[Optional[Table], Dict[str, str]]:
    _ensure_teacher_tables(engine)
    lm = get_teacher_students_mapping()
    metadata = MetaData()
    try:
        table = Table(lm["table"], metadata, autoload_with=engine)
        return table, lm
    except Exception:
        return None, lm


def _normalize_years(values: Optional[Sequence[Any]]) -> List[int]:
    if not values:
        return []
    seen: Dict[int, bool] = {}
    out: List[int] = []
    for raw in values:
        if raw is None:
            continue
        try:
            val = int(str(raw).strip())
        except Exception:
            continue
        if val not in seen:
            seen[val] = True
            out.append(val)
    out.sort()
    return out


def _normalize_specialties(values: Optional[Sequence[Any]]) -> List[str]:
    if not values:
        return []
    seen: Dict[str, bool] = {}
    out: List[str] = []
    for raw in values:
        if raw is None:
            continue
        txt = str(raw).strip()
        if not txt:
            continue
        key = txt.lower()
        if key not in seen:
            seen[key] = True
            out.append(txt)
    return out


def _dump_list(values: Sequence[Any]) -> str:
    try:
        return json.dumps(list(values), ensure_ascii=False)
    except Exception:
        return "[]"


def _load_years(raw: Any) -> List[int]:
    if raw is None:
        return []
    txt = str(raw).strip()
    if not txt:
        return []
    try:
        data = json.loads(txt)
        if isinstance(data, list):
            return _normalize_years(data)
    except Exception:
        pass
    parts = [p.strip() for p in txt.split(',') if p.strip()]
    return _normalize_years(parts)


def _load_specialties(raw: Any) -> List[str]:
    if raw is None:
        return []
    txt = str(raw).strip()
    if not txt:
        return []
    try:
        data = json.loads(txt)
        if isinstance(data, list):
            return _normalize_specialties(data)
    except Exception:
        pass
    parts = [p.strip() for p in txt.split(',') if p.strip()]
    return _normalize_specialties(parts)


_YEAR_LABELS = {
    1: "1er año",
    2: "2do año",
    3: "3er año",
    4: "4to año",
    5: "5to año",
    6: "6to año",
}

_YEAR_TEXT_PATTERN = re.compile(r"(?:^|\b)([0-9]{1,2})\s*(?:er|ro|do|to|mo|°|\u00ba)?\s*(?:a\u00f1o|ano)", re.IGNORECASE)


def _label_for_year(value: int) -> str:
    return _YEAR_LABELS.get(value, f"{value}\u00ba a\u00f1o")


def _coerce_year(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if value < 0:
            return None
        return int(round(value))
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            parsed = float(stripped.replace('%', ''))
        except ValueError:
            return None
        return int(round(parsed))
    return None


def _extract_year_from_level(value: Any) -> Optional[int]:
    if value is None:
        return None
    txt = str(value).strip()
    if not txt:
        return None
    match = _YEAR_TEXT_PATTERN.search(txt)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    for token in re.findall(r"\d+", txt):
        try:
            number = int(token)
        except ValueError:
            continue
        if number >= 0:
            return number
    return None


def _normalize_existing_progress(raw: Any) -> Optional[Dict[str, Any]]:
    if raw is None:
        return None
    if isinstance(raw, dict):
        payload = dict(raw)
        percent = payload.get("percent")
        if percent is None:
            percent = payload.get("porcentaje")
        if percent is not None:
            try:
                percent_value = float(percent)
            except (TypeError, ValueError):
                percent_value = None
            if percent_value is not None and 0 <= percent_value <= 1:
                percent_value *= 100
            if percent_value is not None:
                payload["percent"] = round(percent_value, 2)
        payload.setdefault("source", "explicit")
        return payload
    try:
        percent_value = float(raw)
    except (TypeError, ValueError):
        return None
    if 0 <= percent_value <= 1:
        percent_value *= 100
    return {
        "percent": round(percent_value, 2),
        "source": "explicit",
    }


def _infer_progress_payload(items: List[Dict[str, Any]]) -> None:
    if not items:
        return
    inferred_years: List[int] = []
    for entry in items:
        existing = _normalize_existing_progress(entry.get("progreso"))
        if existing is not None:
            entry["progreso"] = existing
            continue
        explicit = _normalize_existing_progress(entry.get("progress"))
        if explicit is not None:
            entry["progreso"] = explicit
            continue
        year_value = _coerce_year(entry.get("anio"))
        if year_value is None:
            year_value = _extract_year_from_level(entry.get("nivel"))
        if year_value is not None:
            year_int = int(year_value)
            entry["_inferred_year"] = year_int
            inferred_years.append(year_int)
        else:
            entry["_inferred_year"] = None
    if inferred_years:
        max_year = max(inferred_years)
        if max_year < 1:
            max_year = 3
    else:
        max_year = None
    for entry in items:
        if entry.get("progreso") is not None:
            entry.pop("_inferred_year", None)
            continue
        year_value = entry.pop("_inferred_year", None)
        if year_value is None or max_year is None or max_year <= 0:
            entry["progreso"] = None
            continue
        capped = max(0, min(int(year_value), max_year))
        ratio = capped / max_year if max_year else 0
        percent = round(min(100.0, max(0.0, ratio * 100)), 2)
        entry["progreso"] = {
            "percent": percent,
            "label": _label_for_year(capped),
            "stage": f"{capped}/{max_year}",
            "year": capped,
            "max_year": max_year,
            "source": "anio" if entry.get("anio") is not None else ("nivel" if entry.get("nivel") else "inferred"),
        }


def get_teacher_profile(db: Session, teacher_id: Any) -> Optional[Dict[str, Any]]:
    engine = db.get_bind()
    t, tm = reflect_teacher_table(engine)
    if t is None:
        return None
    pk_col = getattr(t.c, tm["pk"], None)
    if pk_col is None:
        return None
    row = db.execute(select(t).where(pk_col == teacher_id).limit(1)).fetchone()
    if not row:
        return None
    data = row._mapping
    return {
        "id": data.get(tm["pk"]),
        "anios": _load_years(data.get(tm["years"])),
        "especialidades": _load_specialties(data.get(tm["specialties"])),
        "notas": data.get(tm["notes"]),
        "created_at": data.get(tm["created_at"]),
        "updated_at": data.get(tm["updated_at"]),
    }


def ensure_teacher_profile(db: Session, teacher_id: Any) -> Dict[str, Any]:
    profile = get_teacher_profile(db, teacher_id)
    if profile:
        return profile
    return upsert_teacher_profile(db, teacher_id, anios=[], especialidades=[], notas=None)


def upsert_teacher_profile(
    db: Session,
    teacher_id: Any,
    anios: Optional[Sequence[Any]],
    especialidades: Optional[Sequence[Any]],
    notas: Optional[str] = None,
) -> Dict[str, Any]:
    engine = db.get_bind()
    t, tm = reflect_teacher_table(engine)
    if t is None:
        raise RuntimeError("Tabla de docentes no disponible")

    years = _normalize_years(anios)
    specs = _normalize_specialties(especialidades)

    values = {
        tm["years"]: _dump_list(years),
        tm["specialties"]: _dump_list(specs),
        tm["updated_at"]: func.now(),
    }
    if tm["notes"] and notas is not None:
        values[tm["notes"]] = notas

    pk_col = getattr(t.c, tm["pk"])
    row = db.execute(select(t).where(pk_col == teacher_id).limit(1)).fetchone()

    try:
        if row:
            stmt = sa_update(t).where(pk_col == teacher_id).values(**values)
            db.execute(stmt)
        else:
            insert_vals = dict(values)
            insert_vals[tm["pk"]] = teacher_id
            db.execute(t.insert().values(**insert_vals))
        db.commit()
    except Exception as exc:
        db.rollback()
        raise exc

    profile = get_teacher_profile(db, teacher_id)
    if not profile:
        raise RuntimeError("No se pudo recuperar el perfil del docente")
    return profile


def _existing_assignments(db: Session, ts: Table, tsm: Dict[str, str], teacher_id: Any) -> Dict[Any, bool]:
    fk_teacher = getattr(ts.c, tsm["teacher_fk"])
    manual_col = getattr(ts.c, tsm["manual"], None)
    rows = db.execute(select(ts).where(fk_teacher == teacher_id)).fetchall()
    existing: Dict[Any, bool] = {}
    for row in rows:
        mapping = row._mapping
        sid = mapping.get(tsm["student_fk"])
        manual = bool(mapping.get(tsm["manual"], False)) if manual_col is not None else False
        if sid is not None:
            existing[sid] = manual
    return existing


def sync_teacher_assignments(db: Session, teacher_id: Any) -> None:
    profile = ensure_teacher_profile(db, teacher_id)
    engine = db.get_bind()
    ts, tsm = reflect_teacher_students_table(engine)
    if ts is None:
        return
    alumnos, am = reflect_alumnos_table(engine)
    if alumnos is None:
        return

    years = set(profile["anios"] or [])
    specs = {s.lower(): s for s in (profile["especialidades"] or [])}

    existing = _existing_assignments(db, ts, tsm, teacher_id)
    fk_teacher = getattr(ts.c, tsm["teacher_fk"])
    fk_student = getattr(ts.c, tsm["student_fk"])
    manual_col = getattr(ts.c, tsm["manual"], None)

    target_student_ids: List[Any] = []
    if years or specs:
        filters = []
        year_col = getattr(alumnos.c, am["anio"], None)
        if years and year_col is not None:
            filters.append(year_col.in_(years))
        spec_col = getattr(alumnos.c, am["especialidad"], None)
        if specs and spec_col is not None:
            filters.append(func.lower(spec_col).in_(list(specs.keys())))
        if filters:
            stmt = select(getattr(alumnos.c, am["pk"])).where(and_(*filters))
            rows = db.execute(stmt).fetchall()
            target_student_ids = [row[0] for row in rows if row[0] is not None]
        else:
            target_student_ids = []

    to_insert = [sid for sid in target_student_ids if sid not in existing]
    to_delete = [sid for sid, is_manual in existing.items() if not is_manual and sid not in target_student_ids]

    try:
        for sid in to_insert:
            values = {
                tsm["teacher_fk"]: teacher_id,
                tsm["student_fk"]: sid,
            }
            if manual_col is not None:
                values[tsm["manual"]] = False
            db.execute(ts.insert().values(**values))
        if to_delete:
            delete_stmt = sa_delete(ts).where(and_(fk_teacher == teacher_id, fk_student.in_(to_delete)))
            if manual_col is not None:
                delete_stmt = delete_stmt.where(getattr(ts.c, tsm["manual"]) == False)  # noqa: E712
            db.execute(delete_stmt)
        if to_insert or to_delete:
            db.commit()
    except Exception:
        db.rollback()
        raise


def list_teacher_students(
    db: Session,
    teacher_id: Any,
    q: Optional[str] = None,
    anio: Optional[int] = None,
    especialidad: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> Dict[str, Any]:
    sync_teacher_assignments(db, teacher_id)

    engine = db.get_bind()
    ts, tsm = reflect_teacher_students_table(engine)
    alumnos, am = reflect_alumnos_table(engine)
    usuarios, um = reflect_user_table(engine)
    if ts is None:
        return {"count": 0, "items": [], "stats": {"total": 0, "por_anio": {}, "por_especialidad": {}}}

    fk_teacher = getattr(ts.c, tsm["teacher_fk"])
    fk_student = getattr(ts.c, tsm["student_fk"])
    manual_col = getattr(ts.c, tsm["manual"], None)
    created_col = getattr(ts.c, tsm["created_at"], None)

    from_clause = ts
    if alumnos is not None:
        pk_alumno = getattr(alumnos.c, am["pk"], None)
        if pk_alumno is not None:
            from_clause = from_clause.join(alumnos, fk_student == pk_alumno)
    if usuarios is not None and alumnos is not None:
        alumno_fk = getattr(alumnos.c, am["user_fk"], None)
        user_pk = getattr(usuarios.c, um["pk"], None)
        if alumno_fk is not None and user_pk is not None:
            from_clause = from_clause.join(usuarios, alumno_fk == user_pk)

    nivel_col = None
    anio_col = None
    esp_col = None

    columns = [fk_student.label("alumno_id")]
    if manual_col is not None:
        columns.append(manual_col.label("manual"))
    else:
        columns.append(func.false().label("manual"))
    if created_col is not None:
        columns.append(created_col.label("asignado_en"))
    else:
        columns.append(func.now().label("asignado_en"))

    if alumnos is not None:
        nivel_col = getattr(alumnos.c, am["nivel"], None)
        anio_col = getattr(alumnos.c, am["anio"], None)
        esp_col = getattr(alumnos.c, am["especialidad"], None)
        if nivel_col is not None:
            columns.append(nivel_col.label("nivel"))
        if anio_col is not None:
            columns.append(anio_col.label("anio"))
        if esp_col is not None:
            columns.append(esp_col.label("especialidad"))

    nombre_col = None
    email_col = None
    if usuarios is not None:
        nombre_col = getattr(usuarios.c, um["name"], None)
        email_col = getattr(usuarios.c, um["email"], None)
        if nombre_col is not None:
            columns.append(nombre_col.label("nombre"))
        if email_col is not None:
            columns.append(email_col.label("email"))

    where_clauses = [fk_teacher == teacher_id]

    if q:
        q_norm = f"%{q.strip().lower()}%"
        search_terms = []
        if nombre_col is not None:
            search_terms.append(func.lower(nombre_col).like(q_norm))
        if email_col is not None:
            search_terms.append(func.lower(email_col).like(q_norm))
        if nivel_col is not None:
            search_terms.append(func.lower(nivel_col).like(q_norm))
        if search_terms:
            where_clauses.append(or_(*search_terms))

    if anio is not None and anio_col is not None:
        where_clauses.append(anio_col == anio)

    if especialidad and esp_col is not None:
        where_clauses.append(func.lower(esp_col) == especialidad.strip().lower())

    count_stmt = select(func.count()).select_from(from_clause)
    base_stmt = select(*columns).select_from(from_clause)
    for clause in where_clauses:
        count_stmt = count_stmt.where(clause)
        base_stmt = base_stmt.where(clause)

    orderings = []
    if manual_col is not None:
        orderings.append(manual_col.desc())
    orderings.append(fk_student.asc())
    data_stmt = base_stmt.order_by(*orderings).limit(limit).offset(offset)

    total = db.execute(count_stmt).scalar() or 0

    stats_years: Dict[str, int] = {}
    stats_specs: Dict[str, int] = {}
    if total:
        if anio_col is not None:
            year_stmt = select(anio_col, func.count()).select_from(from_clause)
            for clause in where_clauses:
                year_stmt = year_stmt.where(clause)
            year_stmt = year_stmt.group_by(anio_col)
            for row in db.execute(year_stmt).fetchall():
                if row[0] is not None:
                    stats_years[str(row[0])] = int(row[1])
        if esp_col is not None:
            spec_stmt = select(esp_col, func.count()).select_from(from_clause)
            for clause in where_clauses:
                spec_stmt = spec_stmt.where(clause)
            spec_stmt = spec_stmt.group_by(esp_col)
            for row in db.execute(spec_stmt).fetchall():
                if row[0]:
                    stats_specs[str(row[0])] = int(row[1])

    rows = db.execute(data_stmt).fetchall()

    items: List[Dict[str, Any]] = []
    for row in rows:
        m = row._mapping
        items.append({
            "alumno_id": m.get("alumno_id"),
            "manual": bool(m.get("manual", False)),
            "asignado_en": m.get("asignado_en"),
            "nombre": m.get("nombre"),
            "email": m.get("email"),
            "nivel": m.get("nivel"),
            "anio": m.get("anio"),
            "especialidad": m.get("especialidad"),
        })

    _infer_progress_payload(items)

    return {
        "count": total,
        "items": items,
        "stats": {
            "total": total,
            "por_anio": stats_years,
            "por_especialidad": stats_specs,
        },
    }








