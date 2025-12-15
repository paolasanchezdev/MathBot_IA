from sqlalchemy import Column, Integer, SmallInteger, Text, ForeignKey
from sqlalchemy.orm import declarative_base, relationship

# Base declarativa para el esquema mínimo
Base = declarative_base()


class Unidad(Base):
    __tablename__ = "unidades"
    id_unidad = Column(Integer, primary_key=True, index=True)
    numero = Column(SmallInteger, nullable=False)
    titulo = Column(Text, nullable=False)
    temas = relationship("Tema", back_populates="unidad", cascade="all, delete")


class Tema(Base):
    __tablename__ = "temas"
    id_tema = Column(Integer, primary_key=True, index=True)
    id_unidad = Column(Integer, ForeignKey("unidades.id_unidad", ondelete="CASCADE"), nullable=False)
    numero = Column(SmallInteger, nullable=False)
    titulo = Column(Text, nullable=False)
    unidad = relationship("Unidad", back_populates="temas")
    lecciones = relationship("Leccion", back_populates="tema", cascade="all, delete")


class Leccion(Base):
    __tablename__ = "lecciones"
    id_leccion = Column(Integer, primary_key=True, index=True)
    id_tema = Column(Integer, ForeignKey("temas.id_tema", ondelete="CASCADE"), nullable=False)
    numero = Column(SmallInteger, nullable=False)
    titulo = Column(Text, nullable=False)
    teoria = Column(Text)
    tema = relationship("Tema", back_populates="lecciones")


__all__ = ["Base", "Unidad", "Tema", "Leccion"]

