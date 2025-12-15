from typing import Optional, Dict, Any, List, Tuple, Union
import os
import re
import ast
import math
import logging
import operator as _op
import unicodedata
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text as _sql_text

from services.ai import compose_system_prompt, chat_completion
from db import get_db

router = APIRouter()

logger = logging.getLogger(__name__)

# Memoria simple en proceso por usuario (solo desarrollo)
_histories: Dict[str, List[Dict[str, str]]] = {}
# Estado de sesion simple por usuario para recordar el modo usado
_session_state: Dict[str, Dict[str, Any]] = {}

class ChatRequest(BaseModel):
    user_id: Union[str, int]
    mensaje: str
    unidad: Optional[int] = None
    tema: Optional[int] = None
    leccion: Optional[int] = None
    query: Optional[str] = None
    solo_bd: Optional[bool] = False
    max_context: Optional[int] = 1
    modo: Optional[str] = None
    chat_id: Optional[str] = None

@router.get("/instructions")
def get_instructions():
    return {"instructions": compose_system_prompt()}

def _has_table(db: Session, table_name: str) -> bool:
    try:
        q = _sql_text(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name=:t"
        )
        c = db.execute(q, {"t": table_name}).scalar() or 0
        return int(c) > 0
    except Exception:
        return False

def _norm_lesson_str(s: str) -> str:
    return s.replace(" ", "").replace("/", ".").replace("-", ".")

def _build_state_key(user_id: Union[str, int], chat_id: Optional[str]) -> str:
    base = str(user_id)
    if chat_id:
        return f"{base}:{chat_id}"
    return base

def _normalize_mode(value: Optional[str]) -> str:
    if not value:
        return 'auto'
    normalized = _strip_accents(str(value).strip().lower())
    if normalized in {'general', 'libre', 'abierto', 'preguntas'}:
        return 'general'
    if normalized in {'leccion', 'lesson', 'contexto'}:
        return 'leccion'
    if normalized in {'auto', 'automatico'}:
        return 'auto'
    return 'auto'

def _looks_like_lesson_query(text: str) -> bool:
    if not text:
        return False
    lowered = _strip_accents(text).lower()
    if re.search(r"\\bunidad\\s*\\d+", lowered):
        return True
    if re.search(r"\\bleccion\\s*\\d+", lowered):
        return True
    if re.search(r"\\btema\\s*\\d+", lowered):
        return True
    if re.search(r"\\b\\d+\\s*[./-]\\s*\\d+\\b", lowered):
        return True
    lesson_markers = (
        'segun la leccion',
        'segun la unidad',
        'contenido de la leccion',
        'teoria de la leccion',
        'resume la leccion',
        'apoyo en la unidad',
    )
    return any(marker in lowered for marker in lesson_markers)

def _looks_like_general_reset(text: str) -> bool:
    if not text:
        return False
    lowered = _strip_accents(text).lower()
    general_markers = (
        'cambia a modo general',
        'sin usar la leccion',
        'otro tema',
        'pregunta general',
        'modo libre',
        'sin contexto de lecciones',
    )
    return any(marker in lowered for marker in general_markers)

def _looks_like_exercise_request(text: str) -> bool:
    if not text:
        return False
    lowered = _strip_accents(text).lower()
    directive_keywords = (
        'resuelve', 'resolver', 'soluciona', 'solucion', 'solucionar', 'calcula', 'calcular',
        'hallar', 'determina', 'encuentra', 'obtiene', 'obten', 'despeja', 'simplifica',
        'factoriza', 'evalua', 'deriva', 'derivar', 'integra', 'integral',
        'limite', 'limites', 'resultado', 'resolucion'
    )
    context_keywords = (
        'ejercicio', 'problema', 'ecuacion', 'inecuacion', 'sistema', 'expresion',
        'fraccion', 'polinomio', 'funcion', 'integral', 'derivada', 'limite',
        'triangulo', 'rectangulo', 'angulo', 'perimetro', 'area', 'volumen',
        'hipotenusa', 'cateto', 'probabilidad', 'porcentaje', 'pendiente', 'vector',
        'matriz', 'distancia', 'velocidad', 'tiempo'
    )
    measurement_markers = (
        'cm', 'mm', 'm', 'km', 'kg', 'g', 'l', 'litro', 'litros', 'grado', 'grados',
        'segundo', 'segundos', 'minuto', 'minutos', 'hora', 'horas'
    )
    has_numbers = bool(re.search(r"\d", lowered))
    if any(phrase in lowered for phrase in ('paso a paso', 'muestra la solucion', 'dame la solucion', 'dame el resultado')):
        return True
    if any(keyword in lowered for keyword in directive_keywords):
        if has_numbers or any(ctx in lowered for ctx in context_keywords):
            return True
    if has_numbers and any(ctx in lowered for ctx in context_keywords):
        return True
    if has_numbers and any(unit in lowered for unit in measurement_markers):
        return True
    if has_numbers and re.search(r"=\s*-?\d", lowered):
        return True
    if re.search(r"\b\d+\s*[+\-*/^]\s*\d+", lowered):
        return True
    if has_numbers and re.search(r"\b(cual|que)\s+(es|sera)\b", lowered):
        return True
    if has_numbers and re.search(r"\b(?:es|son)\s+(?:un|una|el|la)\b", lowered):
        return True
    if re.search(r"\b(?:x|y|z|n|t)\s*=\s*-?\d", lowered):
        return True
    return False

def _looks_like_final_answer_request(text: str) -> bool:
    if not text:
        return False
    lowered = _strip_accents(text).lower()
    answer_markers = (
        'dame la respuesta', 'dame la respuesta final', 'cual es la respuesta', 'cual es la respuesta final',
        'cual es el resultado', 'resultado final', 'solo el resultado', 'solo la respuesta',
        'respuesta corta', 'dime la respuesta', 'dime el resultado', 'quiero la respuesta',
        'necesito la respuesta', 'resultado exacto', 'respuesta exacta', 'respuesta final por favor'
    )
    if any(marker in lowered for marker in answer_markers):
        return True
    if re.search(r"\bsolo\s+(?:dame|dime)\s+(?:el\s+)?resultado", lowered):
        return True
    if re.search(r"no\s+se\s+(?:cual|cu[a\\u00e1]l)\s+es\s+(?:la\s+)?respuesta", lowered):
        return True
    if re.search(r"\b(?:respuesta|resultado)\s+final\b", lowered):
        return True
    if 'sin pasos' in lowered and ('respuesta' in lowered or 'resultado' in lowered):
        return True
    if 'solo' in lowered and ('respuesta' in lowered or 'resultado' in lowered):
        return True
    return False


def _format_number(value: float) -> str:
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            txt = f"{value:.6f}".rstrip('0').rstrip('.')
            return txt if txt else "0"
        return str(int(round(value)))
    return str(value)

