from typing import Any, Dict, List, Optional, Tuple

from html import escape

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session, selectinload

from db import get_db
from models.models import Unidad, Tema, Leccion


router = APIRouter()


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _lesson_order_key(numero: Any) -> Tuple[int, ...]:
    if numero is None:
        return (0,)
    if not isinstance(numero, str):
        numero = str(numero)
    numero = numero.replace("-", ".")
    parts: List[int] = []
    for part in numero.split("."):
        part = part.strip()
        if not part:
            continue
        try:
            parts.append(int(part))
        except ValueError:
            continue
    return tuple(parts) if parts else (0,)


def _build_preview(text_value: Optional[str], limit: int = 180) -> Optional[str]:
    if not text_value:
        return None
    snippet = " ".join(text_value.split())
    if len(snippet) <= limit:
        return snippet
    return snippet[:limit].rstrip() + "..."


def _compose_sections_html(sections: List[Dict[str, Optional[str]]]) -> str:
    parts: List[str] = []
    for section in sections:
        section_type = (section.get("tipo_seccion") or "").strip().lower()
        content = (section.get("contenido") or "").strip()
        formula = (section.get("formula") or "").strip()
        image = (section.get("imagen_url") or "").strip()

        if content:
            content = content.replace("\r\n", "\n").replace("\r", "\n")
            tag = "p"
            if section_type in {"titulo", "title"}:
                tag = "h4"
            parts.append(f"<{tag}>{escape(content).replace('\n', '<br>')}</{tag}>")

        if formula:
            parts.append(f"<pre class=\"lesson-formula\">{escape(formula)}</pre>")

        if image:
            parts.append(
                '<figure class="lesson-image">'
                f'<img src="{escape(image)}" alt="Ilustracion" loading="lazy">'
                '</figure>'
            )

    return "".join(parts)


def _payload_from_models(unidades: List[Unidad]) -> Tuple[List[Dict[str, Any]], int]:
    payload: List[Dict[str, Any]] = []
    total_lessons = 0

    unidades_sorted = sorted(
        unidades,
        key=lambda u: (
            _coerce_int(getattr(u, "numero", None)),
            (u.titulo or ""),
            _coerce_int(getattr(u, "id_unidad", None)),
        ),
    )

    for unidad in unidades_sorted:
        temas_sorted = sorted(
            list(getattr(unidad, "temas", []) or []),
            key=lambda t: (
                _coerce_int(getattr(t, "numero", None)),
                (t.titulo or ""),
                _coerce_int(getattr(t, "id_tema", None)),
            ),
        )

        temas_payload: List[Dict[str, Any]] = []
        unidad_lessons = 0

        for tema in temas_sorted:
            lecciones_sorted = sorted(
                list(getattr(tema, "lecciones", []) or []),
                key=lambda l: (
                    _lesson_order_key(getattr(l, "numero", None)),
                    (l.nombre or ""),
                    _coerce_int(getattr(l, "id_leccion", None)),
                ),
            )

            lecciones_payload: List[Dict[str, Any]] = []
            for leccion in lecciones_sorted:
                lecciones_payload.append({
                    "id": leccion.id_leccion,
                    "numero": leccion.numero,
                    "nombre": leccion.nombre,
                    "tema_id": leccion.id_tema,
                    "unidad_numero": unidad.numero,
                    "tema_numero": tema.numero,
                    "preview": _build_preview(leccion.teoria),
                })

            unidad_lessons += len(lecciones_payload)
            temas_payload.append({
                "id": tema.id_tema,
                "numero": tema.numero,
                "titulo": tema.titulo,
                "lecciones": lecciones_payload,
                "lecciones_count": len(lecciones_payload),
            })

        total_lessons += unidad_lessons
        payload.append({
            "id": unidad.id_unidad,
            "numero": unidad.numero,
            "titulo": unidad.titulo,
            "area": str(unidad.area) if getattr(unidad, "area", None) is not None else None,
            "temas": temas_payload,
            "temas_count": len(temas_payload),
            "lecciones_count": unidad_lessons,
        })

    return payload, total_lessons


