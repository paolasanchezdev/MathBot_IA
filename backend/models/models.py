from sqlalchemy import (
    Column,
    Integer,
    SmallInteger,
    String,
    Text,
    ForeignKey,
    UniqueConstraint,
    CheckConstraint,
    Index,
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.dialects.postgresql import ENUM, CITEXT

# Declarative base compartida para todos los modelos ORM
Base = declarative_base()

# Tipos enumerados de PostgreSQL (ya deben existir en la BD)
AreaEnum = ENUM(
    "precalculo",
    "estadistica",
    name="area_enum",
    create_type=False,
)

RolEnum = ENUM(
    "administrador",
    "maestro",
    "alumno",
    name="rol_enum",
    create_type=False,
)


class Unidad(Base):
    __tablename__ = "unidades"

    id_unidad = Column(Integer, primary_key=True, index=True)
    numero = Column(SmallInteger, nullable=False)
    titulo = Column(Text, nullable=False)
    area = Column(AreaEnum, nullable=False)

    temas = relationship("Tema", back_populates="unidad", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("numero > 0", name="ck_unidades_numero_pos"),
        Index("idx_unidades_area", "area"),
    )


class Tema(Base):
    __tablename__ = "temas"

    id_tema = Column(Integer, primary_key=True, index=True)
    id_unidad = Column(Integer, ForeignKey("unidades.id_unidad", ondelete="CASCADE"), nullable=False)
    # numero: texto que representa enteros (por ejemplo '1', '2')
    numero = Column(String, nullable=False)
    titulo = Column(Text, nullable=False)

    unidad = relationship("Unidad", back_populates="temas")
    lecciones = relationship("Leccion", back_populates="tema", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("numero ~ '^\\d+$'", name="ck_temas_numero_digits"),
        UniqueConstraint("id_unidad", "numero", name="uq_temas_unidad_numero"),
        Index("idx_temas_unidad_numero", "id_unidad", "numero"),
    )


class Leccion(Base):
    __tablename__ = "lecciones"

    id_leccion = Column(Integer, primary_key=True, index=True)
    id_tema = Column(Integer, ForeignKey("temas.id_tema", ondelete="CASCADE"), nullable=False)
    # numero: texto en forma 'x.y'
    numero = Column(String, nullable=False)
    nombre = Column(Text, nullable=False)
    teoria = Column(Text, nullable=False)

    tema = relationship("Tema", back_populates="lecciones")

    __table_args__ = (
        CheckConstraint("numero ~ '^\\d+\\.\\d+$'", name="ck_lecciones_numero_xy"),
        UniqueConstraint("id_tema", "numero", name="uq_lecciones_tema_numero"),
        Index("idx_lecciones_tema_numero", "id_tema", "numero"),
    )


class Usuario(Base):
    __tablename__ = "usuarios"

    id_usuario = Column(Integer, primary_key=True, index=True)
    nombre = Column(Text, nullable=False)
    # Mapeo a CITEXT si la extension esta instalada
    email = Column(CITEXT, nullable=False, unique=True)
    password_hash = Column(Text, nullable=False)
    rol = Column(RolEnum, nullable=False)


class Alumno(Base):
    __tablename__ = "alumnos"

    id_alumno = Column(Integer, ForeignKey("usuarios.id_usuario", ondelete="CASCADE"), primary_key=True)
    nivel = Column(Text, nullable=False)
    bachillerato_anio = Column(SmallInteger, nullable=False)
    especialidad = Column(Text, nullable=False)


__all__ = [
    "Base",
    "Unidad",
    "Tema",
    "Leccion",
    "Usuario",
    "Alumno",
    "AreaEnum",
    "RolEnum",
]

