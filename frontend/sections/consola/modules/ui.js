// modules/ui.js
import { getState, setCurrentChat, setChats } from "./storage.js";
import { deleteChat, renameChat } from "./chat.js";
import { typesetElement } from "../../../js/renderMath.js";

/* ==============================
   HELPER SCROLL
============================== */
function isScrolledToBottom(container) {
  return container.scrollHeight - container.scrollTop <= container.clientHeight + 5;
}

function scrollToBottomIfNeeded(container, smooth = true) {
  if (isScrolledToBottom(container)) {
    try {
      container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    } catch {
      container.scrollTop = container.scrollHeight;
    }
  }
}

/* ==============================
   SCROLL TO BOTTOM CONTROL
============================== */
let scrollBtn;
export function initScrollToBottom(){
  const page = document.getElementById("console-page");
  const output = document.getElementById("console-output");
  scrollBtn = document.getElementById("scroll-bottom-btn");
  if (!page || !output || !scrollBtn) return;

  function toggle(){
    const show = !isScrolledToBottom(page);
    scrollBtn.classList.toggle('show', show);
  }
  // solo escuchar el contenedor que realmente hace scroll
  page.addEventListener('scroll', toggle);
  scrollBtn.addEventListener('click', ()=>{
    try { page.scrollTo({ top: page.scrollHeight, behavior: 'smooth' }); }
    catch { page.scrollTop = page.scrollHeight; }
    toggle();
  });
  // Evitar solaparse con el botón enviar: colocar por encima del footer
  function recalcBottom(){
    try {
      const footer = document.querySelector('.console-footer');
      const gap = 14; // separación visual
      const h = (footer?.offsetHeight || 90) + gap;
      scrollBtn.style.bottom = h + 'px';
    } catch {}
  }
  recalcBottom();
  window.addEventListener('resize', recalcBottom);
  const input = document.getElementById('console-command');
  input?.addEventListener('input', recalcBottom);
  // initial
  toggle();
}

