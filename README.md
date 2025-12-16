# 🧠 MathBot.IA: Sistema de Tutoría de Matemáticas Híbrido basado en IA

MathBot.IA es una plataforma web para aprender matemáticas que combina lecciones curadas, un chat impulsado por IA y un panel con estadísticas de avance. El repositorio contiene el backend (FastAPI + SQLite/PostgreSQL) y un frontend estático con experiencias para estudiantes.

## Caracteristicas clave
- Chat didáctico respaldado por OpenAI, con memoria por usuario y contexto de la base de lecciones.
- Panel tipo dashboard con progreso, logros, mini juegos y ajustes personales.
- Módulos de autenticación, gestión de usuarios y alumnos integrados con JWT.
- Scripts para poblar lecciones y cuentas a partir de CSV o PDF.
- Lanzamiento rápido en Windows mediante `run.bat` (levanta API y servidor estático).

---

## Enfoque Pedagógico: La Arquitectura Híbrida de la Consola 

La consola de chat es el núcleo del proyecto y está diseñada bajo un principio de **Educación Autónoma**, combinando la estructura de la base de datos con el poder de la Inteligencia Artificial (IA) para evitar la copia y fomentar el aprendizaje.

### 1. Modo Lecciones (Estructura y Profundización)

Este modo se enfoca en la **integración de datos estructurados** con la capacidad de ampliación de la IA, asegurando la calidad del currículo.

* **Búsqueda Estructurada en PostgreSQL:** El sistema busca lecciones específicas (ej. "Lección 1.3, Unidad 3") en la base de datos. La búsqueda se realiza rigurosamente por **Unidad** y luego por **Lección**, garantizando la coherencia curricular.
* **Ampliación Dinámica con IA:** La información base extraída de la base de datos se envía al modelo de Inteligencia Artificial para ser **ampliada, contextualizada y explicada** de forma detallada, transformando los datos estáticos en una explicación rica e interactiva.

### 2. Modo Pregunta Libre (Autonomía y Generación de Ejercicios)

Este modo garantiza un **aprendizaje dinámico y a medida** en tiempo real:

* **Respuesta con IA Real:** El usuario puede hacer cualquier pregunta matemática y la IA genera la respuesta, actuando como un tutor conversacional.
* **Principio de la No-Copia:** Si el usuario solicita la solución a un ejercicio, MathBot.IA no la entrega. En su lugar, el modelo de IA **genera un ejercicio similar**, obligando al estudiante a aplicar los conceptos por sí mismo.

Este diseño asegura que MathBot.IA sea una herramienta de guía y tutoría que impulsa al usuario a la resolución autónoma de problemas.

---

## Arquitectura
```
backend/
  main.py          # Punto de entrada FastAPI, enruta chat, auth, account, users, alumnos
  routes/          # Controladores HTTP (chat, auth, users, etc.)
  services/ai.py   # Integracion con OpenAI y prompt del tutor MathiBot
  db.py            # Conexion SQLAlchemy (SQLite por defecto, opcional PostgreSQL)
  utils/           # Helpers de seguridad, seeds, repositorios
frontend/
  index.html       # Landing animada + enlaces a login/dashboard
  sections/        # Vistas SPA (dashboard, consola de chat, lecciones, juegos, etc.)
  css/ js/         # Estilos globales y scripts modulares
run.bat            # Script de arranque rapido en Windows
```

## Requisitos previos
- Python 3.10 o superior.
- Pip y entorno virtual disponibles (`python -m venv`).
- Navegador moderno (Chrome, Edge, Firefox, Safari).
- Clave valida de OpenAI (`OPENAI_API_KEY`).
- Opcional: PostgreSQL si se desea migrar desde SQLite.

## Puesta en marcha rapida (Windows)
1. Haz doble clic en `run.bat` o ejecuta `run.bat` desde PowerShell.
2. El script creara/activara `backend/env`, verificara dependencias e iniciara FastAPI en `http://127.0.0.1:8000`.
3. Se abrira `http://127.0.0.1:5500/index.html` y se levantara `python -m http.server 5500` para servir el frontend.
4. Verifica que la ruta `http://127.0.0.1:8000/health` devuelva `{"status":"ok"}`.

