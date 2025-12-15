import os
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from db import SessionLocal, engine
from models.models_simple import Base, Unidad, Tema, Leccion
from utils.pdf_ingest import extract_text_preferably, split_lessons_from_text


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)


def _parse_pair(s: str) -> Tuple[Optional[int], Optional[int]]:
    try:
        s = s.strip().replace('-', '.')
        if '.' in s:
            a, b = s.split('.', 1)
            return (int(a), int(b))
        return (None, int(s))
    except Exception:
        return (None, None)


def get_or_create_unidad(db: Session, numero: int, titulo: Optional[str]) -> Unidad:
    obj = db.query(Unidad).filter(Unidad.numero == numero).first()
    if obj:
        if titulo and not (obj.titulo or '').strip():
            obj.titulo = titulo
        return obj
    obj = Unidad(numero=numero, titulo=titulo or f"Unidad {numero}")
    db.add(obj)
    db.flush()
    return obj


def get_or_create_tema(db: Session, id_unidad: int, numero: int, titulo: Optional[str]) -> Tema:
    obj = (
        db.query(Tema)
        .filter(Tema.id_unidad == id_unidad, Tema.numero == numero)
        .first()
    )
    if obj:
        if titulo and not (obj.titulo or '').strip():
            obj.titulo = titulo
        return obj
    obj = Tema(id_unidad=id_unidad, numero=numero, titulo=titulo or f"Tema {numero}")
    db.add(obj)
    db.flush()
    return obj


def upsert_leccion(db: Session, id_tema: int, numero: int, titulo: str, teoria: str) -> Leccion:
    obj = (
        db.query(Leccion)
        .filter(Leccion.id_tema == id_tema, Leccion.numero == numero)
        .first()
    )
    if obj:
        changed = False
        if titulo and (obj.titulo or '').strip() != titulo:
            obj.titulo = titulo
            changed = True
        if teoria and (obj.teoria or '').strip() != teoria.strip():
            obj.teoria = teoria
            changed = True
        if changed:
            db.add(obj)
        return obj
    obj = Leccion(id_tema=id_tema, numero=numero, titulo=titulo, teoria=teoria)
    db.add(obj)
    db.flush()
    return obj


def seed_from_pdf(pdf_path: str) -> int:
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(pdf_path)
    ensure_schema()
    with open(pdf_path, 'rb') as f:
        data = f.read()
    text = extract_text_preferably(data)
    items = split_lessons_from_text(text)
    if not items:
        return 0

    inserted = 0
    with SessionLocal() as db:
        for it in items:
            unidad_num = it.get('unidad')
            lec_str = (it.get('leccion') or '').strip()
            titulo = (it.get('titulo') or '').strip() or 'Sin titulo'
            contenido = (it.get('contenido') or '').strip()
            if not unidad_num or not lec_str:
                continue
            tema_num, leccion_num = _parse_pair(lec_str)
            if leccion_num is None:
                continue
            u = get_or_create_unidad(db, int(unidad_num), None)
            t = get_or_create_tema(db, u.id_unidad, int(tema_num or 1), None)
            upsert_leccion(db, t.id_tema, int(leccion_num), titulo, contenido)
            inserted += 1
        db.commit()
    return inserted


def main():
    default_pdf = os.path.join(os.path.dirname(__file__), '..', 'uploads', 'Lecciones.pdf')
    default_pdf = os.path.abspath(default_pdf)
    path = os.getenv('MB_PDF_PATH', default_pdf)
    count = seed_from_pdf(path)
    print(f'Seed desde PDF completado: {count} lecciones procesadas')


if __name__ == '__main__':
    main()

