import io
import os
import re
from typing import Dict, Optional, List, Tuple

from pypdf import PdfReader

# Imports opcionales para OCR y render
try:
    import pypdfium2 as pdfium
except Exception:
    pdfium = None

try:
    import pytesseract
    from PIL import Image
except Exception:
    pytesseract = None
    Image = None

# Permitir configurar la ruta de tesseract.exe vía variable de entorno
if pytesseract is not None:
    _tcmd = os.getenv("TESSERACT_CMD")
    if _tcmd:
        try:
            pytesseract.pytesseract.tesseract_cmd = _tcmd
        except Exception:
            pass


def extract_text_from_pdf_bytes(data: bytes) -> str:
    """
    Extrae texto de un PDF a partir de bytes usando pypdf.
    """
    reader = PdfReader(io.BytesIO(data))
    partes = []
    for page in reader.pages:
        try:
            partes.append(page.extract_text() or "")
        except Exception:
            # Si alguna página falla, seguimos con el resto
            continue
    return "\n".join(partes)


def _ocr_text_from_pdf_bytes(data: bytes, dpi: int = 240, lang: Optional[str] = None) -> str:
    """
    Renderiza páginas del PDF a imágenes (vía pypdfium2) y hace OCR (pytesseract).
    Requiere tener instalados pypdfium2, pytesseract y Tesseract OCR en el sistema.
    """
    if pdfium is None or pytesseract is None:
        return ""
    try:
        scale = max(dpi / 72.0, 2.0)
        doc = pdfium.PdfDocument(io.BytesIO(data))
        textos = []
        for i in range(len(doc)):
            page = doc[i]
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil()
            # Para mejorar OCR, convertimos a escala de grises
            if pil.mode != "L":
                pil = pil.convert("L")
            txt = pytesseract.image_to_string(pil, lang=lang or os.getenv("PDF_OCR_LANG", "spa+eng"))
            if txt:
                textos.append(txt)
        return "\n".join(textos)
    except Exception:
        return ""


def extract_text_preferably(data: bytes, prefer_ocr: bool = False, lang: Optional[str] = None) -> str:
    """
    Extrae texto de un PDF. Si prefer_ocr es True o el texto directo es escaso,
    intenta OCR como fallback.
    """
    if prefer_ocr:
        txt = _ocr_text_from_pdf_bytes(data, lang=lang)
        if txt and len(txt.strip()) > 0:
            return txt
        # Si falló OCR, intenta texto directo
        return extract_text_from_pdf_bytes(data)

    # Primero intento directo
    txt = extract_text_from_pdf_bytes(data)
    if not txt or len(txt.strip()) < 50:
        # Fallback a OCR si hay poco texto (típico de escaneados)
        ocr_txt = _ocr_text_from_pdf_bytes(data, lang=lang)
        if ocr_txt and len(ocr_txt.strip()) > len(txt.strip() if txt else ""):
            return ocr_txt
    return txt


def split_sections_from_text(raw_text: str) -> Dict[str, str]:
    """
    Intenta segmentar el texto del PDF en secciones comunes:
    objetivo, teoria, formulas, actividades, paginas.

    Si no encuentra encabezados, devuelve todo en 'teoria'.
    """
    text = raw_text or ""
    if not text.strip():
        return {}

    # Normalizamos saltos de línea múltiples
    text = re.sub(r"\r\n?", "\n", text)

    # Marcadores aceptados para cada sección (case-insensitive)
    headers = {
        "objetivo": [r"^\s*objetivo\s*:?\s*$", r"^\s*objetivos\s*:?\s*$"],
        "teoria": [r"^\s*te(o|ó|\u00f3)ria\s*:?\s*$", r"^\s*contenido\s*:?\s*$"],
        "formulas": [r"^\s*f(ó|o|\u00f3)rmulas?\s*:?\s*$", r"^\s*formula(s)?\s*:?\s*$"],
        "actividades": [r"^\s*actividades?\s*:?\s*$", r"^\s*ejercicios?\s*:?\s*$"],
        "paginas": [r"^\s*p(á|a|\u00e1)ginas?\s*:?\s*$", r"^\s*pp\.?\s*$"],
    }

    # Preparamos índice de encabezados encontrados
    lines = text.split("\n")
    idx_marks = []  # (idx, key)

    def _matches_any(patterns, s):
        for pat in patterns:
            if re.search(pat, s.strip(), re.IGNORECASE):
                return True
        return False

    for i, line in enumerate(lines):
        for key, pats in headers.items():
            if _matches_any(pats, line):
                idx_marks.append((i, key))

    # Si no hay encabezados, todo va como teoría
    if not idx_marks:
        return {"teoria": text.strip()}

    # Ordenar y cerrar con fin de documento
    idx_marks.sort(key=lambda x: x[0])
    idx_marks.append((len(lines), "__END__"))

    out: Dict[str, str] = {}
    for (start_idx, key), (end_idx, _) in zip(idx_marks, idx_marks[1:]):
        if key == "__END__":
            continue
        chunk = "\n".join(lines[start_idx + 1 : end_idx]).strip()
        if chunk:
            # Si ya existe una sección con ese nombre, concatenamos
            prev = out.get(key, "")
            out[key] = (prev + ("\n\n" if prev else "") + chunk).strip()

    return out


