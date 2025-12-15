// =============================
// DASHBOARD JS (Adaptado SPA)
// =============================

// Estado global
const teacherRoles = new Set(['maestro', 'maestra', 'docente', 'profesor', 'profesora', 'teacher']);
const state = {
  theme: (window.MathBotTheme && window.MathBotTheme.getTheme()) || document.documentElement.getAttribute("data-theme") || "light",
  currentView: localStorage.getItem("currentView") || "dashboard",
  user: {
    name: "Paola",
    level: "Nivel 1° Año de Bachillerato",
  },
  stats: {
    questions: 124,
    minutes: 225,
    progress: 65,
    lessonsCompleted: "8/12",
    points: 450,
    lastAchievement: 'Maestro de fracciones',
  },
};
const sectionLoader = {
  cache: new Map(),
  controller: null,
  current: null,
  scriptVersions: {
    lessons: '20250921b',
    profile: '20251001a',
  },
  labels: {
    dashboard: 'inicio',
    lessons: 'lecciones',
    achievements: 'logros',
    stats: 'estadísticas',
    settings: 'configuración',
    games: 'mini juegos',
    profile: 'perfil',
  },
};

const sectionInitMap = {
  lessons: 'initLessonsSection',
  settings: 'initSettingsSection',
  games: 'initGamesSection',
  profile: 'initProfileSection',
  achievements: 'initAchievementsSection',
  stats: 'initStatsSection',
};


// =============================
// INICIO
// =============================
document.addEventListener("DOMContentLoaded", () => {
  // Guard de autenticación
  const auth = getAuth();
  if (!auth) {
    // Si no hay sesion, redirige al login
    window.location.replace('../auth/login.html');
    return;
  }

  const role = String(auth.user?.rol || '').toLowerCase();
  if (teacherRoles.has(role)) {
    window.location.replace('../teacher/panel.html');
    return;
  }

  // Actualiza nombre en estado para plantillas (acepta formato nuevo)
  try {
    const nombre = (auth.user && (auth.user.nombre || auth.user.name)) || auth.name;
    if (nombre) state.user.name = nombre;
    const nivel = (auth.alumno && auth.alumno.nivel) || auth.level;
    if (nivel) state.user.level = nivel;
  } catch {}

  initTheme();
  renderUser();
  renderStats();
  initCharts();
  initMenu();
  if (window.MathBotProgress && typeof window.MathBotProgress.subscribe === 'function') {
    window.MathBotProgress.subscribe(() => renderStats());
  }
  if (window.MathBotLessons && typeof window.MathBotLessons.ready === 'function') {
    window.MathBotLessons.ready().then(() => renderStats()).catch(() => {});
  }
});

function getAuth() {
  try {
    const raw = localStorage.getItem("mb_auth");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const hasId = !!((obj && obj.user && obj.user.id) || obj?.id);
    const hasToken = !!(obj && (obj.token || obj.access_token));
    if (hasId && hasToken) return obj;
  } catch {}
  return null;
}

function renderUser() {
  const el = document.getElementById("user-first-name");
  if (el) el.textContent = state.user.name;
  const lvl = document.getElementById("user-level");
  if (lvl) lvl.textContent = state.user.level || '';
}

// =============================
// TEMA (light / dark)
// =============================
function initTheme() {
  const btn = document.getElementById("theme-toggle");
  const themeAPI = window.MathBotTheme;

  const updateButton = (theme) => {
    const normalized = theme === "dark" ? "dark" : "light";
    state.theme = normalized;
    if (btn) {
      btn.textContent = normalized === "dark" ? "☀️ Tema claro" : "🌙 Tema oscuro";
      btn.setAttribute('aria-pressed', String(normalized === "dark"));
    }
    updateChartsTheme();
  };

  if (themeAPI && typeof themeAPI.getTheme === 'function') {
    updateButton(themeAPI.getTheme());
    document.documentElement.addEventListener('themechange', (ev) => updateButton(ev.detail.theme));
    btn?.addEventListener("click", () => {
      const next = themeAPI.getTheme() === "dark" ? "light" : "dark";
      themeAPI.setTheme(next);
    });
  } else {
    applyTheme(state.theme);
    updateButton(state.theme);
    btn?.addEventListener("click", () => {
      const next = state.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      updateButton(next);
    });
  }
}

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  if (window.MathBotTheme && typeof window.MathBotTheme.applyTheme === 'function') {
    window.MathBotTheme.applyTheme(normalized);
  } else {
    document.body.classList.toggle("dark", normalized === "dark");
  }
}

