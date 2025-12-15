// modules/utils.js
export function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  const sun = () => `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M5 19l1.5-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  const moon = () => `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  `;

  let darkMode = localStorage.getItem("mathbot_dark_mode") === "true";
  document.body.classList.toggle("dark", darkMode);
  btn.innerHTML = darkMode ? moon() : sun();

  btn.addEventListener("click", () => {
    darkMode = !darkMode;
    document.body.classList.toggle("dark", darkMode);
    btn.innerHTML = darkMode ? moon() : sun();
    localStorage.setItem("mathbot_dark_mode", darkMode);
  });
}

export function generateId() {
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).substr(2, 9);
}

export function scrollToBottom(container, smooth = true) {
  container.scrollTo({
    top: container.scrollHeight,
    behavior: smooth ? "smooth" : "auto"
  });
}

export function updateStatus(text, connected = false) {
  const statusEl = document.getElementById("console-status");
  if (!statusEl) return;

  statusEl.textContent = text;
  statusEl.className = connected
    ? "console-status connected"
    : "console-status disconnected";
}

