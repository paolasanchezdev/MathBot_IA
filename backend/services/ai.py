import logging
import os
from functools import lru_cache
from typing import Dict, List, Optional

from dotenv import load_dotenv
from openai import (
    APIConnectionError,
    APIError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    OpenAI,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
)


logger = logging.getLogger(__name__)


DEFAULT_MODEL_FALLBACKS = [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4o-mini-2024-07-18",
    "gpt-4o-mini-2024-04-09",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
]


def _split_models(value: str) -> List[str]:
    return [part.strip() for part in value.split(",") if part and part.strip()]


def _model_candidates(explicit: Optional[str]) -> List[str]:
    candidates: List[str] = []

    def _add(model_name: Optional[str]) -> None:
        if not model_name:
            return
        name = model_name.strip()
        if not name:
            return
        if name not in candidates:
            candidates.append(name)

    env_primary_raw = os.getenv("OPENAI_CHAT_MODEL", "")
    for primary in _split_models(env_primary_raw):
        _add(primary)

    _add(explicit)

    env_fallback_raw = os.getenv("OPENAI_CHAT_MODEL_FALLBACKS", "")
    for fb in _split_models(env_fallback_raw):
        _add(fb)

    for default in DEFAULT_MODEL_FALLBACKS:
        _add(default)

    return candidates


def _ensure_openai_key() -> str:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if key:
        return key
    here = os.path.dirname(__file__)
    candidates = [
        os.path.join(here, ".env"),
        os.path.join(os.path.dirname(here), ".env"),  # backend/.env
        os.path.join(os.getcwd(), ".env"),  # cwd
    ]
    for enc in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        for p in candidates:
            try:
                if os.path.exists(p):
                    load_dotenv(p, encoding=enc, override=True)
            except Exception:
                continue
        key = os.getenv("OPENAI_API_KEY", "").strip()
        if key:
            return key
    return ""


@lru_cache(maxsize=1)
def get_openai_client() -> OpenAI:
    api_key = _ensure_openai_key()
    if not api_key:
        raise RuntimeError("Falta OPENAI_API_KEY en el archivo .env")
    return OpenAI(api_key=api_key)


def compose_system_prompt() -> str:
    return (
        "Eres MathiBot, un maestro de matematicas paciente, didactico y carinoso. Responde usando Markdown.\n"
        "Instrucciones de formato y estilo:\n"
        "- Usa $$ ... $$ para ecuaciones en bloque.\n"
        "- Usa \\( ... \\) para formulas en linea.\n"
        "- Nunca uses corchetes [ ] para formulas.\n"
        "- Explica paso a paso y verifica resultados.\n"
        "- Manten continuidad en la conversacion. Se amable y claro.\n"
        "- Si se proporciona 'Leccion X.Y' y contexto de BD, usalo con prioridad y no cambies ese nombre ni su numeracion.\n"
        "- Si NO hay contexto de la BD, responde igual con tus conocimientos generales de matematicas; nunca inventes contenido de la BD."
    )


def chat_completion(messages: List[Dict[str, str]], model: Optional[str] = None) -> str:
    client = get_openai_client()
    attempts: List[str] = []
    failures: List[str] = []
    last_error: Optional[Exception] = None

    for candidate in _model_candidates(model):
        attempts.append(candidate)
        try:
            response = client.chat.completions.create(model=candidate, messages=messages)
        except AuthenticationError as exc:
            raise RuntimeError("OpenAI rechazo la clave API configurada. Verifica OPENAI_API_KEY.") from exc
        except (
            BadRequestError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
            APIConnectionError,
            APITimeoutError,
            APIStatusError,
            APIError,
            OpenAIError,
        ) as exc:
            last_error = exc
            detail = f"{candidate}: {exc.__class__.__name__}: {exc}"
            failures.append(detail)
            logger.warning("OpenAI model '%s' failed: %s", candidate, exc)
            continue

        choices = getattr(response, "choices", None)
        if choices:
            first_choice = choices[0]
            content = first_choice.message.content if first_choice.message else ""
            if content and content.strip():
                return content
            failures.append(f"{candidate}: respuesta vacia devuelta por OpenAI")
            continue

        failures.append(f"{candidate}: respuesta sin opciones de mensaje")

    attempted = ", ".join(attempts) if attempts else "sin modelos configurados"
    failure_detail = "; ".join(failures) if failures else "sin detalles de error"
    message = (
        "No se pudo generar una respuesta con los modelos configurados "
        f"({attempted}). Detalles: {failure_detail}"
    )
    raise RuntimeError(message) from last_error