// =============================
// ESTADÍSTICAS
// =============================
function renderStats() {
  if (window.MathBotProgress && typeof window.MathBotProgress.snapshot === 'function') {
    try {
      const snapshot = window.MathBotProgress.snapshot();
      const lessons = window.MathBotLessons && typeof window.MathBotLessons.getLessons === 'function'
        ? window.MathBotLessons.getLessons() || []
        : [];
      const completed = snapshot.totals?.lessonsCompleted || 0;
      const total = lessons.length || snapshot.totals?.lessons || 0;
      const progressPct = total ? Math.min(100, (completed / total) * 100) : 0;
      const minutesCompleted = snapshot.history.filter(item => item.type === 'completed').length * 8;
      const minutes = minutesCompleted || completed * 6;
      const points = completed * 50;
      const lastAchievement = completed >= 1 ? 'Primer paso logrado' : 'Aun sin logros';

      document.getElementById('stat-questions').textContent = completed * 10;
      document.getElementById('stat-minutes').textContent = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
      document.getElementById('stat-progress').style.width = `${progressPct.toFixed(2)}%`;
      document.getElementById('stat-progress-label').textContent = `${Math.round(progressPct)}%`;
      document.getElementById('stat-lessons').textContent = total ? `${completed}/${total}` : `${completed}`;
      const pointCard = document.querySelector('#section-content .stat:nth-child(5) .big');
      if (pointCard) pointCard.textContent = `Puntos ${points}`;
      const achievementCard = document.querySelector('#section-content .stat:nth-child(6) p');
      if (achievementCard) achievementCard.textContent = `Logro "${lastAchievement}"`;
      return;
    } catch (err) {
      console.warn('renderStats dynamic fallback', err);
    }
  }

  const { questions, minutes, progress, lessonsCompleted, points, lastAchievement } = state.stats;
  document.getElementById('stat-questions').textContent = questions;
  document.getElementById('stat-minutes').textContent = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  document.getElementById('stat-progress').style.width = `${progress}%`;
  document.getElementById('stat-progress-label').textContent = `${progress}%`;
  document.getElementById('stat-lessons').textContent = lessonsCompleted;
  const pointCard = document.querySelector('#section-content .stat:nth-child(5) .big');
  if (pointCard) pointCard.textContent = `Puntos ${points}`;
  const achievementCard = document.querySelector('#section-content .stat:nth-child(6) p');
  if (achievementCard) achievementCard.textContent = `Logro "${lastAchievement}"`;
}
// =============================
// Utilidades CSS variables
// =============================
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function hexToRgba(hex, alpha = 1) {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (h.length === 6) {
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // fallback
  return hex;
}

// =============================
// GRÁFICAS (colores desde CSS vars)
// =============================
const charts = { week: null, areas: null };

function initCharts() {
  const weekCanvas = document.getElementById("chart-week");
  const areasCanvas = document.getElementById("chart-areas");

  [weekCanvas, areasCanvas].forEach(c => { if (c?.parentElement) c.parentElement.style.maxHeight = "300px"; });

  const rosa = cssVar('--rosa') || '#ff6fb5';
  const rojo = cssVar('--rojo') || '#ff3366';
  const naranja = cssVar('--naranja') || '#ff914d';
  const violeta = cssVar('--violeta') || '#9c27b0';
  const muted = cssVar('--muted') || '#775f72';
  const line = cssVar('--line') || '#f2d6cf';

  if (weekCanvas) {
    charts.week = new Chart(weekCanvas, {
      type: "line",
      data: {
        labels: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
        datasets: [{
          label: "Progreso semanal",
          data: [10, 15, 12, 20, 18, 22, 25],
          borderColor: rosa,
          backgroundColor: hexToRgba(rosa, 0.22),
          fill: true,
          tension: 0.4,
          borderWidth: 2
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: muted }, grid: { color: hexToRgba(line, 0.6) } },
          y: { beginAtZero: true, max: 30, ticks: { color: muted }, grid: { color: hexToRgba(line, 0.6) } }
        }
      },
    });
  }

  if (areasCanvas) {
    charts.areas = new Chart(areasCanvas, {
      type: "bar",
      data: {
        labels: ["Álgebra", "Geometría", "Cálculo"],
        datasets: [{
          label: "Horas de estudio",
          data: [5, 3, 2],
          backgroundColor: [rojo, naranja, violeta],
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: muted }, grid: { color: hexToRgba(line, 0.6) } },
          y: { beginAtZero: true, ticks: { color: muted }, grid: { color: hexToRgba(line, 0.6) } }
        }
      },
    });
  }
}

