import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple, List

import jwt
from jwt import ExpiredSignatureError, InvalidSignatureError, DecodeError, InvalidTokenError
from passlib.context import CryptContext


_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, password_hash: str) -> bool:
    try:
        if _pwd_context.verify(plain_password, password_hash):
            return True
    except Exception:
        pass
    # Optional dev fallback
    if (os.getenv("ALLOW_PLAINTEXT_PASSWORDS", "false").lower() in {"1", "true", "yes"}):
        return plain_password == password_hash
    return False


def hash_password(plain_password: str) -> str:
    return _pwd_context.hash(plain_password)


def _jwt_settings():
    secret = (os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET") or "change-me").strip()
    algo = (os.getenv("JWT_ALGORITHM", "HS256") or "HS256").strip()
    minutes = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))  # 24h por defecto
    return secret, algo, minutes


def _refresh_jwt_settings():
    """Ajustes para refresh tokens (permite secreto/exp distintos)."""
    secret = (
        os.getenv("REFRESH_SECRET_KEY")
        or os.getenv("REFRESH_JWT_SECRET")
        or os.getenv("SECRET_KEY")
        or os.getenv("JWT_SECRET")
        or "change-me"
    ).strip()
    algo = (os.getenv("JWT_ALGORITHM", "HS256") or "HS256").strip()
    minutes = int(os.getenv("REFRESH_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))  # 7d por defecto
    return secret, algo, minutes


def _fallback_secrets(primary: str) -> List[str]:
    """Devuelve una lista de secretos a intentar (primario + fallbacks opcionales).

    Permite rotación suave de claves sin romper tokens existentes.
    Usa variables opcionales: JWT_SECRET_FALLBACK y JWT_FALLBACK_SECRETS (separadas por coma).
    """
    fallbacks: List[str] = []
    fb_one = (os.getenv("JWT_SECRET_FALLBACK") or "").strip()
    if fb_one and fb_one != primary:
        fallbacks.append(fb_one)
    fb_many_raw = (os.getenv("JWT_FALLBACK_SECRETS") or "").strip()
    if fb_many_raw:
        for s in (x.strip() for x in fb_many_raw.split(",")):
            if s and s not in {primary, *fallbacks}:
                fallbacks.append(s)
    return [primary] + fallbacks


def _refresh_fallback_secrets(primary: str) -> List[str]:
    fallbacks: List[str] = []
    fb_one = (os.getenv("REFRESH_JWT_SECRET_FALLBACK") or "").strip()
    if fb_one and fb_one != primary:
        fallbacks.append(fb_one)
    fb_many_raw = (os.getenv("REFRESH_JWT_FALLBACK_SECRETS") or "").strip()
    if fb_many_raw:
        for s in (x.strip() for x in fb_many_raw.split(",")):
            if s and s not in {primary, *fallbacks}:
                fallbacks.append(s)
    return [primary] + fallbacks


def create_access_token(subject: Dict[str, Any] | str | int, expires_delta: Optional[timedelta] = None) -> str:
    """Crea un JWT de acceso.

    - Cumple RFC: `sub` debe ser string. Guardamos el detalle en `usr`.
    - `subject` puede ser dict o id (str/int).
    """
    secret, algo, minutes = _jwt_settings()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=minutes))

    # Normalizar sujeto
    usr_claim: Optional[Dict[str, Any]] = None
    sub_str: str
    if isinstance(subject, dict):
        usr_claim = subject
        # Tomar id si existe; si no, serializar dict como string estable
        sid = subject.get("id") if isinstance(subject, dict) else None
        if sid is None:
            # Para compatibilidad, intentar email/uid
            sid = subject.get("uid") or subject.get("user_id") or subject.get("email") or "unknown"
        sub_str = str(sid)
    else:
        sub_str = str(subject)

    payload: Dict[str, Any] = {
        "sub": sub_str,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "access",
    }
    if usr_claim is not None:
        payload["usr"] = usr_claim
    # PyJWT v1.x devolvía bytes; v2.x devuelve str. Normalizamos a str.
    token = jwt.encode(payload, secret, algorithm=algo)
    if isinstance(token, bytes):
        try:
            token = token.decode("utf-8")
        except Exception:
            token = token.decode(errors="ignore")
    return token


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodifica un JWT y devuelve un dict con al menos `{ "id": ... }`.

    - Acepta prefijo "Bearer ".
    - Permite secretos de respaldo (rotación de claves).
    - Usa `usr` si está presente; si no, deriva desde `sub` (string).
    """
    if not token:
        return None
    tok = token.strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    if (tok.startswith("\"") and tok.endswith("\"")) or (tok.startswith("'") and tok.endswith("'")):
        tok = tok[1:-1].strip()
    try:
        primary, algo, _ = _jwt_settings()
        leeway = int(os.getenv("JWT_LEEWAY_SECONDS", "30"))  # tolerancia de reloj (por defecto 30s)
        for secret in _fallback_secrets(primary):
            try:
                data = jwt.decode(tok, secret, algorithms=[algo], leeway=leeway)
                # Preferir claim expandido si existe
                usr = data.get("usr")
                if isinstance(usr, dict):
                    # Asegurar que tenga id normalizado
                    if "id" not in usr and isinstance(data.get("sub"), (str, int)):
                        try:
                            usr = {**usr, "id": int(data.get("sub"))}
                        except Exception:
                            usr = {**usr, "id": str(data.get("sub"))}
                    return usr
                sub = data.get("sub")
                if isinstance(sub, (int, str)) and str(sub).strip():
                    try:
                        return {"id": int(sub)}
                    except Exception:
                        return {"id": str(sub)}
                return None
            except (ExpiredSignatureError, InvalidSignatureError, DecodeError, InvalidTokenError):
                # Intentar siguiente secreto
                continue
        return None
    except Exception:
        return None


def decode_access_token_verbose(token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Devuelve (claims_sub, reason) y registra el motivo si falla.

    Intenta con secreto primario y fallbacks, y acepta prefijo "Bearer ".
    """
    if not token:
        return None, "missing"
    tok = token.strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    if (tok.startswith('"') and tok.endswith('"')) or (tok.startswith("'") and tok.endswith("'")):
        tok = tok[1:-1].strip()
    primary, algo, _ = _jwt_settings()
    for idx, secret in enumerate(_fallback_secrets(primary)):
        try:
            data = jwt.decode(tok, secret, algorithms=[algo])
            usr = data.get("usr")
            if isinstance(usr, dict):
                if "id" not in usr and isinstance(data.get("sub"), (str, int)):
                    try:
                        usr = {**usr, "id": int(data.get("sub"))}
                    except Exception:
                        usr = {**usr, "id": str(data.get("sub"))}
                return usr, None
            sub = data.get("sub")
            if isinstance(sub, (int, str)) and str(sub).strip():
                try:
                    return {"id": int(sub)}, None
                except Exception:
                    return {"id": str(sub)}, None
            return None, "no_sub"
        except ExpiredSignatureError as e:
            logging.warning("JWT expired (secret #%d): %s", idx, e)
            return None, "expired"
        except InvalidSignatureError as e:
            logging.warning("JWT invalid signature (secret #%d): %s", idx, e)
            # Probar siguiente secreto
            continue
        except DecodeError as e:
            logging.warning("JWT decode error (secret #%d): %s", idx, e)
            return None, "decode_error"
        except InvalidTokenError as e:
            logging.warning("JWT invalid token (secret #%d): %s", idx, e)
            return None, "invalid_token"
        except Exception as e:
            logging.warning("JWT unknown error (secret #%d): %s", idx, e)
            return None, "unknown"
    return None, "bad_signature"