## Configuracion manual
### Backend
1. Posicionate en `backend/` y crea el entorno: `python -m venv .venv` (o `env`).
2. Activa el entorno (`.venv\Scripts\activate` en Windows, `source .venv/bin/activate` en Linux/macOS).
3. Instala dependencias: `pip install -r requirements.txt`.
4. Copia `.env` (o crea uno nuevo) y ajusta variables: coloca tu `OPENAI_API_KEY`, `SECRET_KEY`, y credenciales de DB si usas PostgreSQL.
5. Ejecuta la API: `uvicorn main:app --reload --port 8000`.

### Frontend
1. Desde `frontend/` levanta un servidor estatico (ej. `python -m http.server 5500`).
2. Abre `http://127.0.0.1:5500/index.html` en el navegador.
3. Opcional: actualiza `localStorage.mb_api_base` en el navegador si usas puertos/hosts distintos.

## Variables de entorno relevantes
- `OPENAI_API_KEY`: clave de OpenAI; obligatoria para el chat.
- `SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`: configuracion JWT.
- `DB_*`: parametros para PostgreSQL. Si se omiten, se usa SQLite (`data.db`).
- `SCHEMA_MODE`: `simple` o `full` para mapear tablas reflejadas.
- `CHAT_REQUIRE_KNOWN_USER`: obliga a que el usuario exista en BD antes de usar el chat.
- `CORS_ALLOW_ORIGINS`: lista separada por comas con origenes permitidos.

## Endpoints principales
| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/health` | GET | Verificacion rapida del servicio. |
| `/preguntar` | POST | Entrada unificada para preguntas al tutor (usa `ChatRequest`). |
| `/chat/send` | POST | Endpoint directo del router de chat. |
| `/auth/login` | POST | Inicio de sesion con email y password. |
| `/auth/register` | POST | Registro de usuarios (rol alumno/docente). |
| `/auth/refresh` | POST | Reemision de tokens JWT. |
| `/account/me` | GET | Perfil del usuario autenticado. |
| `/users/` | GET | Listado/Busqueda de usuarios. |
| `/alumnos/` | GET/POST | Gestion de alumnos (segun implementacion). |

Consulta `backend/routes/` para ver parametros exactos y validaciones Pydantic.

## Flujo de usuario
1. El visitante entra a `index.html` donde se muestran caracteristicas y CTA.
2. El boton "Entrar" abre `sections/auth/login.html`, que permite login o registro sin recargar la pagina.
3. Tras autenticarse, se persiste `mb_auth` en `localStorage` y se redirige a `sections/dashboard/dashboard.html`.
4. La SPA del dashboard carga modulos bajo demanda (`dashboard.js`) y permite navegar a lecciones, logros, juegos, perfil y ajustes.
5. La consola de chat (`sections/consola/consola.html`) consume `/preguntar`, guarda historiales locales y muestra el contexto de BD usado por la IA.

## Scripts y datos de ejemplo
- `utils/seed_lessons.py`: ingesta de lecciones desde CSV para la tabla de contenidos.
- `utils/seed_accounts.py`: crea cuentas demo (admin/docente/alumno).
- `utils/pdf_ingest.py` y `seed_from_pdf.py`: extraen contenidos desde PDFs.
- `uploads/`: carpeta para archivos de usuario (por ejemplo, PDFs procesados).

Ejecuta los scripts con el entorno virtual activo (`python utils/seed_lessons.py`). Ajusta rutas/encoding antes de correrlos en produccion.

## Notas de desarrollo
- El frontend utiliza `localStorage` para la sesion y peticiones `fetch`; habilita HTTPS/CORS segun tu despliegue.
- Para ambientes productivos, define `DEBUG_JWT`, `CORS_ALLOW_ORIGINS` y usa servidores WSGI/ASGI robustos (ej. uvicorn + nginx).
- Los assets staticos pueden servirse desde un CDN o framework SPA a futuro; actualmente son HTML/JS/CSS planos.
- Mantener el archivo `.env` fuera del control de versiones si contiene credenciales reales.

## Roadmap sugerido
- Persistir historiales de chat en la base de datos en lugar de `localStorage`.
- Agregar pruebas automatizadas para rutas clave (auth, chat, alumnos).
- Integrar build tooling para minificar assets y gestionar dependencias front.
- Internacionalizacion (i18n) y mejoras de accesibilidad.


