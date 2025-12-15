import os
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import cast, String

from backend.db import SessionLocal, engine
from backend.models.models_simple import Base, Unidad, Tema, Leccion


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)


def get_or_create_unidad(db: Session, numero: int, titulo: str) -> Unidad:
    # Comparación robusta por número como texto para esquemas donde numero sea TEXT
    obj = db.query(Unidad).filter(cast(Unidad.numero, String) == str(numero)).first()
    if obj:
        if titulo and obj.titulo != titulo:
            obj.titulo = titulo
        return obj
    obj = Unidad(numero=numero, titulo=titulo)
    db.add(obj)
    db.flush()
    return obj


def get_or_create_tema(db: Session, id_unidad: int, numero: int, titulo: str) -> Tema:
    # Intentar primero por (id_unidad, numero) con cast a texto
    obj = (
        db.query(Tema)
        .filter(Tema.id_unidad == id_unidad, cast(Tema.numero, String) == str(numero))
        .first()
    )
    if obj:
        if titulo and obj.titulo != titulo:
            obj.titulo = titulo
            return obj
    # Fallback si no lo encuentra: buscar por título
    obj = db.query(Tema).filter(Tema.id_unidad == id_unidad, Tema.titulo == titulo).first()
    if obj:
        return obj
    obj = Tema(id_unidad=id_unidad, numero=numero, titulo=titulo)
    db.add(obj)
    db.flush()
    return obj


def upsert_leccion(
    db: Session,
    id_tema: int,
    numero: int,
    titulo: str,
    teoria: Optional[str] = None,
) -> Leccion:
    # Intentar por (id_tema, numero) con cast a texto; si no, por título
    obj = (
        db.query(Leccion)
        .filter(Leccion.id_tema == id_tema, cast(Leccion.numero, String) == str(numero))
        .first()
    )
    if not obj:
        obj = (
            db.query(Leccion)
            .filter(Leccion.id_tema == id_tema, Leccion.titulo == titulo)
            .first()
        )
    if obj:
        changed = False
        if titulo and obj.titulo != titulo:
            obj.titulo = titulo
            changed = True
        if teoria is not None and (obj.teoria or "") != teoria:
            obj.teoria = teoria
            changed = True
        if changed:
            db.add(obj)
        return obj
    obj = Leccion(id_tema=id_tema, numero=numero, titulo=titulo, teoria=teoria)
    db.add(obj)
    db.flush()
    return obj


def seed_sample(db: Session) -> None:
    """
    Inserta un ejemplo mínimo para probar el chat:
    Unidad 1 -> Tema 1 -> Lección 1 (1.1)
    """
    u1 = get_or_create_unidad(db, 1, "Unidad 1: Fundamentos")
    t1 = get_or_create_tema(db, u1.id_unidad, 1, "Aritmética básica")
    teoria = (
        "Introducción a la lección 1.1.\n\n"
        "Números naturales, operaciones básicas y propiedades: conmutativa, asociativa y distributiva.\n"
        "Ejemplo: 2 + 3 = 5, 3 × 4 = 12."
    )
    upsert_leccion(db, t1.id_tema, 1, "Lección 1.1 - Números naturales", teoria)


def main():
    ensure_schema()
    with SessionLocal() as db:
        seed_sample(db)
        db.commit()
    print("Seed de ejemplo aplicado: Unidad 1, Lección 1.1")


if __name__ == "__main__":
    main()