function updateChartsTheme() {
  const muted = cssVar('--muted') || '#775f72';
  const line = cssVar('--line') || '#f2d6cf';
  // actualizar colores de ejes y grids
  if (charts.week) {
    charts.week.options.scales.x.ticks.color = muted;
    charts.week.options.scales.x.grid.color = hexToRgba(line, 0.6);
    charts.week.options.scales.y.ticks.color = muted;
    charts.week.options.scales.y.grid.color = hexToRgba(line, 0.6);
    charts.week.update();
  }
  if (charts.areas) {
    charts.areas.options.scales.x.ticks.color = muted;
    charts.areas.options.scales.x.grid.color = hexToRgba(line, 0.6);
    charts.areas.options.scales.y.ticks.color = muted;
    charts.areas.options.scales.y.grid.color = hexToRgba(line, 0.6);
    charts.areas.update();
  }
}

// =============================
// MENÚ SPA
// =============================
function initMenu() {
  ensureProfileLink();
  ensureGamesLink();

  const links = document.querySelectorAll(".menu a");
  links.forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      loadSection(link.dataset.section);
    });
  });

  const initial = state.currentView || "dashboard";
  loadSection(initial);
}

function ensureGamesLink() {
  const menuUl = document.querySelector('.menu ul');
  if (!menuUl) return;
  const exists = !!menuUl.querySelector('[data-section="games"]');
  if (exists) return;
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = '#';
  a.dataset.section = 'games';
  a.textContent = 'Mini juegos';
  li.appendChild(a);
  // Insert after lessons if possible
  const lessonsLi = menuUl.querySelector('[data-section="lessons"]')?.parentElement;
  if (lessonsLi && lessonsLi.nextSibling) {
    menuUl.insertBefore(li, lessonsLi.nextSibling);
  } else {
    menuUl.appendChild(li);
  }
}

function ensureProfileLink() {
  const menuUl = document.querySelector('.menu ul');
  if (!menuUl) return;
  const exists = !!menuUl.querySelector('[data-section="profile"]');
  if (exists) return;
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = '#';
  a.dataset.section = 'profile';
  a.textContent = 'Perfil';
  li.appendChild(a);
  const settingsLi = menuUl.querySelector('[data-section="settings"]')?.parentElement;
  if (settingsLi && settingsLi.nextSibling) {
    menuUl.insertBefore(li, settingsLi.nextSibling);
  } else {
    menuUl.appendChild(li);
  }
}


