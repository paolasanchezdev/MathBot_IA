import os
from urllib.parse import quote_plus
from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

"""Carga robusta del .env con fallback de codificación (Windows cp1252, latin-1)."""
# Cargar .env desde la carpeta backend
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
def _load_env_safe(path: str) -> None:
    encodings = ("utf-8", "utf-8-sig", "cp1252", "latin-1")
    for enc in encodings:
        try:
            load_dotenv(path, encoding=enc)
            os.environ.setdefault("DOTENV_ENCODING", enc)
            break
        except Exception:
            continue

_load_env_safe(dotenv_path)

# Configuración de base de datos
DB_USER = os.getenv("DB_USER") or os.getenv("DB_USERNAME") or "mathbot_user"
DB_PASS = os.getenv("DB_PASS") or os.getenv("DB_PASSWORD") or "math"
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mathbot_db")
DB_DRIVER = (os.getenv("DB_DRIVER", "psycopg2") or "psycopg2").strip()
DB_CLIENT_ENCODING = os.getenv("DB_CLIENT_ENCODING", "UTF8")
os.environ["PGCLIENTENCODING"] = DB_CLIENT_ENCODING


def _make_engine():
    if DB_DRIVER == "psycopg2":
        connect_args = {
            "user": DB_USER,
            "password": DB_PASS,
            "host": DB_HOST,
            "dbname": DB_NAME,
            "options": f"-c client_encoding={DB_CLIENT_ENCODING}",
        }
        if DB_PORT:
            try:
                connect_args["port"] = int(DB_PORT)
            except ValueError:
                pass
        eng = create_engine("postgresql+psycopg2://", connect_args=connect_args, pool_pre_ping=True)
    else:
        url = (
            f"postgresql+{DB_DRIVER}://{quote_plus(DB_USER)}:{quote_plus(DB_PASS)}@"
            f"{DB_HOST}:{DB_PORT}/{DB_NAME}"
        )
        eng = create_engine(url, pool_pre_ping=True)
    return eng


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@event.listens_for(engine, "connect")
def _set_client_encoding(dbapi_connection, connection_record):
    try:
        dbapi_connection.set_client_encoding(DB_CLIENT_ENCODING)
    except Exception:
        pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
