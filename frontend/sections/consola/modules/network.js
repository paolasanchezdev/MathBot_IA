// modules/network.js
import { showTypingIndicator, hideTypingIndicator, renderMessage } from "./ui.js";
import { sendMessage } from "./chat.js";
import { getState } from "./storage.js";
import { updateStatus } from "./utils.js";

// Intenta inferir unidad y leccion desde el mensaje crudo para mejorar la busqueda en BD
function extractLessonHints(text) {
  const result = { unidad: null, tema: null, leccion: null, leccionText: null };
  if (!text || typeof text !== 'string') return result;
  const lower = text.toLowerCase();
  const pair = lower.match(/(\d{1,3})\s*[./-]\s*(\d{1,3})/);
  if (pair) {
    const unitPart = parseInt(pair[1], 10);
    const lessonPart = parseInt(pair[2], 10);
    if (!Number.isNaN(unitPart)) result.unidad = unitPart;
    if (!Number.isNaN(lessonPart)) result.leccion = lessonPart;
    if (!Number.isNaN(unitPart) && !Number.isNaN(lessonPart)) {
      result.leccionText = `${unitPart}.${lessonPart}`;
    }
  }
  const uniMatch = lower.match(/unidad\s+(\d{1,3})/);
  if (uniMatch) result.unidad = parseInt(uniMatch[1], 10);
  const lecMatch = lower.match(/lecci[o\u00f3]n\s+(\d{1,3}(?:[./-]\s*\d{1,3})?)/);
  if (lecMatch) {
    const raw = lecMatch[1].replace(/\s+/g, '');
    if (/[./-]/.test(raw)) {
      const parts = raw.split(/[./-]/).map(part => parseInt(part, 10));
      const [maybeUnit, maybeLesson] = parts;
      if (!Number.isNaN(maybeLesson)) {
        result.leccion = maybeLesson;
        if (!Number.isNaN(maybeUnit)) {
          // En el contexto de "leccion A.B de la unidad U", A corresponde a tema
          result.tema = maybeUnit;
          if (result.unidad === null) result.unidad = maybeUnit;
          result.leccionText = `${maybeUnit}.${maybeLesson}`;
        }
      }
    } else {
      const onlyLesson = parseInt(raw, 10);
      if (!Number.isNaN(onlyLesson)) {
        result.leccion = onlyLesson;
      }
    }
  }
  return result;
}

export async function sendQuestion(question, rawQuestion, mode = 'auto', chatId = null) {
  const currentChat = getState().currentChat;
  const targetChatId = chatId || (currentChat ? currentChat.id : null);

  if (!currentChat) return;
  const selectedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : 'auto';

  showTypingIndicator();

  try {
    const authRaw = localStorage.getItem('mb_auth');
    let userId = 'default';
    try { const a = JSON.parse(authRaw || 'null'); if (a && a.id) userId = a.id; } catch {}

    const hints = extractLessonHints(rawQuestion);
    const payload = {
      modo: selectedMode !== 'auto' ? selectedMode : undefined,
      mensaje: question,
      user_id: userId,
      max_context: 3,
      chat_id: targetChatId || undefined,
    };
    if (payload.chat_id === undefined) {
      delete payload.chat_id;
    }

    if (payload.modo === undefined) {
      delete payload.modo;
    }
    if (rawQuestion && rawQuestion.trim()) {
      payload.query = rawQuestion.trim();
    }
    if (Number.isInteger(hints.unidad)) {
      payload.unidad = hints.unidad;
    }
    if (Number.isInteger(hints.leccion)) {
      payload.leccion = hints.leccion;
    }
    if (Number.isInteger(hints.tema)) {
      payload.tema = hints.tema;
    }
    if (hints.leccionText) {
      payload.leccion_text = hints.leccionText;
    }

    const res = await fetch("http://127.0.0.1:8000/preguntar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    hideTypingIndicator();

    const contextItems = Array.isArray(data.contexto_items) ? data.contexto_items : [];
    const respuesta = data.respuesta || "Error: no se recibio respuesta.";
    if (contextItems.length && !data.needs_clarification) {
      const summaryLines = contextItems.map((it) => {
        const unidad = it?.unidad ?? '?';
        const leccion = it?.leccion ?? '?';
        const titulo = (it?.titulo || '').trim();
        return `- Unidad ${unidad} - Lecci\u00f3n ${leccion}${titulo ? ': ' + titulo : ''}`;
      }).join('\n');
      const contextText = `\U0001F4DA Contexto usado:
${summaryLines}`;
      sendMessage(currentChat.id, { sender: "ai", text: contextText });
      renderMessage({ sender: "ai", text: contextText });
    }

    // Guardar mensaje del bot en el chat
    sendMessage(currentChat.id, { sender: "ai", text: respuesta });

    // Renderizar el mensaje del bot en pantalla
    renderMessage({ sender: "ai", text: respuesta });

    if (data.needs_clarification) {
      const detailOptions = Array.isArray(data?.debug?.matches) && data.debug.matches.length ? data.debug.matches : contextItems;
      document.dispatchEvent(new CustomEvent('mathbot:clarification-needed', {
        detail: {
          options: detailOptions || [],
          lessonText: data?.debug?.ltxt || (contextItems?.[0]?.leccion ?? null),
          rawQuestion,
        },
      }));
    }

  } catch (err) {
    hideTypingIndicator();
    const errorMsg = "Error: no se pudo conectar con el servidor.";
    const timestamp = new Date().toISOString();
    sendMessage(currentChat.id, { sender: "ai", text: errorMsg, timestamp });
    renderMessage({ sender: "ai", text: errorMsg, timestamp });
    updateStatus("Desconectado", false);
  }
}