def _safe_eval_arithmetic(expr: str) -> float:
    node = ast.parse(expr, mode='eval')

    def _eval(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return _eval(n.body)
        if isinstance(n, ast.Constant):
            if isinstance(n.value, (int, float)):
                return float(n.value)
            raise ValueError('Solo numeros constantes permitidos')
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)):
            val = _eval(n.operand)
            return val if isinstance(n.op, ast.UAdd) else -val
        if isinstance(n, ast.BinOp):
            left = _eval(n.left)
            right = _eval(n.right)
            ops = {
                ast.Add: _op.add,
                ast.Sub: _op.sub,
                ast.Mult: _op.mul,
                ast.Div: _op.truediv,
                ast.Pow: _op.pow,
            }
            for ast_type, handler in ops.items():
                if isinstance(n.op, ast_type):
                    return handler(left, right)
            raise ValueError('Operador no permitido')
        raise ValueError('Expresion no permitida')

    result = _eval(node)
    if not isinstance(result, (int, float)):
        raise ValueError('Resultado no numerico')
    return float(result)

def _extract_arithmetic_expression(text: str) -> Optional[Tuple[str, str]]:
    if not text:
        return None
    candidate_text = text.replace(',', '.')
    segments = re.findall(r"[0-9\.\s\+\-\*/\u00d7\u00f7:()^]+", candidate_text)
    cleaned = []
    for seg in segments:
        segment = seg.strip()
        if not segment:
            continue
        if any(op in segment for op in ['+', '-', '*', '/', '\u00d7', '\u00f7', ':', '^']):
            cleaned.append(segment)
    if not cleaned:
        return None
    original = max(cleaned, key=len)
    prepared = original.replace('\u00d7', '*').replace('\u00f7', '/').replace(':', '/').replace('^', '**')
    prepared = prepared.replace('**-', '** -')
    prepared = re.sub(r"\s+", '', prepared)
    if not prepared:
        return None
    return original.strip(), prepared


def _answer_basic_math(question: str) -> Optional[str]:
    if not question:
        return None
    normalized = _strip_accents(question).lower()
    sqrt_match = re.search(r"raiz cuadrada de\s*([0-9]+(?:[.,][0-9]+)?)", normalized)
    if sqrt_match:
        try:
            value = float(sqrt_match.group(1).replace(',', '.'))
        except ValueError:
            value = None
        if value is not None:
            if value < 0:
                return (
                    "La raiz cuadrada de un numero negativo no tiene resultado real. "
                    "Si necesitas manejar raices en numeros complejos, indicamelo."
                )
            result = math.sqrt(value)
            value_txt = _format_number(value)
            result_txt = _format_number(result)
            return (
                f"La raiz cuadrada de {value_txt} es **{result_txt}**.\n\n"
                f"Comprobacion rapida: {result_txt} * {result_txt} = {value_txt}."
            )
    expr_data = _extract_arithmetic_expression(question)
    if expr_data:
        display_expr, eval_expr = expr_data
        try:
            result = _safe_eval_arithmetic(eval_expr)
        except Exception:
            result = None
        if result is not None:
            result_txt = _format_number(result)
            return (
                f"El resultado de la operacion `{display_expr}` es **{result_txt}**.\n\n"
                "Recuerda respetar la jerarquia de operaciones: primero potencias y raices, "
                "luego multiplicaciones y divisiones, y al final sumas y restas."
            )
    return None

GENERAL_TOPIC_TEMPLATES = {
    "geometria": (
        "### Geometria: panorama general\n\n"
        "- **Definicion:** {topic} estudia las figuras, las posiciones relativas y las medidas en el plano y el espacio.\n"
        "- **Elementos basicos:** punto, recta, plano, segmentos, angulos y circunferencias.\n"
        "- **Herramientas clave:** uso de coordenadas, teorema de Pitagoras, formulas de perimetros y areas.\n"
        "- **Aplicacion rapida:** describe o dibuja una figura, identifica datos conocidos y plantea una ecuacion o razonamiento para obtener la magnitud desconocida.\n"
        "- **Practica sugerida:** resuelve un problema cotidiano (por ejemplo, calcular el perimetro de un jardin circular) y verifica el resultado con una segunda estrategia.\n"
    ),
    "algebra": (
        "### Algebra: ideas indispensables\n\n"
        "- **En que se enfoca:** {topic} permite generalizar calculos mediante simbolos y letras.\n"
        "- **Operaciones esenciales:** simplificar expresiones, factorizar, resolver ecuaciones lineales y cuadraticas.\n"
        "- **Recomendacion:** identifica la estructura comun (por ejemplo, un producto notable) antes de operar.\n"
        "- **Practica:** toma una expresion y realiza tres transformaciones distintas (factorizacion, evaluacion numerica y representacion grafica sencilla).\n"
    ),
    "trigonometria": (
        "### Trigonometria en accion\n\n"
        "- **Objetivo:** {topic} estudia relaciones entre angulos y longitudes en triangulos y circunferencias.\n"
        "- **Herramientas basicas:** razones seno, coseno y tangente, identidades trigonometricas y el circulo unitario.\n"
        "- **Uso frecuente:** modelar fenomenos periodicos y resolver triangulos oblicuos.\n"
        "- **Practica sugerida:** calcula las razones trigonometricas de un angulo especial y aplica una identidad para verificar el resultado.\n"
    ),
    "fracciones": (
        "### Fracciones y proporciones\n\n"
        "- **Recordatorio:** una fraccion representa partes de un todo y se manipula con operaciones basicas.\n"
        "- **Pasos clave:** simplificar, encontrar denominadores comunes y convertir entre fraccion, decimal y porcentaje.\n"
        "- **Practica:** crea un ejemplo cotidiano (recetas, repartos) y resuelvelo explicando cada conversion.\n"
    ),
    "probabilidad": (
        "### Probabilidad: pensar en escenarios\n\n"
        "- **Concepto central:** {topic} mide la posibilidad de ocurrencia de eventos entre 0 y 1.\n"
        "- **Herramientas:** espacio muestral, eventos mutuamente excluyentes y probabilidad condicional.\n"
        "- **Practica:** disena un experimento sencillo (por ejemplo, lanzar dos dados) y calcula probabilidades basicas comparando con una simulacion mental.\n"
    ),
    "estadistica": (
        "### Estadistica descriptiva\n\n"
        "- **Meta:** resumir datos mediante medidas de tendencia central y dispersion.\n"
        "- **Pasos rapidos:** ordena los datos, calcula promedio, mediana, moda y la desviacion o rango.\n"
        "- **Aplicacion:** interpreta que significan esos indicadores en el contexto del problema.\n"
    ),
    "derivadas": (
        "### Calculo diferencial y derivadas\n\n"
        "- **Idea:** la derivada mide la razon de cambio instantanea de una funcion.\n"
        "- **Herramientas clave:** reglas de derivacion (potencia, producto, cadena) y analisis de graficas.\n"
        "- **Practica:** deriva una funcion polinomica y verifica el resultado interpretando la pendiente.\n"
    ),
    "integrales": (
        "### Integrales y acumulacion\n\n"
        "- **Concepto:** {topic} permite calcular areas bajo curvas y acumular cantidades.\n"
        "- **Metodos basicos:** integracion por partes, sustitucion y uso de tablas.\n"
        "- **Practica:** resuelve una integral sencilla y comprueba derivando el resultado.\n"
    ),
    "logaritmos": (
        "### Logaritmos\n\n"
        "- **Definicion:** relacion inversa de la exponenciacion, util para resolver ecuaciones del tipo a^x = b.\n"
        "- **Propiedades clave:** producto, cociente y potencia.\n"
        "- **Practica:** transforma un problema exponencial en logaritmico y verifica numericamente.\n"
    ),
}