def _payload_from_subtemas(db: Session, inspector, area: Optional[str]) -> Tuple[List[Dict[str, Any]], int]:
    columns_unidad = {col["name"] for col in inspector.get_columns("unidades")}
    has_area = "area" in columns_unidad

    if area and not has_area:
        return [], 0

    unit_sql = (
        "SELECT id_unidad, numero, titulo"
        + (", area" if has_area else "")
        + " FROM unidades"
    )
    unit_rows = db.execute(text(unit_sql)).mappings().all()

    units_sorted = sorted(
        unit_rows,
        key=lambda u: (
            _coerce_int(u.get("numero")),
            (u.get("titulo") or ""),
            _coerce_int(u.get("id_unidad")),
        ),
    )

    payload: List[Dict[str, Any]] = []
    total_lessons = 0
    area_lower = area.lower() if area else None

    for unidad in units_sorted:
        unidad_area = unidad.get("area") if has_area else None
        if area_lower and str(unidad_area).lower() != area_lower:
            continue

        topic_rows = db.execute(
            text(
                "SELECT id_tema, numero, titulo FROM temas WHERE id_unidad = :unit_id"
            ),
            {"unit_id": unidad["id_unidad"]},
        ).mappings().all()

        topics_sorted = sorted(
            topic_rows,
            key=lambda t: (
                _coerce_int(t.get("numero")),
                (t.get("titulo") or ""),
                _coerce_int(t.get("id_tema")),
            ),
        )

        temas_payload: List[Dict[str, Any]] = []
        unidad_lessons = 0

        for tema in topics_sorted:
            lesson_rows = db.execute(
                text(
                    "SELECT id_subtema, numero, titulo FROM subtemas WHERE id_tema = :topic_id"
                ),
                {"topic_id": tema["id_tema"]},
            ).mappings().all()

            lessons_sorted = sorted(
                lesson_rows,
                key=lambda l: (
                    _lesson_order_key(l.get("numero")),
                    (l.get("titulo") or ""),
                    _coerce_int(l.get("id_subtema")),
                ),
            )

            lecciones_payload: List[Dict[str, Any]] = []

            for lesson in lessons_sorted:
                preview_text = db.execute(
                    text(
                        "SELECT contenido FROM secciones "
                        "WHERE id_subtema = :lesson_id "
                        "AND contenido IS NOT NULL "
                        "AND TRIM(contenido) != '' "
                        "ORDER BY id_seccion ASC LIMIT 1"
                    ),
                    {"lesson_id": lesson["id_subtema"]},
                ).scalar()

                lecciones_payload.append({
                    "id": lesson["id_subtema"],
                    "numero": lesson.get("numero"),
                    "nombre": lesson.get("titulo"),
                    "tema_id": tema["id_tema"],
                    "unidad_numero": unidad.get("numero"),
                    "tema_numero": tema.get("numero"),
                    "preview": _build_preview(preview_text),
                })

            unidad_lessons += len(lecciones_payload)
            temas_payload.append({
                "id": tema["id_tema"],
                "numero": tema.get("numero"),
                "titulo": tema.get("titulo"),
                "lecciones": lecciones_payload,
                "lecciones_count": len(lecciones_payload),
            })

        total_lessons += unidad_lessons
        payload.append({
            "id": unidad["id_unidad"],
            "numero": unidad.get("numero"),
            "titulo": unidad.get("titulo"),
            "area": str(unidad_area) if unidad_area is not None else None,
            "temas": temas_payload,
            "temas_count": len(temas_payload),
            "lecciones_count": unidad_lessons,
        })

    return payload, total_lessons


