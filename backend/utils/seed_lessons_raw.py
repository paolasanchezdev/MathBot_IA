from backend.db import engine
from sqlalchemy import text


def seed_unidad1_leccion1():
    teoria = (
        "Teoría de ejemplo para la Unidad 1, Lección 1.1.\n\n"
        "Propiedades básicas de las operaciones con números naturales."
    )
    with engine.begin() as conn:
        # Buscar id_tema de (unidad=1, tema=1)
        row = conn.execute(
            text(
                """
                SELECT t.id_tema
                FROM temas t
                JOIN unidades u ON t.id_unidad = u.id_unidad
                WHERE CAST(u.numero AS VARCHAR) = '1' AND CAST(t.numero AS VARCHAR) = '1'
                LIMIT 1
                """
            )
        ).first()
        if not row:
            print("No existe Tema 1 en Unidad 1; crea primero 'unidades' y 'temas'.")
            return
        id_tema = row[0]

        # ¿Existe la lección 1 para ese tema?
        row2 = conn.execute(
            text(
                "SELECT 1 FROM lecciones WHERE id_tema = :id AND CAST(numero AS VARCHAR) = '1' LIMIT 1"
            ),
            {"id": id_tema},
        ).first()
        if row2:
            print("Ya existe Lección 1.1, no se inserta.")
            return

        # Insertar
        conn.execute(
            text(
                "INSERT INTO lecciones (id_tema, numero, teoria) VALUES (:id_tema, 1, :teoria)"
            ),
            {"id_tema": id_tema, "teoria": teoria},
        )
        print("Insertada Lección 1.1 con teoría de ejemplo.")


if __name__ == "__main__":
    seed_unidad1_leccion1()