HIPERBOLA_SUMMARY = (
    "### {topic}\n\n"
    "- **Definicion rapida:** una hiperbola es la conica formada por los puntos cuya diferencia de distancias a dos focos fijos es constante.\n"
    "- **Ecuacion canonica:** en el plano cartesiano, con centro en el origen y eje transversal horizontal, se expresa como x^2/a^2 - y^2/b^2 = 1; si el eje transversal es vertical, y^2/a^2 - x^2/b^2 = 1.\n"
    "- **Elementos clave:** focos (\"F1\", \"F2\"), vertices (\"V1\", \"V2\"), eje transversal, eje conjugado y rectangulos auxiliares que guian la grafica.\n"
    "- **Propiedad fundamental:** cada punto de la curva mantiene constante la diferencia |PF1 - PF2| = 2a, lo que permite derivar sus formulas.\n"
    "- **Aplicacion rapida:** modela trayectorias que divergen, como la aproximacion de orbitas abiertas o reflexiones en antenas parabolicas duales.\n"
    "\nPara practicar, identifica focos y vertices de una hiperbola concreta, verifica la relacion a^2 + b^2 = c^2 y dibuja las rectas asintotas y = +/-(b/a)x que guian la grafica.\n"
)

TANGENT_SUMMARY = (
    "### {topic}\n\n"
    "- **Definicion rapida:** una tangente es una recta que toca una curva en un unico punto y comparte la misma pendiente instantanea en ese lugar.\n"
    "- **En circunferencias:** la recta tangente es perpendicular al radio que llega al punto de contacto y solo intersecta al circulo en ese punto.\n"
    "- **Aplicaciones:** ayuda a describir cambios instantaneos (derivadas) y a resolver problemas geometricos, por ejemplo hallar la longitud de segmentos o direcciones de movimiento.\n"
    "- **Dato util:** en funciones diferenciables, la ecuacion de la tangente en x = a es y = f(a) + f'(a)(x - a).\n"
)


QUADRATIC_FORMULA_SUMMARY = (
    "### {topic}\n\n"
    "- **Definicion:** la formula general resuelve ecuaciones cuadraticas ax^2 + bx + c = 0 y permite encontrar los valores de x cuando a, b y c son reales.\n"
    "- **Expresion:** x = (-b +/- sqrt(b^2 - 4ac)) / (2a).\n"
    "- **Discriminante:** el termino b^2 - 4ac indica cuantas soluciones reales existen: si es positivo hay dos, si es cero hay una doble y si es negativo no hay soluciones reales.\n"
    "- **Uso practico:** antes de aplicar la formula conviene simplificar la ecuacion y verificar que a != 0.\n"
)


SEQUENCE_GENERAL_TERM_SUMMARY = (
    "### {topic}\n\n"
    "- **Que representa:** el termino general describe la expresion a_n que permite calcular cualquier termino de una sucesion segun su posicion n.\n"
    "- **Sucesion aritmetica:** si la diferencia comun es d y el primer termino es a_1, entonces a_n = a_1 + (n - 1)d.\n"
    "- **Sucesion geometrica:** si la razon comun es r y a_1 es el primer termino, entonces a_n = a_1 \cdot r^{{n-1}}.\n"
    "- **Estrategia:** identifica si la sucesion suma una cantidad fija (aritmetica) o multiplica por un factor constante (geometrica); luego usa la formula correspondiente y verifica con varios terminos.\n"
)


PYTHAGORAS_SUMMARY = (
    "### {topic}\n\n"
    "- **Enunciado:** en un triangulo rectangulo, el cuadrado de la hipotenusa equivale a la suma de los cuadrados de los catetos: $$a^2 + b^2 = c^2$$.\n"
    "- **Que permite:** calcular un lado desconocido, verificar si un triangulo es rectangulo y conectar con distancias en el plano cartesiano (distancia euclidiana).\n"
    "- **Variantes utiles:** aplica la version inversa (si se cumple la igualdad, el triangulo es rectangulo) y relaciona con versiones en coordenadas o en 3D.\n"
    "- **Ejemplo rapido:** si los catetos miden 6 y 8, entonces $$c = \sqrt{6^2 + 8^2} = \sqrt{36 + 64} = 10$$.\n"
    "- **Practica:** resuelve diagonales de cuadrados, distancias entre puntos o problemas de escalas y comprueba reemplazando en la formula.\n"
)

SPECIFIC_TOPIC_SUMMARIES = {
    "hiperbola": HIPERBOLA_SUMMARY,
    "hiperbolas": HIPERBOLA_SUMMARY,
    "concepto de hiperbola": HIPERBOLA_SUMMARY,
    "tangente": TANGENT_SUMMARY,
    "tangentes": TANGENT_SUMMARY,
    "recta tangente": TANGENT_SUMMARY,
    "tangente de una circunferencia": TANGENT_SUMMARY,
    "tangente a una curva": TANGENT_SUMMARY,
    "formula general": QUADRATIC_FORMULA_SUMMARY,
    "la formula general": QUADRATIC_FORMULA_SUMMARY,
    "formula cuadratica": QUADRATIC_FORMULA_SUMMARY,
    "ecuacion cuadratica": QUADRATIC_FORMULA_SUMMARY,

    "teorema de pitagoras": PYTHAGORAS_SUMMARY,
    "teorema pitagoras": PYTHAGORAS_SUMMARY,
    "teorema del pitagoras": PYTHAGORAS_SUMMARY,
    "pitagoras": PYTHAGORAS_SUMMARY,
    "termino general": SEQUENCE_GENERAL_TERM_SUMMARY,
    "terminos generales": SEQUENCE_GENERAL_TERM_SUMMARY,
    "sucesion": SEQUENCE_GENERAL_TERM_SUMMARY,
    "sucesiones": SEQUENCE_GENERAL_TERM_SUMMARY,
}
def _strip_accents(text: str) -> str:


    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))

def _normalize_topic_text(text: str) -> str:
    base = _strip_accents(text).lower()
    clean_chars: List[str] = []
    for ch in base:
        clean_chars.append(ch if ch.isalnum() or ch.isspace() else " ")
    return " ".join("".join(clean_chars).split())