def _detail_from_subtemas(db: Session, inspector, lesson_id: int) -> Optional[Dict[str, Any]]:
    columns_unidad = {col["name"] for col in inspector.get_columns("unidades")}
    has_area = "area" in columns_unidad

    area_clause = ", u.area AS unidad_area" if has_area else ""
    detail_sql = (
        "SELECT "
        "s.id_subtema AS lesson_id, "
        "s.numero AS lesson_numero, "
        "s.titulo AS lesson_nombre, "
        "t.id_tema AS tema_id, "
        "t.numero AS tema_numero, "
        "t.titulo AS tema_titulo, "
        "u.id_unidad AS unidad_id, "
        "u.numero AS unidad_numero, "
        "u.titulo AS unidad_titulo"
        f"{area_clause} "
        "FROM subtemas s "
        "JOIN temas t ON t.id_tema = s.id_tema "
        "JOIN unidades u ON u.id_unidad = t.id_unidad "
        "WHERE s.id_subtema = :lesson_id"
    )

    row = db.execute(text(detail_sql), {"lesson_id": lesson_id}).mappings().first()
    if not row:
        return None

    sections = db.execute(
        text(
            "SELECT tipo_seccion, contenido, formula, imagen_url "
            "FROM secciones WHERE id_subtema = :lesson_id "
            "ORDER BY id_seccion ASC"
        ),
        {"lesson_id": lesson_id},
    ).mappings().all()

    teoria_html = _compose_sections_html(sections)
    unidad_area = row.get("unidad_area") if has_area else None

    return {
        "id": row["lesson_id"],
        "numero": row.get("lesson_numero"),
        "nombre": row.get("lesson_nombre"),
        "teoria": teoria_html or None,
        "tema": {
            "id": row["tema_id"],
            "numero": row.get("tema_numero"),
            "titulo": row.get("tema_titulo"),
        },
        "unidad": {
            "id": row["unidad_id"],
            "numero": row.get("unidad_numero"),
            "titulo": row.get("unidad_titulo"),
            "area": str(unidad_area) if unidad_area is not None else None,
        },
    }


@router.get("/")
def list_lessons(
    area: Optional[str] = Query(default=None, description="Filter by area identifier"),
    db: Session = Depends(get_db),
):
    try:
        bind = db.get_bind()
        inspector = inspect(bind)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"lessons_list error: {exc}") from exc

    if inspector.has_table("lecciones"):
        try:
            query = (
                db.query(Unidad)
                .options(selectinload(Unidad.temas).selectinload(Tema.lecciones))
            )
            if area:
                query = query.filter(Unidad.area == area)
            unidades = query.order_by(Unidad.numero.asc(), Unidad.id_unidad.asc()).all()
            payload, total_lessons = _payload_from_models(unidades)
            return {
                "unidades": payload,
                "total_unidades": len(payload),
                "total_lecciones": total_lessons,
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"lessons_list error: {exc}") from exc

    if inspector.has_table("subtemas"):
        try:
            payload, total_lessons = _payload_from_subtemas(db, inspector, area)
            return {
                "unidades": payload,
                "total_unidades": len(payload),
                "total_lecciones": total_lessons,
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"lessons_list error: {exc}") from exc

    raise HTTPException(status_code=500, detail="lessons_list error: esquema de lecciones no soportado")


@router.get('/{lesson_id}')
def get_lesson_detail(lesson_id: int, db: Session = Depends(get_db)):
    try:
        bind = db.get_bind()
        inspector = inspect(bind)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'lesson_detail error: {exc}') from exc

    if inspector.has_table("lecciones"):
        try:
            query = (
                db.query(Leccion, Tema, Unidad)
                .join(Tema, Leccion.id_tema == Tema.id_tema)
                .join(Unidad, Tema.id_unidad == Unidad.id_unidad)
                .filter(Leccion.id_leccion == lesson_id)
            )
            result = query.first()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f'lesson_detail error: {exc}') from exc

        if not result:
            raise HTTPException(status_code=404, detail='Leccion no encontrada')

        lesson, topic, unit = result
        return {
            'id': lesson.id_leccion,
            'numero': lesson.numero,
            'nombre': lesson.nombre,
            'teoria': lesson.teoria,
            'tema': {
                'id': topic.id_tema,
                'numero': topic.numero,
                'titulo': topic.titulo,
            },
            'unidad': {
                'id': unit.id_unidad,
                'numero': unit.numero,
                'titulo': unit.titulo,
                'area': str(getattr(unit, 'area', None)) if getattr(unit, 'area', None) is not None else None,
            },
        }

    if inspector.has_table("subtemas"):
        try:
            detail = _detail_from_subtemas(db, inspector, lesson_id)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f'lesson_detail error: {exc}') from exc

        if not detail:
            raise HTTPException(status_code=404, detail='Leccion no encontrada')
        return detail

    raise HTTPException(status_code=500, detail='lesson_detail error: esquema de lecciones no soportado')
