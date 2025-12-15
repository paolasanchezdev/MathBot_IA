// modules/consola.js
import { getState, loadState, setCurrentChat, getChats } from "./storage.js";
import { renderChatList, renderMessage, renderChatOutput, updateChatTitle, showTypingIndicator, hideTypingIndicator, initScrollToBottom } from "./ui.js";
import { addChat, sendMessage, clearMessages } from "./chat.js";
import { sendQuestion } from "./network.js";
import { initThemeToggle, updateStatus } from "./utils.js";

const inputEl = document.getElementById("console-command");
const sendBtn = document.getElementById("send-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const chatListEl = document.getElementById("chat-list");
const outputEl = document.getElementById("console-output");
const dashboardBtn = document.getElementById("btn-dashboard");
const searchInput = document.getElementById("chat-search");
const clearBtn = document.getElementById("clear-chat-btn");
const summarizeBtn = document.getElementById("summarize-chat-btn");
const helpToggleBtn = document.getElementById("help-toggle");
const inputHint = document.getElementById("input-hint");
// Student options
const optSteps = document.getElementById("opt-steps");
const optSimple = document.getElementById("opt-simple");
const optExamples = document.getElementById("opt-examples");
const optVerify = document.getElementById("opt-verify");
const modeRadios = document.querySelectorAll('input[name="chat-mode"]');

dashboardBtn.addEventListener("click", () => {
  window.location.href = "../dashboard/dashboard.html";
});

// ==============================
// Enviar mensaje
// ==============================
function composeQuestion(base) {
  let q = base;
  const prefs = [];
  if (optSteps?.checked) prefs.push("explica paso a paso");
  if (optSimple?.checked) prefs.push("usa lenguaje sencillo, apto para un estudiante");
  if (optExamples?.checked) prefs.push("incluye 1-2 ejemplos resueltos similares");
  if (optVerify?.checked) prefs.push("si hay solución del usuario, verifica y corrige con explicación");
  if (prefs.length) {
    q = `${base}\n\nPor favor: ${prefs.join('; ')}.`;
  }
  return q;
}

function getSelectedMode() {
  const radios = Array.from(modeRadios || []);
  const checked = radios.find(r => r && r.checked);
  return checked ? checked.value : "auto";
}

async function handleSendMessage() {
  const questionRaw = inputEl.value.trim();
  const question = composeQuestion(questionRaw);
  const mode = getSelectedMode();
  if (!question || !getState().currentChat) return;

  const currentId = getState().currentChat.id;

  // Guardar mensaje del usuario
  sendMessage(currentId, { sender: "user", text: question });
  renderMessage({ sender: "user", text: question });

  inputEl.value = "";
  try { inputEl.style.height = 'auto'; } catch {}
  inputEl.focus();

  showTypingIndicator();
  try {
    await sendQuestion(question, questionRaw, mode, currentId);
  } catch (err) {
    sendMessage(currentId, { sender: "ai", text: "Error: no se pudo conectar con el servidor." });
    renderMessage({ sender: "ai", text: "Error: no se pudo conectar con el servidor." });
    updateStatus("Desconectado", false);
  }
  hideTypingIndicator();
}

function doSummarizeChat() {
  const chat = getState().currentChat;
  if (!chat) return;
  inputEl.value = "Resúmeme lo discutido en este chat en 5 puntos clave y destaca fórmulas importantes, si aplica.";
  handleSendMessage();
}

// ==============================
// Nuevo chat
// ==============================
function handleNewChat() {
  const name = prompt("Nombre del nuevo chat:");
  if (!name) return;

  const id = addChat(name);
  setCurrentChat(id);
  renderChatList(getChats());
  updateChatTitle(name);

  inputEl.disabled = false;
  sendBtn.disabled = false;
  inputEl.focus();
  renderChatOutput(getState().currentChat);
}

// ==============================
// Seleccionar chat desde la lista
// ==============================
function handleChatSelection(e) {
  const li = e.target.closest("li");
  if (!li || !li.dataset.id) return;
  const chatId = li.dataset.id;
  setCurrentChat(chatId);

  renderChatList(getChats());
  updateChatTitle(getState().currentChat.name);

  outputEl.innerHTML = "";
  const chat = getState().currentChat;
  if (chat && chat.messages.length) {
    chat.messages.forEach(msg => renderMessage(msg));
  } else {
    renderChatOutput(chat);
  }
}

// ==============================
// Inicialización
// ==============================
function init() {
  loadState();
  const { chats, currentChat } = getState();

  if (chats.length === 0) {
    const id = addChat("Chat de ejemplo");
    setCurrentChat(id);
  } else if (currentChat) {
    setCurrentChat(currentChat.id);
  }

  renderChatList(getChats());
  updateChatTitle(getState().currentChat?.name || null);

  const chat = getState().currentChat;
  if (chat && chat.messages.length) {
    chat.messages.forEach(msg => renderMessage(msg));
  } else {
    renderChatOutput(chat);
  }

  updateStatus("Conectado", true);

  inputEl.disabled = false;
  sendBtn.disabled = false;
  try { inputEl.style.height = 'auto'; } catch {}

  sendBtn.addEventListener("click", handleSendMessage);
  inputEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  const autoResize = () => {
    try {
      inputEl.style.height = 'auto';
      const max = 220;
      inputEl.style.height = Math.min(inputEl.scrollHeight, max) + 'px';
    } catch {}
  };
  inputEl.addEventListener('input', autoResize);
  newChatBtn.addEventListener("click", handleNewChat);

  if (helpToggleBtn && inputHint) {
    // Corrige y mejora el contenido de la sugerencia (usa <code> para que no lo procese MathJax)
    try {
      inputHint.innerHTML = 'Sugerencia: Enter envía, Shift+Enter hace salto de línea. Para fórmulas usa <code>$...$</code> o <code>\\( ... \\)</code>.';
    } catch {}
    helpToggleBtn.addEventListener("click", () => {
      const visible = inputHint.style.display !== 'none';
      inputHint.style.display = visible ? 'none' : 'block';
    });
  }

  // Normaliza textos con acentos en la toolbar por si el HTML viene mal codificado
  try {
    const relabel = (id, text) => {
      const cb = document.getElementById(id);
      if (!cb) return;
      const label = cb.closest('label');
      if (!label) return;
      label.innerHTML = '';
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + text));
    };
    relabel('opt-simple', 'Explicación simple');
    relabel('opt-verify', 'Verificar solución');
  } catch {}
  if (summarizeBtn) {
    summarizeBtn.addEventListener("click", doSummarizeChat);
  }

  // Filtro de chats
  if (searchInput) {
    const doFilter = () => {
      const q = (searchInput.value || '').toLowerCase();
      const src = getChats();
      const filtered = q
        ? src.filter(c => (c.name||'').toLowerCase().includes(q) || (c.messages?.[c.messages.length-1]?.text||'').toLowerCase().includes(q))
        : src;
      renderChatList(filtered);
    };
    searchInput.addEventListener('input', doFilter);
  }

  // Limpiar chat actual
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const current = getState().currentChat;
      if (!current) return;
      if (!confirm("¿Limpiar todos los mensajes de este chat?")) return;
      clearMessages(current.id);
      renderChatList(getChats());
      renderChatOutput(getState().currentChat);
    });
  }

  chatListEl.addEventListener("click", handleChatSelection);

  initThemeToggle();
  initScrollToBottom();
}
document.addEventListener('mathbot:clarification-needed', (event) => {
  const detail = event?.detail || {};
  const lessonText = detail.lessonText;
  const baseQuestion = (detail.rawQuestion || '').trim();
  if (typeof updateStatus === 'function') {
    updateStatus('Especifica la unidad exacta para esa lecci\u00f3n', true);
  }
  if (!inputEl) return;
  const unitPrompt = lessonText ? `Unidad ___ (lecci\u00f3n ${lessonText})` : 'Unidad ___';
  const composed = baseQuestion ? `${baseQuestion}
${unitPrompt}` : unitPrompt;
  inputEl.value = composed.trim();
  inputEl.focus();
});

init();