/* ==============================
   LISTADO DE CHATS
============================== */
export function renderChatList(chats) {
  const listEl = document.getElementById("chat-list");
  listEl.innerHTML = "";

  const src = Array.isArray(chats) ? chats : (getState().chats || []);
  const q = (document.getElementById('chat-search')?.value || '').toLowerCase().trim();
  const filtered = q
    ? src.filter(c => (c.name||'').toLowerCase().includes(q) || (c.messages?.[c.messages.length-1]?.text||'').toLowerCase().includes(q))
    : src;

  filtered.forEach(chat => {
    const li = document.createElement("li");
    li.dataset.id = chat.id;
    li.className = chat.id === getState().currentChat?.id ? "active" : "";

    const content = document.createElement('div');
    content.className = 'chat-content';
    const title = document.createElement('div');
    title.className = 'chat-title';
    title.textContent = chat.name;
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const last = chat.messages?.[chat.messages.length-1];
    const lastTime = last?.ts ? new Date(last.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (lastTime) {
      const timeEl = document.createElement('span');
      timeEl.textContent = lastTime;
      meta.appendChild(timeEl);
    }
    const preview = document.createElement('div');
    preview.className = 'chat-preview';
    preview.textContent = (last?.text || '').replace(/\s+/g,' ').slice(0,60);

    content.appendChild(title);
    if (lastTime) content.appendChild(meta);
    content.appendChild(preview);
    li.appendChild(content);

    content.addEventListener("click", () => {
      setCurrentChat(chat.id);
      renderChatList(getState().chats);
      renderChatOutput(getState().currentChat);
      updateChatTitle(chat.name);
    });

    // BotÃ³n renombrar
    const renameBtn = document.createElement("button");
    renameBtn.className = "chat-btn rename";
    renameBtn.title = "Renombrar chat";
    renameBtn.setAttribute('aria-label', 'Renombrar chat');
    renameBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M4 20h4l10.5-10.5a1.5 1.5 0 00-4.243-4.243L3.757 15.757A2 2 0 003 17.172V20z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    `;
    renameBtn.addEventListener("click", e => {
      e.stopPropagation();
      const newName = prompt("Nuevo nombre del chat:", chat.name);
      if (!newName) return;
      renameChat(chat.id, newName);
      renderChatList(getState().chats);
      updateChatTitle(getState().currentChat?.name);
    });
    li.appendChild(renameBtn);

    // BotÃ³n eliminar
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "chat-btn delete";
    deleteBtn.title = "Eliminar chat";
    deleteBtn.setAttribute('aria-label', 'Eliminar chat');
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M3 6h18M8 6v12a2 2 0 002 2h4a2 2 0 002-2V6M9 6l1-2h4l1 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    deleteBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (!confirm(`Â¿Eliminar chat "${chat.name}"?`)) return;
      const remainingChats = deleteChat(chat.id);
      setChats(remainingChats);
      renderChatList(remainingChats);

      if (remainingChats.length > 0) {
        setCurrentChat(remainingChats[0].id);
        renderChatOutput(getState().currentChat);
        updateChatTitle(getState().currentChat.name);
      } else {
        renderChatOutput(null);
        updateChatTitle(null);
      }
    });
    li.appendChild(deleteBtn);

    listEl.appendChild(li);
  });
}

/* ==============================
   RENDER DE MENSAJES
============================== */
export function renderChatOutput(chat) {
  const outputEl = document.getElementById("console-output");
  const pageEl = document.getElementById("console-page");
  outputEl.innerHTML = "";

  if (!chat || !chat.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u03A3';

    const title = document.createElement('h2');
    title.className = 'empty-state-title';
    title.textContent = '\u00BFQu\u00E9 deseas aprender?';

    empty.appendChild(icon);
    empty.appendChild(title);
    outputEl.appendChild(empty);
    return;
  }

  // Insertar separadores de fecha y renderizar mensajes
  let lastDay = null;
  chat.messages.forEach(msg => {
    const ts = msg.ts ? new Date(msg.ts) : new Date();
    const dayKey = ts.toDateString();
    if (dayKey !== lastDay) {
      lastDay = dayKey;
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.textContent = formatDateLabel(ts);
      outputEl.appendChild(sep);
    }
    renderMessage(msg);
  });

  scrollToBottomIfNeeded(pageEl);
  typesetElement(outputEl).then(() => scrollToBottomIfNeeded(pageEl));
  // update scroll button state if exists
  if (scrollBtn) {
    const show = !isScrolledToBottom(pageEl);
    scrollBtn.classList.toggle('show', show);
  }
}

/* ==============================
   ACTUALIZAR TITULO
============================== */
export function updateChatTitle(name) {
  document.getElementById("current-chat-title").textContent =
    name || "Selecciona un chat";
}

/* ==============================
   INDICADOR DE ESCRIBIENDO
============================== */
export function showTypingIndicator() {
  hideTypingIndicator();
  const output = document.getElementById("console-output");
  const page = document.getElementById("console-page");

  const typingDiv = document.createElement("div");
  typingDiv.id = "typing-indicator";
  typingDiv.className = "chat-bubble typing-indicator";
  typingDiv.innerHTML = `
    Pensando para darte la mejor respuesta...
    <div class="dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
  output.appendChild(typingDiv);
  // desplazamiento controlado sobre el contenedor con scroll
  scrollToBottomIfNeeded(page);
}

export function hideTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) indicator.remove();
}

/* ==============================
   RENDER DE UN MENSAJE INDIVIDUAL
============================== */
export function renderMessage(msg) {
  const output = document.getElementById("console-output");
  const page = document.getElementById("console-page");
  const atBottom = isScrolledToBottom(page);

  // limpiar placeholders (bienvenida/sugerencias antiguas)
  try {
    const empty = output.querySelector('.empty-msg');
    if (empty) empty.remove();
    const sugg = output.querySelector('.suggestions');
    if (sugg) sugg.remove();
  } catch {}

  const wrapper = document.createElement("div");
  wrapper.className = `message-row message ${msg.sender}`;

  const avatarDiv = document.createElement("div");
  avatarDiv.className = "avatar";
  avatarDiv.textContent = msg.avatar || (msg.sender === "user" ? "🧑" : "🤖");
  wrapper.appendChild(avatarDiv);

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${msg.sender}`;

  const contentDiv = document.createElement("div");
  contentDiv.innerHTML = marked.parse(msg.text);
  bubble.appendChild(contentDiv);

  // Contenedor para botones debajo del mensaje
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "message-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn tooltip";
  copyBtn.textContent = "📋";
  
  const tooltipSpan = document.createElement("span");
  tooltipSpan.className = "tooltiptext";
  tooltipSpan.textContent = "Copiar mensaje";
  copyBtn.appendChild(tooltipSpan);

  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(msg.text);
    const tip = tooltipSpan();
    if (tip) {
      tip.textContent = "Â¡Copiado!";
      setTimeout(() => (tip.textContent = "Copiar mensaje"), 1500);
    }
  });

  // Fijar comportamiento de copia con tooltip (fase de captura para evitar listeners defectuosos)
  copyBtn.addEventListener('click', (e) => {
    try {
      e.stopImmediatePropagation();
      navigator.clipboard.writeText(msg.text);
      const tip = copyBtn.querySelector('.tooltiptext');
      if (tip) {
        tip.textContent = '¡Copiado!';
        setTimeout(() => (tip.textContent = 'Copiar mensaje'), 1500);
      }
    } catch {}
  }, true);

  actionsDiv.appendChild(copyBtn);
  // Acciones útiles para estudiantes
  const stepBtn = document.createElement('button');
  stepBtn.className = 'copy-btn tooltip';
  stepBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 12h14M5 6h10M5 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const stepTip = document.createElement('span'); stepTip.className = 'tooltiptext'; stepTip.textContent = 'Pedir paso a paso'; stepBtn.appendChild(stepTip);
  stepBtn.addEventListener('click', () => {
    const input = document.getElementById('console-command');
    input.value = 'Explica paso a paso lo anterior.';
    input.focus();
  });

  const simplerBtn = document.createElement('button');
  simplerBtn.className = 'copy-btn tooltip';
  simplerBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 12h16M4 12s2-6 8-6 8 6 8 6-2 6-8 6-8-6-8-6z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const simplerTip = document.createElement('span'); simplerTip.className = 'tooltiptext'; simplerTip.textContent = 'Explicación más simple'; simplerBtn.appendChild(simplerTip);
  simplerBtn.addEventListener('click', () => {
    const input = document.getElementById('console-command');
    input.value = 'Explica lo anterior con lenguaje sencillo y con una analogía.';
    input.focus();
  });

  const examplesBtn = document.createElement('button');
  examplesBtn.className = 'copy-btn tooltip';
  examplesBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const examplesTip = document.createElement('span'); examplesTip.className = 'tooltiptext'; examplesTip.textContent = 'Pedir más ejemplos'; examplesBtn.appendChild(examplesTip);
  examplesBtn.addEventListener('click', () => {
    const input = document.getElementById('console-command');
    input.value = 'Dame 2-3 ejemplos adicionales similares a lo anterior.';
    input.focus();
  });

  actionsDiv.appendChild(stepBtn);
  actionsDiv.appendChild(simplerBtn);
  actionsDiv.appendChild(examplesBtn);
  bubble.appendChild(actionsDiv);

  wrapper.appendChild(bubble);
  output.appendChild(wrapper);

  typesetElement(bubble).then(() => {
    if (atBottom) {
      try { page.scrollTo({ top: page.scrollHeight, behavior: 'auto' }); }
      catch { page.scrollTop = page.scrollHeight; }
    }
  });
}

/* ==============================
   SIMULACIÃ“N BOT ESCRIBIENDO LETRA A LETRA
============================== */
export async function simulateBotTyping(fullText, speed = 25) {
  showTypingIndicator();

  const output = document.getElementById("console-output");
  const page = document.getElementById("console-page");
  const msgDiv = document.createElement("div");
  msgDiv.className = "chat-bubble bot message";
  msgDiv.style.position = "relative";
  output.appendChild(msgDiv);

  const atBottom = isScrolledToBottom(page);

  await new Promise(r => setTimeout(r, 500));

  for (let i = 0; i <= fullText.length; i++) {
    msgDiv.innerHTML = marked.parse(fullText.substring(0, i));
    if (atBottom) {
      try { page.scrollTo({ top: page.scrollHeight, behavior: 'auto' }); }
      catch { page.scrollTop = page.scrollHeight; }
    }
    await new Promise(r => setTimeout(r, speed));
  }

  hideTypingIndicator();

  typesetElement(msgDiv).then(() => {
    if (atBottom) {
      try { page.scrollTo({ top: page.scrollHeight, behavior: 'auto' }); }
      catch { page.scrollTop = page.scrollHeight; }
    }
  });
}

/* ==============================
   SIMULAR RESPUESTA DEL BOT
============================== */
export async function simulateBotResponse(text) {
  await simulateBotTyping(text);
}

/* ==============================
   BOT REPLY PARA USO
============================== */
export async function botReply(text) {
  await simulateBotTyping(text);
}

/* ==============================
   UTILS
============================== */
function formatDateLabel(d) {
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  if (sameDay(d, today)) return 'Hoy';
  if (sameDay(d, yest)) return 'Ayer';
  return d.toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
}