def _extract_topic_from_question(question: str) -> Optional[str]:
    if not question:
        return None
    plain = _normalize_topic_text(question)
    if "termino general" in plain or "terminos generales" in plain:
        return "termino general"
    if "sucesion" in plain and "termino" in plain:
        return "termino general"
    patterns = [
        r"que es (.+)",
        r"que significa (.+)",
        r"explica (.+)",
        r"definicion de (.+)",
        r"sobre (.+)",
        r"formula(?: general)?(?: para| del)? (.+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, plain)
        if not match:
            continue
        candidate = match.group(1).strip(" ?.,!")
        if not candidate:
            continue
        words = candidate.split()
        if len(words) > 6:
            words = words[:6]
        if words and words[0] in {"la", "el", "los", "las", "un", "una"}:
            words = words[1:]
        candidate = " ".join(words).strip()
        if candidate:
            return candidate
    words = plain.split()
    if not words:
        return None
    candidate = " ".join(words[-3:]).strip()
    return candidate or None

def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()

def _should_preserve_numeric_token(text: str, start_index: int) -> bool:
    if start_index <= 0:
        return False
    immediate_prev = text[start_index - 1]
    if immediate_prev.isalpha():
        return True
    if immediate_prev in {'^', '_'}:
        return True
    i = start_index - 1
    while i >= 0 and text[i].isspace():
        i -= 1
    if i >= 0 and text[i] in {'^', '_'}:
        return True
    if i >= 0 and text[i] == '{':
        j = i - 1
        while j >= 0 and text[j].isspace():
            j -= 1
        if j >= 0 and text[j] in {'^', '_'}:
            return True
    return False

def _compose_guided_example_system_instruction(question: str) -> str:
    cleaned = re.sub(r"\s+", " ", (question or "").strip())
    if len(cleaned) > 400:
        cleaned = cleaned[:400].rstrip() + "..."
    return (
        "Estas en modo libre y el estudiante pidio resolver un ejercicio.\n"
        f"Enunciado original: \"{cleaned}\".\n"
        "No entregues la solucion literal del enunciado original. En su lugar, plantea un ejercicio del mismo tipo (misma estructura y objetivo) con datos distintos, resuelvelo paso a paso y explica cada fase. "
        "Incluye recomendaciones concretas para que el estudiante aplique el metodo en su ejercicio original y deja claro que no proporcionas la respuesta exacta."
    )


def _ensure_guided_example_variant(question: str) -> Tuple[str, Dict[str, str]]:
    variant, mapping = _generate_variant_exercise(question)
    if variant:
        return variant, mapping
    cleaned = re.sub(r"\s+", " ", (question or "").strip())
    if not cleaned:
        return "", {}

    replacements: Dict[str, str] = {}

    def _replacement(match):
        start_index = match.start()
        original = match.group(0)
        if _should_preserve_numeric_token(cleaned, start_index):
            return original
        try:
            value = int(original)
        except ValueError:
            return original
        if original in replacements:
            return replacements[original]
        delta = 2 if value >= 0 else -2
        new_value = str(value + delta)
        replacements[original] = new_value
        return new_value

    variant_text = re.sub(r"-?\d+", _replacement, cleaned)
    variant_text = re.sub(r"\s+", " ", variant_text).strip()
    if not variant_text or variant_text == cleaned:
        return "", {}
    return variant_text, replacements

def _compose_guided_example_user_prompt(original_question: str, variant: str, mapping: Dict[str, str]) -> str:
    original_clean = re.sub(r"\s+", " ", (original_question or "").strip()) or "(sin enunciado)"
    variant_clean = re.sub(r"\s+", " ", (variant or "").strip())
    lines = [
        f"Ejercicio original del estudiante: \"{original_clean}\".",
    ]
    if variant_clean and not variant_clean.lower().startswith("disena"):
        lines.append("Resuelve paso a paso el siguiente ejercicio similar (con numeros distintos al original) y explica cada operacion en lenguaje sencillo:")
        lines.append(variant_clean)
    else:
        lines.append("Crea un ejercicio del mismo tipo con datos distintos al original y resuelvelo detalladamente como ejemplo guiado.")
    if mapping:
        lines.append("Senala las diferencias clave respecto al ejercicio original, por ejemplo:")
        for original, new_value in list(mapping.items())[:5]:
            lines.append(f"- En lugar de {original} usa {new_value} en el ejemplo.")
    lines.append("Aclara que el ejemplo mantiene el mismo tipo de problema (por ejemplo, si el original es una ecuacion cuadratica, ofrece otra cuadratica con datos distintos).")
    lines.append("Aclara que el ejemplo es solo una guia y anima al estudiante a aplicar el mismo procedimiento en su enunciado.")
    lines.append("Termina con recomendaciones para que el estudiante resuelva su ejercicio original sin copiar la solucion literal.")
    return "\n".join(lines)


def _compose_guided_example_followup_instruction(original_question: str, variant: str, mapping: Dict[str, str]) -> str:
    original_clean = re.sub(r"\s+", " ", (original_question or "").strip()) or "(sin enunciado)"
    variant_clean = re.sub(r"\s+", " ", (variant or "").strip())
    lines = [
        "El estudiante sigue practicando el mismo ejercicio original.",
        f"Ejercicio original: \"{original_clean}\".",
    ]
    if variant_clean and not variant_clean.lower().startswith("disena"):
        lines.append(f"Manten el ejemplo similar de referencia: \"{variant_clean}\".")
    lines.append("Recuerda mantener el mismo tipo de ejercicio (misma estructura y objetivo) cuando des pistas o ajustes.")
    lines.append("No reveles la solucion exacta del enunciado original. Ofrece recordatorios del procedimiento, pistas, comprobaciones y recomendaciones para que el estudiante lo resuelva por su cuenta.")
    if mapping:
        lines.append("Cuando des pistas, menciona diferencias como:")
        for original, new_value in list(mapping.items())[:5]:
            lines.append(f"- Original: {original} | Ejemplo: {new_value}")
    lines.append("Si el estudiante comete un error, corrige el proceso en el ejemplo similar y sugiere como verificarlo en su ejercicio original.")
    return "\n".join(lines)


def _compose_final_answer_system_instruction(original_question: str) -> str:
    cleaned = re.sub(r"\s+", " ", (original_question or "").strip())
    if len(cleaned) > 400:
        cleaned = cleaned[:400].rstrip() + "..."
    return (
        "El estudiante pide la respuesta final del ejercicio original, pero debes mantener la politica de no resolverlo literalmente.\n"
        f"Enunciado original: \"{cleaned}\".\n"
        "Reitera que no puedes proporcionar el resultado exacto. Refuerza el ejemplo similar o propone uno nuevo del mismo tipo, guiando como cerrar el ejercicio original sin revelar la solucion concreta."
    )


def _compose_final_answer_user_prompt(original_question: str) -> str:
    cleaned = re.sub(r"\s+", " ", (original_question or "").strip()) or "(sin enunciado)"
    lines = [
        f"El estudiante solicita la respuesta final del ejercicio original: \"{cleaned}\".",
        "Explica que la politica es no entregar la solucion exacta del enunciado original.",
        "Refuerza el procedimiento usando el ejercicio similar (o genera uno nuevo del mismo tipo) y describe como el estudiante puede obtener y verificar su propio resultado.",
    ]
    return "\n".join(lines)


def _shift_numeric_value(raw: str) -> str:
    try:
        normalized = raw.replace(",", ".")
        number = float(normalized)
        delta = 1.0 if abs(number) < 10 else max(2.0, abs(number) * 0.15)
        updated = number + delta if number >= 0 else number - delta
        text = f"{updated:.2f}".rstrip('0').rstrip('.')
        if "," in raw and "." not in raw:
            return text.replace(".", ",")
        if "." not in raw and "," not in raw:
            return str(int(round(updated)))
        return text
    except Exception:
        try:
            number = int(raw)
            delta = 2 if abs(number) < 10 else max(2, int(abs(number) * 0.15))
            return str(number + delta if number >= 0 else number - delta)
        except Exception:
            return raw


def _generate_variant_exercise(question: str) -> Tuple[str, Dict[str, str]]:
    if not question:
        return "", {}
    source = question
    replacements: Dict[str, str] = {}
    pattern = re.compile(r"-?\d+(?:[.,]\d+)?")

    def _replace(match):
        start_index = match.start()
        original = match.group(0)
        if _should_preserve_numeric_token(source, start_index):
            return original
        if original in replacements:
            return replacements[original]
        shifted = _shift_numeric_value(original)
        if shifted == original:
            return original
        replacements[original] = shifted
        return shifted

    variant = pattern.sub(_replace, source)
    variant_clean = re.sub(r"\s+", " ", variant).strip()
    base_clean = re.sub(r"\s+", " ", source).strip()
    if not replacements or variant_clean == base_clean:
        return "", {}
    return variant_clean, replacements

def _compose_guided_example_fallback(question: str) -> str:
    original_clean = re.sub(r"\s+", " ", (question or '').strip())
    variant, mapping = _generate_variant_exercise(original_clean)
    if not variant:
        variant = (
            "Plantea un ejercicio equivalente del mismo tipo (misma estructura y objetivo) modificando ligeramente los valores numericos del enunciado original "
            "para practicar el mismo procedimiento."
        )
    steps = [
        "1. Verifica que el ejercicio propuesto mantiene el mismo tipo de problema que el original (misma estructura y objetivo).",
        "2. Identifica los datos conocidos y lo que se pide.",
        "3. Determina la propiedad, formula o estrategia que resuelve el problema y justifica por que aplica.",
        "4. Sustituye los valores del ejercicio similar y desarrolla cada operacion paso a paso.",
        "5. Interpreta el resultado obtenido y verifica si responde a la pregunta planteada.",
    ]
    lines = [
        "### Ejercicio similar propuesto",
        variant,
        "",
        "### Resolucion guiada",
    ]
    lines.extend(steps)
    if mapping:
        lines.append("")
        lines.append("### Diferencias respecto al ejercicio original")
        for original, new_value in mapping.items():
            lines.append(f"- Donde el original usa {original}, aqui se emplea {new_value}.")
    lines.append("")
    lines.append("Ahora intenta repetir el procedimiento con tu enunciado original y contrasta tu respuesta usando los pasos anteriores.")
    return "\n".join(lines)


def _compose_final_answer_fallback(original_question: str) -> str:
    cleaned = re.sub(r"\s+", " ", (original_question or '').strip())
    if cleaned:
        header = f"No puedo proporcionar la respuesta final del ejercicio original \"{cleaned}\"."
    else:
        header = "No puedo proporcionar la respuesta final del ejercicio solicitado."
    lines = [
        header,
        "Mantengo la politica de trabajar solo con ejemplos similares para que completes tu propio proceso.",
        "Usa el ejemplo guiado como referencia, replica el metodo con tus datos y verifica tu resultado con las comprobaciones sugeridas.",
    ]
    return "\n".join(lines)
def _split_sentences(text: str) -> List[str]:
    if not text:
        return []
    raw = re.split(r"(?<=[.!?])\s+", text.replace("\r", " ").replace("\n", " ").strip())
    return [chunk.strip() for chunk in raw if chunk and chunk.strip()]

def _build_context_snippet(item: Dict[str, Any], limit: int = 1500) -> str:
    unidad = item.get("unidad") or "?"
    leccion = item.get("leccion") or "?"
    titulo = _clean_text(item.get("titulo")) or "Sin titulo"
    tema = _clean_text(item.get("tema"))
    suffix = f" (Tema: {tema})" if tema else ""
    lines = [f"Unidad {unidad} - Leccion {leccion}: {titulo}{suffix}"]
    for key, label in (
        ("objetivo", "Objetivo principal"),
        ("teoria", "Teoria base"),
        ("formulas", "Formulas clave"),
        ("actividades", "Actividades sugeridas"),
    ):
        value = _clean_text(item.get(key))
        if value:
            lines.append(f"{label}: {value}")
    snippet = "\n".join(lines).strip()
    if len(snippet) > limit:
        snippet = snippet[: max(0, limit - 3)] + "..."
    return snippet

def _compose_context_answer(items: List[Dict[str, Any]]) -> str:
    if not items:
        return ""
    main = items[0]
    unidad = main.get("unidad") or "?"
    leccion = main.get("leccion") or "?"
    titulo = _clean_text(main.get("titulo")) or "Sin titulo"
    tema = _clean_text(main.get("tema"))
    teoria_text = _clean_text(main.get("teoria"))
    objetivo = _clean_text(main.get("objetivo"))
    formulas = _clean_text(main.get("formulas"))
    actividades = _clean_text(main.get("actividades"))
    sentences = _split_sentences(teoria_text)
    overview = sentences[0] if sentences else objetivo
    key_points = sentences[: min(5, len(sentences))]
    related: List[str] = []
    for extra in items[1:5]:
        titulo_rel = _clean_text(extra.get("titulo")) or "Sin titulo"
        related.append(f"- Unidad {extra.get('unidad')} - Leccion {extra.get('leccion')}: {titulo_rel}")
    lines: List[str] = [f"### Leccion {leccion} - {titulo}", f"- Unidad: {unidad}"]
    if tema:
        lines.append(f"- Tema: {tema}")
    if objetivo:
        lines.append(f"- Objetivo central: {objetivo}")
    if overview and overview != objetivo:
        lines.append("")
        lines.append(f"**Idea central resumida:** {overview}")
    if teoria_text:
        lines.append("")
        lines.append("#### Desarrollo explicado")
        lines.append(teoria_text)
    if key_points:
        lines.append("")
        lines.append("#### Puntos clave")
        for point in key_points:
            lines.append(f"- {point}")
    if formulas:
        lines.append("")
        lines.append("#### Formulas o relaciones importantes")
        lines.append(formulas)
    lines.append("")
    lines.append("#### Ejemplo guiado")
    lines.append(f"1. Identifica los datos conocidos relacionados con '{titulo}'.")
    lines.append("2. Selecciona la formula o propiedad adecuada y reemplaza los valores.")
    lines.append("3. Realiza los calculos paso a paso explicando cada operacion.")
    lines.append("4. Verifica la respuesta analizando si el resultado tiene sentido con la situacion planteada.")
    lines.append("")
    lines.append("#### Practica adicional")
    if actividades:
        lines.append(f"- Retoma una actividad sugerida: {actividades}")
    lines.append("- Plantea un ejercicio propio que use el concepto principal y resuelvelo paso a paso.")
    lines.append("- Contrasta tu solucion con otra estrategia o revisa el resultado con una estimacion rapida.")
    if related:
        lines.append("")
        lines.append("#### Otras lecciones relacionadas")
        lines.extend(related)
    lines.append("")
    lines.append("Sigue preguntando si deseas profundizar en un subtema o ver otro ejemplo.")
    return "\n".join(lines)

def _general_math_fallback(question: str) -> str:
    topic = _extract_topic_from_question(question or "")
    topic_label = topic.title() if topic else "el tema consultado"
    basic_answer = _answer_basic_math(question)
    if basic_answer:
        return basic_answer
    normalized = _normalize_topic_text(topic or "")
    topic_lower = _strip_accents(topic_label).lower()
    if normalized:
        for key, summary in SPECIFIC_TOPIC_SUMMARIES.items():
            if key in normalized:
                return summary.format(topic=topic_label, topic_lower=topic_lower)
        for key, template in GENERAL_TOPIC_TEMPLATES.items():
            if key in normalized:
                return template.format(topic=topic_label, topic_lower=topic_lower)
    default_template = (
        "### Repaso guiado sobre {topic}\n\n"
        "- **Define el concepto:** escribe con tus palabras que es {topic_lower} y por que es importante.\n"
        "- **Propiedades clave:** anota formulas, reglas o pasos que siempre debas recordar.\n"
        "- **Ejemplo rapido:** plantea un ejemplo sencillo y resuelvelo explicando cada paso.\n"
        "- **Practica y extension:** crea una variacion del ejemplo, analiza posibles errores y relaciona el tema con otra unidad que ya conozcas.\n"
    )
    return default_template.format(topic=topic_label, topic_lower=topic_lower)
def _fetch_teoria_from_db(db: Session, unidad: Optional[int], leccion: Optional[int], tema: Optional[int] = None) -> Optional[Dict[str, Any]]:

    if unidad is None or leccion is None:

        return None

    lnum = f"{unidad}.{leccion}"

    lnum_full = f"{tema}.{leccion}" if tema is not None else None

    try:

        if _has_table(db, "lessons"):

            if lnum_full is not None:

                row = db.execute(

                    _sql_text(

                        """

                        SELECT unit_number AS unidad,

                               lesson_number AS leccion,

                               COALESCE(lesson_title,'') AS titulo,

                               COALESCE(objective,'') AS objetivo,

                               COALESCE(theory,'') AS teoria,

                               COALESCE(key_formulas,'') AS formulas,

                               COALESCE(suggested_activities,'') AS actividades

                        FROM lessons

                        WHERE CAST(unit_number AS VARCHAR)=:u

                          AND REPLACE(REPLACE(REPLACE(TRIM(lesson_number),' ',''),'/','.'),'-','.')=:ln

                        LIMIT 1

                        """

                    ),

                    {"u": str(unidad), "ln": _norm_lesson_str(lnum_full)},

                ).first()

            else:

                row = db.execute(

                    _sql_text(

                        """

                        SELECT unit_number AS unidad,

                               lesson_number AS leccion,

                               COALESCE(lesson_title,'') AS titulo,

                               COALESCE(objective,'') AS objetivo,

                               COALESCE(theory,'') AS teoria,

                               COALESCE(key_formulas,'') AS formulas,

                               COALESCE(suggested_activities,'') AS actividades

                        FROM lessons

                        WHERE CAST(unit_number AS VARCHAR)=:u

                          AND (

                            REPLACE(REPLACE(REPLACE(TRIM(lesson_number),' ',''),'/','.'),'-','.') LIKE :suf

                            OR REPLACE(REPLACE(REPLACE(TRIM(lesson_number),' ',''),'/','.'),'-','.') = :eq

                          )

                        ORDER BY lesson_number ASC

                        LIMIT 1

                        """

                    ),

                    {"u": str(unidad), "suf": f"%.{leccion}", "eq": str(leccion)},

                ).first()

            if row:

                m = row._mapping if hasattr(row, "_mapping") else None

                return {

                    "unidad": int(m["unidad"]) if m else int(row[0]),

                    "leccion": (m["leccion"] if m else row[1]) or lnum,

                    "titulo": (m["titulo"] if m else row[2]) or "",

                    "tema": "",

                    "teoria": (m["teoria"] if m else row[4]) or "",

                    "objetivo": (m["objetivo"] if m else row[3]) or "",

                    "formulas": (m["formulas"] if m else row[5]) or "",

                    "actividades": (m["actividades"] if m else row[6]) or "",

                }

        if lnum_full is not None:

            row = db.execute(

                _sql_text(

                    """

                    SELECT u.numero AS unidad, l.numero AS leccion,

                           COALESCE(l.nombre,'') AS titulo,

                           COALESCE(t.titulo,'') AS tema,

                           COALESCE(l.teoria,'') AS teoria

                    FROM lecciones l

                    JOIN temas t ON l.id_tema=t.id_tema

                    JOIN unidades u ON t.id_unidad=u.id_unidad

                    WHERE CAST(u.numero AS VARCHAR)=:u AND l.numero=:ln

                    LIMIT 1

                    """

                ),

                {"u": str(unidad), "ln": lnum_full},

            ).first()

        else:

            row = db.execute(

                _sql_text(

                    """

                    SELECT u.numero AS unidad, l.numero AS leccion,

                           COALESCE(l.nombre,'') AS titulo,

                           COALESCE(t.titulo,'') AS tema,

                           COALESCE(l.teoria,'') AS teoria

                    FROM lecciones l

                    JOIN temas t ON l.id_tema=t.id_tema

                    JOIN unidades u ON t.id_unidad=u.id_unidad

                    WHERE CAST(u.numero AS VARCHAR)=:u AND l.numero=:ln

                    LIMIT 1

                    """

                ),

                {"u": str(unidad), "ln": lnum},

            ).first()

        if not row:

            row = db.execute(

                _sql_text(

                    """

                    SELECT u.numero AS unidad, l.numero AS leccion,

                           COALESCE(l.nombre,'') AS titulo,

                           COALESCE(t.titulo,'') AS tema,

                           COALESCE(l.teoria,'') AS teoria

                    FROM lecciones l

                    JOIN temas t ON l.id_tema=t.id_tema

                    JOIN unidades u ON t.id_unidad=u.id_unidad

                    WHERE CAST(u.numero AS VARCHAR)=:u AND split_part(l.numero,'.',2)::int=:lec

                    ORDER BY t.numero::int ASC

                    LIMIT 1

                    """

                ),

                {"u": str(unidad), "lec": int(leccion)},

            ).first()

        if not row:

            return None

        m = row._mapping if hasattr(row, "_mapping") else None

        return {

            "unidad": int(m["unidad"]) if m else int(row[0]),

            "leccion": (m["leccion"] if m else row[1]) or lnum,

            "titulo": (m["titulo"] if m else row[2]) or "",

            "tema": (m["tema"] if m else row[3]) or "",

            "teoria": (m["teoria"] if m else row[4]) or "",

            "objetivo": "",

            "formulas": "",

            "actividades": "",

        }

    except Exception:

        return None

def _parse_leccion_text(q: str) -> Optional[str]:
    if not q:
        return None
    m = re.search(r"lecci[o\u00f3]n\s+(\d{1,3}[\./-]\d{1,3})", q.lower()) or re.search(r"(\d{1,3}[\./-]\d{1,3})", q.lower())
    return _norm_lesson_str(m.group(1)) if m else None

def _parse_structure_from_text(q: str) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    if not q:
        return None, None, None
    txt = q.lower()
    unidad = None
    tema = None
    leccion = None

    mu = re.search(r"unidad\s+(\d{1,3})", txt)
    if mu:
        try:
            unidad = int(mu.group(1))
        except Exception:
            unidad = None

    mp = re.search(r"(\d{1,3})\s*[\./-]\s*(\d{1,3})", txt)
    if mp:
        a = int(mp.group(1))
        b = int(mp.group(2))
        if unidad is not None:
            tema, leccion = a, b
        else:
            unidad, leccion = a, b

    ml = re.search(r"lecci[o\u00f3]n\s+(\d{1,3})", txt)
    if leccion is None and ml:
        try:
            leccion = int(ml.group(1))
        except Exception:
            pass
    return unidad, tema, leccion

def _parse_numbers_from_text(q: str) -> Tuple[Optional[int], Optional[int]]:
    u, _t, l = _parse_structure_from_text(q)
    return u, l

def _search_lessons(db: Session, query: Optional[str], unidad: Optional[int], leccion: Optional[int], limit: int = 3) -> List[Dict[str, Any]]:

    results: List[Dict[str, Any]] = []

    try:

        if unidad is not None and leccion is not None:

            exact = _fetch_teoria_from_db(db, unidad, leccion)

            if exact:

                results.append(exact)

                if len(results) >= max(1, limit):

                    return results

        if not (query and query.strip()):

            return results

        legacy_rows = db.execute(

            _sql_text(

                """

                SELECT u.numero AS unidad, l.numero AS leccion,

                       COALESCE(l.nombre,'') AS titulo,

                       COALESCE(t.titulo,'') AS tema,

                       COALESCE(l.teoria,'') AS teoria

                FROM lecciones l

                JOIN temas t ON l.id_tema=t.id_tema

                JOIN unidades u ON t.id_unidad=u.id_unidad

                WHERE (l.nombre ILIKE :q OR t.titulo ILIKE :q OR u.titulo ILIKE :q OR l.teoria ILIKE :q OR l.numero ILIKE :q)

                LIMIT :lim

                """

            ),

            {"q": f"%{query.strip()}%", "lim": max(1, limit)},

        ).fetchall()

        for row in legacy_rows:

            m = row._mapping if hasattr(row, "_mapping") else None

            results.append({

                "unidad": int(m["unidad"]) if m else int(row[0]),

                "leccion": (m["leccion"] if m else row[1]),

                "titulo": (m["titulo"] if m else row[2]) or "",

                "tema": (m["tema"] if m else row[3]) or "",

                "teoria": (m["teoria"] if m else row[4]) or "",

                "objetivo": "",

                "formulas": "",

                "actividades": "",

            })

        if _has_table(db, "lessons"):

            try:

                params: Dict[str, Any] = {"q": f"%{query.strip()}%", "lim": max(1, limit)}

                clauses = [

                    "lesson_title ILIKE :q",

                    "objective ILIKE :q",

                    "theory ILIKE :q",

                    "key_formulas ILIKE :q",

                    "lesson_number ILIKE :q",

                ]

                if unidad is not None:

                    clauses.insert(0, "CAST(unit_number AS VARCHAR)=:wu")

                    params["wu"] = str(unidad)

                where_sql = " OR ".join(clauses[1:])

                if unidad is not None:

                    where_sql = "CAST(unit_number AS VARCHAR)=:wu AND (" + " OR ".join(clauses[1:]) + ")"

                else:

                    where_sql = " OR ".join(clauses)

                query_sql = (

                    "SELECT unit_number AS unidad, lesson_number AS leccion, "

                    "COALESCE(lesson_title,'') AS titulo, COALESCE(objective,'') AS objetivo, "

                    "COALESCE(theory,'') AS teoria, COALESCE(key_formulas,'') AS formulas, "

                    "COALESCE(suggested_activities,'') AS actividades "

                    "FROM lessons WHERE " + where_sql + " LIMIT :lim"

                )

                rows_new = db.execute(_sql_text(query_sql), params).fetchall()

                for row in rows_new:

                    m = row._mapping if hasattr(row, "_mapping") else None

                    results.append({

                        "unidad": int(m["unidad"]) if m else int(row[0]),

                        "leccion": (m["leccion"] if m else row[1]) or "",

                        "titulo": (m["titulo"] if m else row[2]) or "",

                        "tema": "",

                        "teoria": (m["teoria"] if m else row[4]) or "",

                        "objetivo": (m["objetivo"] if m else row[3]) or "",

                        "formulas": (m["formulas"] if m else row[5]) or "",

                        "actividades": (m["actividades"] if m else row[6]) or "",

                    })

            except Exception:

                pass

        unique: List[Dict[str, Any]] = []

        seen = set()

        for item in results:

            key = (item.get("unidad"), item.get("leccion"), item.get("titulo"))

            if key in seen:

                continue

            seen.add(key)

            unique.append(item)

        return unique[: max(1, limit)]

    except Exception:

        return results

@router.post("/send")
def chat_send(data: ChatRequest, db: Session = Depends(get_db)):
    try:
        # Validacion de usuario (opcional)
        if os.getenv("CHAT_REQUIRE_KNOWN_USER", "false").lower() in {"1", "true", "yes"}:
            try:
                from utils.users_reflect import get_user_by_id
                if not get_user_by_id(db, data.user_id):
                    raise HTTPException(status_code=404, detail="Usuario no encontrado")
            except HTTPException:
                raise
            except Exception:
                pass

        uid = str(data.user_id)
        state_key = _build_state_key(data.user_id, data.chat_id)
        hist = _histories.setdefault(state_key, [])
        session = _session_state.setdefault(state_key, {"last_mode": "auto", "last_context": False})

        message_text = data.mensaje or ""
        requested_mode = _normalize_mode(data.modo)
        last_mode = session.get("last_mode", "auto")
        last_context = bool(session.get("last_context"))
        mode = requested_mode
        if mode == "auto":
            if last_mode == "leccion" and last_context and not _looks_like_general_reset(message_text):
                mode = "leccion"
            else:
                mode = "leccion" if _looks_like_lesson_query(message_text) else "general"

        previous_exercise_prompt = str(session.get("exercise_prompt", ""))
        previous_variant = str(session.get("exercise_variant", ""))
        stored_mapping = session.get("exercise_variant_mapping") or {}
        if not isinstance(stored_mapping, dict):
            stored_mapping = {}
        exercise_prompt = previous_exercise_prompt
        exercise_variant = previous_variant
        exercise_variant_mapping = dict(stored_mapping)
        guided_example = False
        final_answer_request = False

        if mode == "general":
            wants_reset = _looks_like_general_reset(message_text)
            is_new_exercise = _looks_like_exercise_request(message_text)
            if is_new_exercise:
                guided_example = True
                exercise_prompt = message_text
                exercise_variant, exercise_variant_mapping = _ensure_guided_example_variant(message_text)
                session["exercise_prompt"] = message_text.strip()
                session["exercise_variant"] = exercise_variant
                session["exercise_variant_mapping"] = dict(exercise_variant_mapping)
            elif wants_reset:
                exercise_prompt = ""
                exercise_variant = ""
                exercise_variant_mapping = {}
                session["exercise_prompt"] = ""
                session["exercise_variant"] = ""
                session["exercise_variant_mapping"] = {}
            else:
                exercise_prompt = previous_exercise_prompt
                exercise_variant = previous_variant
                exercise_variant_mapping = dict(stored_mapping)
                if exercise_prompt:
                    final_answer_request = _looks_like_final_answer_request(message_text)
            if wants_reset:
                final_answer_request = False
        else:
            exercise_prompt = ""
            exercise_variant = ""
            exercise_variant_mapping = {}
            session["exercise_prompt"] = ""
            session["exercise_variant"] = ""
            session["exercise_variant_mapping"] = {}

        context_items: List[Dict[str, Any]] = []
        resolved_unidad = data.unidad
        resolved_tema = data.tema
        resolved_leccion = data.leccion

        if mode == "leccion":
            if message_text:
                pu, pt, pl = _parse_structure_from_text(message_text)
                if resolved_unidad is None and pu is not None:
                    resolved_unidad = pu
                if resolved_tema is None and pt is not None:
                    resolved_tema = pt
                if resolved_leccion is None and pl is not None:
                    resolved_leccion = pl

            exact = _fetch_teoria_from_db(db, resolved_unidad, resolved_leccion, tema=resolved_tema)
            if not exact and message_text:
                ltxt = _parse_leccion_text(message_text)
                if ltxt and (resolved_unidad is not None):
                    try:
                        a_str, b_str = ltxt.split(".", 1)
                        exact = _fetch_teoria_from_db(db, resolved_unidad, int(b_str), tema=int(a_str))
                    except Exception:
                        pass
            if exact:
                context_items.append(exact)
            if not exact:
                q = (data.query or message_text).strip()
                if q:
                    context_items.extend(
                        _search_lessons(
                            db,
                            q,
                            resolved_unidad,
                            resolved_leccion,
                            limit=max(1, data.max_context or 1),
                        )
                    )
        else:
            exact = None

        base_system = compose_system_prompt()
        if mode == "general":
            system_msg = {
                "role": "system",
                "content": base_system + "\nEstas en modo preguntas abiertas: responde con explicaciones claras y no cites numeraciones de lecciones salvo que el estudiante lo pida.",
            }
        else:
            system_msg = {
                "role": "system",
                "content": base_system + "\nEstas en modo lecciones: prioriza el material de la base de datos si esta disponible.",
            }

        messages: List[Dict[str, str]] = [system_msg]
        if exercise_prompt and exercise_variant and not guided_example and not final_answer_request:
            followup_instruction = _compose_guided_example_followup_instruction(exercise_prompt, exercise_variant, exercise_variant_mapping)
            messages.append({"role": "system", "content": followup_instruction})
        if guided_example:
            messages.append({"role": "system", "content": _compose_guided_example_system_instruction(message_text)})
        elif final_answer_request:
            messages.append({"role": "system", "content": _compose_final_answer_system_instruction(exercise_prompt or message_text)})
        if mode == "leccion" and context_items and not data.solo_bd:
            ctx = "\n\n---\n\n".join(_build_context_snippet(it) for it in context_items)
            db_context_msg = {
                "role": "system",
                "content": "Usa el siguiente contexto de BD como base y completa con explicaciones claras.\n\n" + ctx,
            }
            messages.append(db_context_msg)

        if hist:
            messages.extend(hist)

        if guided_example:
            user_content = _compose_guided_example_user_prompt(exercise_prompt or message_text, exercise_variant, exercise_variant_mapping)
        elif final_answer_request:
            user_content = _compose_final_answer_user_prompt(exercise_prompt or message_text)
        else:
            if mode == "leccion" and context_items:
                user_content = f"Pregunta: {message_text}"
            elif exercise_prompt:
                consulta = (message_text or "").strip()
                lines = [
                    f"Ejercicio original del estudiante: \"{exercise_prompt}\".",
                    f"Consulta actual: \"{consulta}\".",
                    "Brinda orientaciones usando el ejemplo similar sin resolver el enunciado original."
                ]
                if exercise_variant:
                    lines.append(f"Ejemplo similar de referencia: \"{exercise_variant}\".")
                user_content = "\n".join(lines)
            else:
                user_content = message_text
        messages.append({"role": "user", "content": user_content})


        try:
            ai_text = chat_completion(messages)
        except Exception as exc:
            logger.warning("chat_completion fallo (modo=%s, contexto=%s): %s", mode, bool(context_items), exc)
            if mode == "leccion" and context_items:
                ai_text = _compose_context_answer(context_items)
            else:
                if guided_example:
                    ai_text = _compose_guided_example_fallback(message_text)
                elif final_answer_request:
                    ai_text = _compose_final_answer_fallback(exercise_prompt or message_text)
                else:
                    ai_text = _general_math_fallback(message_text)

        hist.append({"role": "user", "content": message_text})
        hist.append({"role": "assistant", "content": ai_text})

        session["last_mode"] = mode
        session["last_context"] = bool(context_items)
        return {
            "respuesta": ai_text,
            "usando_contexto": bool(context_items) and mode == "leccion",
            "contexto_items": [
                {"unidad": it.get("unidad"), "leccion": it.get("leccion"), "titulo": it.get("titulo")} for it in context_items
            ],
            "modo_usado": mode,
        }
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {e}")