function showSection(sectionId) {
  const sections = document.querySelectorAll("#section-content section");

  sections.forEach(s => {
    if (s.id === sectionId) {
      s.hidden = false;
      s.classList.add("active-section");
    } else {
      s.hidden = true;
      s.classList.remove("active-section");
    }
  });
}

function humanizeSection(section) {
  return sectionLoader.labels[section] || section;
}

function setMenuActive(section) {
  document.querySelectorAll(".menu a").forEach(link => {
    link.classList.toggle("active", link.dataset.section === section);
  });
}

function showSectionLoading(container, section) {
  const label = humanizeSection(section);
  container.innerHTML = `
    <div class="section-loading" data-section="${section}">
      <div class="spinner" aria-hidden="true"></div>
      <p>Cargando ${label}...</p>
    </div>`;
}

function showSectionError(container, section, retry) {
  const label = humanizeSection(section);
  container.innerHTML = `
    <div class="section-error">
      <p>No se pudo cargar la sección de ${label}. Revisa tu conexión e inténtalo de nuevo.</p>
      <button type="button" class="btn btn-ghost" data-action="retry-section">Reintentar</button>
    </div>`;
  const btn = container.querySelector('[data-action="retry-section"]');
  if (btn) {
    btn.addEventListener('click', () => retry());
  }
}

function ensureSectionScript(section) {
  return new Promise(resolve => {
    const selector = `script[data-section-script="${section}"]`;
    const version = sectionLoader.scriptVersions[section] || '';
    const suffix = version ? (version.startsWith('?') ? version : `?v=${version}`) : '';
    const existing = document.querySelector(selector);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => resolve(), { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.dataset.sectionScript = section;
    script.src = `../${section}/${section}.js${suffix}`;
    script.defer = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', event => {
      console.error(`No se pudo cargar el script para la sección ${section}`, event);
      resolve();
    }, { once: true });
    document.body.appendChild(script);
  });
}

function callSectionInit(section) {
  const fnName = sectionInitMap[section];
  if (!fnName) return;
  const fn = window[fnName];
  if (typeof fn === 'function') {
    try {
      fn();
    } catch (err) {
      console.error(`Error al inicializar la sección ${section}`, err);
    }
  }
}

