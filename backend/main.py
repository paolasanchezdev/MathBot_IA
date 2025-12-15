import os
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import ValidationError

from db import get_db
from routes import chat as chat_routes
from routes import auth as auth_routes
from routes import account as account_routes
from routes import users as users_routes
from routes import alumnos as alumnos_routes
from routes import lessons as lessons_routes
from routes import teachers as teachers_routes


app = FastAPI(title="MathBot.IA Backend")

cors_origins = os.getenv("CORS_ALLOW_ORIGINS")
if cors_origins:
    allow_list = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
else:
    allow_list = ["http://127.0.0.1:5500", "http://localhost:5500"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_routes.router, prefix="/chat", tags=["chat"])
app.include_router(auth_routes.router, prefix="/auth", tags=["auth"])
app.include_router(account_routes.router, prefix="/account", tags=["account"])
app.include_router(users_routes.router, prefix="/users", tags=["users"])
app.include_router(alumnos_routes.router, prefix="/alumnos", tags=["alumnos"])
app.include_router(teachers_routes.router, prefix="/teachers", tags=["teachers"])
app.include_router(lessons_routes.router, prefix="/lessons", tags=["lessons"])


@app.get("/health")
def healthcheck() -> Dict[str, str]:
    return {"status": "ok"}


async def _extract_payload(request: Request) -> Dict[str, Any]:
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        body = await request.json()
        if isinstance(body, dict):
            return body
        raise HTTPException(status_code=400, detail="JSON payload must be an object")
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        return dict(form)
    try:
        body = await request.json()
        if isinstance(body, dict):
            return body
    except Exception:
        pass
    return {}


def _normalize_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(data)
    message = payload.get("mensaje") or payload.get("message") or payload.get("texto") or payload.get("prompt")
    if isinstance(message, str):
        payload["mensaje"] = message.strip()
    payload.setdefault("user_id", payload.get("user") or payload.get("usuario") or "default")
    if payload.get("mensaje"):
        return payload
    raise HTTPException(status_code=422, detail="Falta el campo 'mensaje'.")


@app.post("/preguntar")
async def preguntar(request: Request, db: Session = Depends(get_db)):
    raw_payload = await _extract_payload(request)
    payload = _normalize_payload(raw_payload)
    try:
        chat_request = chat_routes.ChatRequest(**payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())
    return await run_in_threadpool(chat_routes.chat_send, chat_request, db)