def split_lessons_from_text(raw_text: str) -> List[Dict[str, str]]:
    """
    Divide un documento grande en lecciones detectando encabezados del tipo:
    - "Unidad 4"
    - "Lección 4.2 - Título de la lección" (guion, raya o dos puntos opcionales)

    Devuelve una lista de dicts: {"unidad": int|None, "leccion": str, "titulo": str, "contenido": str}
    La unidad queda como None si no se logró detectar, para que el caller decida.
    """
    if not raw_text:
        return []
    text = re.sub(r"\r\n?", "\n", raw_text)
    lines = text.split("\n")

    re_unidad = re.compile(r"^\s*unidad\s*(\d+|[IVXLCDM]+)\b", re.IGNORECASE)
    # Lección 4.2 - Título
    re_leccion = re.compile(r"^\s*lecci[oó]\s*n\s*([0-9]+(?:[\.-][0-9]+)?)\s*(?:[-–—:]\s*)?(.*)$", re.IGNORECASE)
    # Sinónimo: Tema/Clase/Sesión/Capítulo 4.2 - Título
    re_syn = re.compile(r"^\s*(tema|clase|sesi[oó]n|cap[ií]tulo)\s*([0-9]+(?:[\.-][0-9]+)?)\s*(?:[-–—:]\s*)?(.*)$", re.IGNORECASE)
    # Fallback: 4.2 Título (solo si ya conocemos unidad actual)
    re_num_title = re.compile(r"^\s*([0-9]+(?:[\.-][0-9]+)+)\s+(.+)$")

    current_unidad: Optional[int] = None
    current: Optional[Dict[str, Optional[str]]] = None
    buffer: List[str] = []
    out: List[Dict[str, str]] = []

    def _flush():
        nonlocal current, buffer
        if current is not None:
            contenido = "\n".join(buffer).strip()
            out.append({
                "unidad": current.get("unidad"),
                "leccion": current.get("leccion", ""),
                "titulo": current.get("titulo", "") or "",
                "contenido": contenido,
            })
        current = None
        buffer = []

    for ln in lines:
        m_u = re_unidad.search(ln)
        if m_u:
            try:
                val = m_u.group(1)
                if val.isdigit():
                    current_unidad = int(val)
                else:
                    # intentar romano simple (I..X)
                    roman_map = {"I":1,"V":5,"X":10,"L":50,"C":100,"D":500,"M":1000}
                    r = val.upper()
                    total = 0
                    prev = 0
                    for ch in reversed(r):
                        n = roman_map.get(ch, 0)
                        if n < prev:
                            total -= n
                        else:
                            total += n
                            prev = n
                    current_unidad = total or None
            except Exception:
                pass
            # línea de unidad por sí sola no fuerza flush
            # sigue al siguiente encabezado de lección
            continue

        m_l = re_leccion.search(ln) or re_syn.search(ln)
        if m_l:
            # flush de la lección previa
            _flush()
            if m_l.re is re_leccion:
                lec = m_l.group(1)
                tit = (m_l.group(2) or "").strip()
            else:
                lec = m_l.group(2)
                tit = (m_l.group(3) or "").strip()
            current = {"unidad": current_unidad, "leccion": lec, "titulo": tit}
            continue

        # Fallback: línea que empieza con número compuesto (4.2 ó 4-2) + título
        if current_unidad is not None:
            m_nt = re_num_title.search(ln)
            if m_nt:
                _flush()
                lec = m_nt.group(1).replace("-", ".")
                tit = (m_nt.group(2) or "").strip()
                current = {"unidad": current_unidad, "leccion": lec, "titulo": tit}
                continue

        # acumulamos contenido si hay lección abierta
        if current is not None:
            buffer.append(ln)

    # última
    _flush()

    # limpieza básica: eliminar entradas sin contenido
    out = [x for x in out if x.get("leccion") and (x.get("contenido") or "").strip()]
    return out