def create_refresh_token(subject: Dict[str, Any] | str | int, expires_delta: Optional[timedelta] = None) -> str:
    """Crea un JWT de refresco (tipo 'refresh')."""
    secret, algo, minutes = _refresh_jwt_settings()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=minutes))

    usr_claim: Optional[Dict[str, Any]] = None
    sub_str: str
    if isinstance(subject, dict):
        usr_claim = subject
        sid = subject.get("id") if isinstance(subject, dict) else None
        if sid is None:
            sid = subject.get("uid") or subject.get("user_id") or subject.get("email") or "unknown"
        sub_str = str(sid)
    else:
        sub_str = str(subject)

    payload: Dict[str, Any] = {
        "sub": sub_str,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "refresh",
    }
    if usr_claim is not None:
        payload["usr"] = usr_claim

    token = jwt.encode(payload, secret, algorithm=algo)
    if isinstance(token, bytes):
        try:
            token = token.decode("utf-8")
        except Exception:
            token = token.decode(errors="ignore")
    return token


def decode_refresh_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    tok = token.strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    if (tok.startswith("\"") and tok.endswith("\"")) or (tok.startswith("'") and tok.endswith("'")):
        tok = tok[1:-1].strip()
    try:
        primary, algo, _ = _refresh_jwt_settings()
        leeway = int(os.getenv("JWT_LEEWAY_SECONDS", "30"))
        for secret in _refresh_fallback_secrets(primary):
            try:
                data = jwt.decode(tok, secret, algorithms=[algo], leeway=leeway)
                if data.get("type") != "refresh":
                    continue
                usr = data.get("usr")
                if isinstance(usr, dict):
                    if "id" not in usr and isinstance(data.get("sub"), (str, int)):
                        try:
                            usr = {**usr, "id": int(data.get("sub"))}
                        except Exception:
                            usr = {**usr, "id": str(data.get("sub"))}
                    return usr
                sub = data.get("sub")
                if isinstance(sub, (int, str)) and str(sub).strip():
                    try:
                        return {"id": int(sub)}
                    except Exception:
                        return {"id": str(sub)}
                return None
            except (ExpiredSignatureError, InvalidSignatureError, DecodeError, InvalidTokenError):
                continue
        return None
    except Exception:
        return None


