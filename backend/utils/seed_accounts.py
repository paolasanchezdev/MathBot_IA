import argparse
import os
from typing import Optional

from dotenv import load_dotenv
from sqlalchemy import MetaData, Table, select, insert, update

from utils.accounts_repo import get_user_mapping


def _load_env_safe(path: str) -> None:
    encodings = ("utf-8", "utf-8-sig", "cp1252", "latin-1")
    for enc in encodings:
        try:
            load_dotenv(path, encoding=enc)
            os.environ.setdefault("DOTENV_ENCODING", enc)
            break
        except Exception:
            continue


def _role_map(raw: str) -> str:
    r = (raw or "").strip().lower()
    return (
        os.getenv("ROLE_STUDENT") or os.getenv("ROLE_ALUMNO") or "alumno"
        if r in {"student", "estudiante"}
        else os.getenv("ROLE_TEACHER") or os.getenv("ROLE_MAESTRO") or "maestro"
        if r in {"teacher", "profesor", "maestro", "docente"}
        else os.getenv("ROLE_ADMIN") or "administrador" if r in {"admin", "administrator"} else r or "alumno"
    )


def ensure_user(email: str, nombre: str, password: str, rol: str = "alumno") -> Optional[int]:
    # Carga .env y engine del proyecto
    base_dir = os.path.dirname(os.path.dirname(__file__))
    _load_env_safe(os.path.join(base_dir, ".env"))

    from db import engine  # import tardío para usar misma config
    from utils.security import hash_password

    um = get_user_mapping()
    md = MetaData()
    users = Table(um["table"], md, autoload_with=engine)

    email_col = getattr(users.c, um["email"])  # type: ignore
    pk_col = getattr(users.c, um["pk"])  # type: ignore

    with engine.begin() as conn:
        row = conn.execute(select(users).where(email_col == email).limit(1)).fetchone()
        if row:
            # Actualizar datos básicos y password_hash
            stmt = (
                update(users)
                .where(pk_col == row._mapping.get(um["pk"]))
                .values(**{
                    um["email"]: email,
                    um["name"]: nombre,
                    um["role"]: _role_map(rol),
                    um["password_hash"]: hash_password(password),
                })
            )
            conn.execute(stmt)
            return int(row._mapping.get(um["pk"]))
        else:
            ins = insert(users).values(**{
                um["email"]: email,
                um["name"]: nombre,
                um["role"]: _role_map(rol),
                um["password_hash"]: hash_password(password),
            }).returning(pk_col)
            new_id = conn.execute(ins).scalar()
            return int(new_id) if new_id is not None else None


def main():
    parser = argparse.ArgumentParser(description="Crea/actualiza un usuario en la tabla de usuarios mapeada en .env")
    parser.add_argument("--email", required=True, help="Email del usuario")
    parser.add_argument("--nombre", required=True, help="Nombre a mostrar")
    parser.add_argument("--password", required=True, help="Contraseña en texto plano (se guarda como bcrypt)")
    parser.add_argument("--rol", default="alumno", help="Rol (por defecto: alumno)")
    args = parser.parse_args()

    uid = ensure_user(args.email, args.nombre, args.password, args.rol)
    if uid is None:
        print("[ERROR] No se pudo crear/actualizar el usuario. Verifica la tabla y columnas en .env")
        raise SystemExit(1)
    print(f"[OK] Usuario listo. id={uid}, email={args.email}, rol={args.rol}")


if __name__ == "__main__":
    main()