async function loadSection(section) {
  const container = document.getElementById("section-content");
  if (!container || !section) return;

  sectionLoader.current = section;
  state.currentView = section;
  localStorage.setItem("currentView", section);
  setMenuActive(section);

  if (sectionLoader.controller) {
    try {
      sectionLoader.controller.abort();
    } catch (err) {
      console.warn('loadSection abort', err);
    }
  }
  sectionLoader.controller = null;

  if (section === "dashboard") {
    container.innerHTML = `
<section id="dashboard" class="fade-in active-section">
  <h2>Hola, <span id="user-first-name">${state.user.name}</span> 👋</h2>
  <div class="welcome-meta">
    <span class="pill" id="user-level">${state.user.level}</span>
  </div>
  <p>Bienvenida a tu panel de estudiante. Aquí puedes ver tu progreso y estadísticas recientes.</p>

  <!-- Acciones rápidas -->
  <div class="quick-actions">
    <a href="../consola/consola.html" class="btn btn-primary">💬 Abrir Consola</a>
    <button class="btn btn-ghost" data-action="continue-lesson">▶ Continuar Lección</button>
    <button class="btn btn-ghost" data-action="new-lesson">➕ Nueva lección</button>
    <button class="btn btn-ghost" data-action="view-ranking">🏅 Ver Ranking</button>
  </div>

  <!-- Estadísticas rápidas -->
  <div class="cards-grid" style="margin-top: 2rem;">
    <div class="card stat">
      <h3>Preguntas realizadas</h3>
      <p class="big" id="stat-questions">${state.stats.questions}</p>
    </div>
    <div class="card stat">
      <h3>Tiempo de estudio</h3>
      <p class="big" id="stat-minutes"></p>
    </div>
    <div class="card stat progress-card">
      <h3>Avance total</h3>
      <div class="progress">
        <div class="progress-bar" id="stat-progress"></div>
      </div>
      <p class="small" id="stat-progress-label"></p>
    </div>
    <div class="card stat">
      <h3>Lecciones completadas</h3>
      <p class="big" id="stat-lessons">${state.stats.lessonsCompleted}</p>
    </div>
    <div class="card stat">
      <h3>Puntos</h3>
      <p class="big">⭐ ${state.stats.points}</p>
    </div>
    <div class="card stat">
      <h3>Último logro</h3>
      <p>🏆 "${state.stats.lastAchievement}"</p>
    </div>
  </div>

  <!-- Gráficas -->
  <div class="cards-grid" style="margin-top: 2rem;">
    <div class="card">
      <h3>Progreso semanal</h3>
      <canvas id="chart-week" height="160"></canvas>
    </div>
    <div class="card">
      <h3>Áreas más estudiadas</h3>
      <canvas id="chart-areas" height="160"></canvas>
    </div>
  </div>
</section>`;
    try {
      const h2El = container.querySelector('#dashboard h2');
      if (h2El && !container.querySelector('#user-level')) {
        const meta = document.createElement('div');
        meta.className = 'welcome-meta';
        meta.innerHTML = '<span class="pill" id="user-level"></span>';
        h2El.insertAdjacentElement('afterend', meta);
      }
    } catch {}
    renderUser();
    renderStats();
    initCharts();
    return;
  }

  const cached = sectionLoader.cache.get(section);
  const controller = new AbortController();
  sectionLoader.controller = controller;

  if (!cached) {
    showSectionLoading(container, section);
  } else {
    container.innerHTML = cached;
  }

  if (!cached) {
    try {
      const response = await fetch(`../${section}/${section}.html`, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      sectionLoader.cache.set(section, html);
      if (sectionLoader.current !== section) {
        return;
      }
      container.innerHTML = html;
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      console.error(`Error al cargar la sección ${section}`, error);
      sectionLoader.cache.delete(section);
      showSectionError(container, section, () => loadSection(section));
      return;
    }
  }

  sectionLoader.controller = null;

  await ensureSectionScript(section);
  if (sectionLoader.current !== section) return;
  callSectionInit(section);
}
// =============================
// =============================
// SPA Helper: ir a Inicio
// =============================
function goToHome() {
  document.querySelectorAll(".menu a").forEach(l => l.classList.remove("active"));
  const homeLink = document.querySelector('.menu a[data-section="dashboard"]');
  if(homeLink) homeLink.classList.add("active");
  loadSection("dashboard");
}
window.goToHome = goToHome;

// Sincronización global tras actualizar perfil/sesión
window.addEventListener('mb:auth-updated', () => {
  const auth = getAuth();
  try {
    const nombre = (auth?.user && (auth.user.nombre || auth.user.name)) || auth?.name;
    if (nombre) {
      state.user.name = nombre;
      renderUser();
    }
    const nivel = (auth?.alumno && auth.alumno.nivel) || auth?.level;
    if (nivel) state.user.level = nivel;
  } catch {}
  try { if (window.fetchProfileAndRender) window.fetchProfileAndRender(); } catch {}
});
window.addEventListener('mb:auth-logout', () => {
  try { localStorage.removeItem('mb_auth'); } catch {}
  try { localStorage.removeItem('currentView'); } catch {}
  setTimeout(() => { window.location.replace('../auth/login.html'); }, 200);
});
window.addEventListener('dashboard:open-lesson', async event => {
  const lessonId = Number(event?.detail?.lessonId);
  if (!lessonId) return;
  try {
    await loadSection('lessons');
    window.dispatchEvent(new CustomEvent('lessons:focus-request', { detail: { lessonId } }));
  } catch (err) {
    console.error('dashboard open lesson error', err);
  }
});