def decode_refresh_token_verbose(token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not token:
        return None, "missing"
    tok = token.strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    if (tok.startswith('"') and tok.endswith('"')) or (tok.startswith("'") and tok.endswith("'")):
        tok = tok[1:-1].strip()
    primary, algo, _ = _refresh_jwt_settings()
    for idx, secret in enumerate(_refresh_fallback_secrets(primary)):
        try:
            data = jwt.decode(tok, secret, algorithms=[algo])
            if data.get("type") != "refresh":
                return None, "wrong_type"
            usr = data.get("usr")
            if isinstance(usr, dict):
                if "id" not in usr and isinstance(data.get("sub"), (str, int)):
                    try:
                        usr = {**usr, "id": int(data.get("sub"))}
                    except Exception:
                        usr = {**usr, "id": str(data.get("sub"))}
                return usr, None
            sub = data.get("sub")
            if isinstance(sub, (int, str)) and str(sub).strip():
                try:
                    return {"id": int(sub)}, None
                except Exception:
                    return {"id": str(sub)}, None
            return None, "no_sub"
        except ExpiredSignatureError as e:
            logging.warning("JWT refresh expired (secret #%d): %s", idx, e)
            return None, "expired"
        except InvalidSignatureError as e:
            logging.warning("JWT refresh invalid signature (secret #%d): %s", idx, e)
            continue
        except DecodeError as e:
            logging.warning("JWT refresh decode error (secret #%d): %s", idx, e)
            return None, "decode_error"
        except InvalidTokenError as e:
            logging.warning("JWT refresh invalid token (secret #%d): %s", idx, e)
            return None, "invalid_token"
        except Exception as e:
            logging.warning("JWT refresh unknown error (secret #%d): %s", idx, e)
            return None, "unknown"
    return None, "bad_signature"
