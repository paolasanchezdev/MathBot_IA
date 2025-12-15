const teacherRoles = new Set(["maestro", "maestra", "docente", "profesor", "profesora", "teacher"]);

const YEAR_LABELS = {
  1: '1er año',
  2: '2do año',
  3: '3er año',
  4: '4to año',
  5: '5to año',
  6: '6to año',
};

const state = {
  token: null,
  apiBase: 'http://127.0.0.1:8000',
  auth: null,
  authUser: null,
  teacher: null,
  stats: { total: 0, por_anio: {}, por_especialidad: {} },
  statsSummary: { yearEntries: [], specEntries: [], topYear: null, topSpec: null },
  students: [],
  totalStudents: 0,
  limit: 10,
  offset: 0,
  filters: { q: '', anio: '', especialidad: '' },
};

function getAuth() {
  try {
    const raw = localStorage.getItem('mb_auth');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const token = data.token || data.access_token;
    const userId = data.user?.id ?? data.id;
    if (!token || !userId) return null;
    return data;
  } catch (err) {
    console.warn('auth parse error', err);
    return null;
  }
}

function applyThemeButton() {
  const btn = document.getElementById('teacher-theme-toggle');
  const themeAPI = window.MathBotTheme;
  if (!btn) return;
  const updateLabel = (next) => {
    btn.textContent = next === 'dark' ? 'Tema claro' : 'Tema oscuro';
  };
  if (themeAPI && typeof themeAPI.getTheme === 'function') {
    updateLabel(themeAPI.getTheme());
    document.documentElement.addEventListener('themechange', (ev) => updateLabel(ev.detail.theme));
    btn.addEventListener('click', () => {
      const next = themeAPI.getTheme() === 'dark' ? 'light' : 'dark';
      themeAPI.setTheme(next);
    });
  } else {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch {}
      updateLabel(next);
    });
  }
}

async function fetchJSON(url, options = {}) {
  if (!state.token) throw new Error('Token no disponible');
  const opts = { ...options };
  const baseHeaders = {
    Authorization: `Bearer ${state.token}`,
    Accept: 'application/json',
  };
  opts.headers = { ...baseHeaders, ...(options.headers || {}) };
  const res = await fetch(url, opts);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {}
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error('Respuesta invalida del servidor');
  }
}

function sortedEntries(source) {
  return Object.entries(source || {})
    .map(([key, raw]) => [key, Number(raw) || 0])
    .sort((a, b) => b[1] - a[1]);
}

function formatYearLabel(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isNaN(parsed) && YEAR_LABELS[parsed]) {
    return YEAR_LABELS[parsed];
  }
  return `Año ${String(value)}`;
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}



const YEAR_TEXT_PATTERN = /(?:^|\b)([0-9]{1,2})\s*(?:er|ro|do|to|mo|°|º)?\s*(?:año|ano)/i;

function parseYearFromText(value) {
  if (value == null) return null;
  const txt = String(value).trim();
  if (!txt) return null;
  const match = YEAR_TEXT_PATTERN.exec(txt);
  if (match) {
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const digits = txt.match(/\d+/);
  if (digits && digits.length) {
    const parsed = Number.parseInt(digits[0], 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function extractYearCandidate(student) {
  if (!student) return null;
  const primary = [student?.anio, student?.ano, student?.year];
  for (const raw of primary) {
    if (raw === undefined || raw === null || raw === '') continue;
    const numeric = Number.parseInt(raw, 10);
    if (!Number.isNaN(numeric)) return numeric;
    const parsed = parseYearFromText(raw);
    if (parsed != null) return parsed;
  }
  const levelText = student?.nivel || student?.level;
  return parseYearFromText(levelText);
}

function deriveMaxYear(students) {
  if (!Array.isArray(students) || !students.length) return 3;
  const values = [];
  students.forEach((item) => {
    const candidate = extractYearCandidate(item);
    if (Number.isFinite(candidate) && candidate > 0) values.push(candidate);
  });
  if (!values.length) return 3;
  const max = Math.max(...values);
  return Number.isFinite(max) && max > 0 ? max : 3;
}

function normalizeProgressEntry(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const percent = raw <= 1 ? raw * 100 : raw;
    return { percent, source: 'explicit' };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const numeric = Number.parseFloat(trimmed.replace('%', ''));
    if (Number.isNaN(numeric)) return null;
    const percent = trimmed.includes('%') || numeric > 1 ? numeric : numeric * 100;
    return { percent, source: 'explicit' };
  }
  if (typeof raw === 'object') {
    const payload = { ...raw };
    const candidates = [payload.percent, payload.porcentaje, payload.percentage, payload.value, payload.progress, payload.pct];
    let percent = null;
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null || candidate === '') continue;
      const numeric = Number.parseFloat(candidate);
      if (!Number.isNaN(numeric)) {
        percent = numeric <= 1 ? numeric * 100 : numeric;
        break;
      }
    }
    if (percent === null && payload.completed != null && payload.total != null) {
      const completed = Number.parseFloat(payload.completed);
      const total = Number.parseFloat(payload.total);
      if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
        percent = (completed / total) * 100;
      }
    }
    const label = payload.label || payload.etiqueta || payload.descripcion || payload.description || null;
    const stage = payload.stage || payload.etapa || null;
    if (percent === null) {
      if (!label && !stage) return null;
      return { percent: null, label, stage, source: payload.source || 'explicit' };
    }
    return {
      percent,
      label,
      stage,
      source: payload.source || 'explicit',
    };
  }
  return null;
}

function computeProgressForStudent(student, maxYear) {
  const direct = normalizeProgressEntry(student?.progreso ?? student?.progress);
  if (direct) {
    if (Number.isFinite(direct.percent)) {
      const percent = Math.max(0, Math.min(100, direct.percent));
      return {
        percent,
        label: direct.label || null,
        stage: direct.stage || null,
        source: direct.source || 'explicit',
      };
    }
    if (direct.label || direct.stage) {
      return {
        percent: null,
        label: direct.label || null,
        stage: direct.stage || null,
        source: direct.source || 'explicit',
      };
    }
  }
  const derivedYear = extractYearCandidate(student);
  if (derivedYear == null) {
    return null;
  }
  const ceiling = Number.isFinite(maxYear) && maxYear > 0 ? maxYear : Math.max(derivedYear, 3);
  const cappedYear = Math.max(0, Math.min(Math.round(derivedYear), ceiling));
  const percent = ceiling ? (cappedYear / ceiling) * 100 : 0;
  return {
    percent: Math.max(0, Math.min(100, percent)),
    label: YEAR_LABELS[cappedYear] || `Año ${cappedYear}`,
    stage: `${cappedYear}/${ceiling}`,
    source: 'derived',
  };
}

function buildProgressMarkup(student, maxYear) {
  const progress = computeProgressForStudent(student, maxYear);
  if (!progress) {
    return '<span class="cell-secondary muted">Sin datos</span>';
  }
  const detailParts = [];
  if (progress.label) detailParts.push(progress.label);
  if (progress.stage && progress.stage !== progress.label) detailParts.push(progress.stage);
  const safeDetails = detailParts.map((entry) => escapeHTML(entry));
  if (!Number.isFinite(progress.percent)) {
    if (safeDetails.length) {
      return `<div class="progress-cell progress-cell--empty"><span class="progress-cell-detail">${safeDetails.join(' · ')}</span></div>`;
    }
    return '<span class="cell-secondary muted">Sin datos</span>';
  }
  const percent = Math.max(0, Math.min(100, progress.percent));
  const percentLabel = `${Math.round(percent)}%`;
  const detailMarkup = safeDetails.length ? `<span class="progress-cell-detail">${safeDetails.join(' · ')}</span>` : '';
  const sourceAttr = escapeHTML(progress.source || 'derived');
  return `
    <div class="progress-cell" data-source="${sourceAttr}">
      <div class="progress-cell-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(1)}">
        <span style="width: ${percent}%;"></span>
      </div>
      <div class="progress-cell-meta">
        <span class="progress-cell-value">${percentLabel}</span>
        ${detailMarkup}
      </div>
    </div>
  `.trim();
}

function createMetricEmpty(message) {
  const li = document.createElement('li');
  li.className = 'metric-empty';
  li.textContent = message;
  return li;
}

function createMetricItem(label, value) {
  const li = document.createElement('li');
  const nameSpan = document.createElement('span');
  nameSpan.textContent = label;
  const valueSpan = document.createElement('span');
  valueSpan.textContent = String(value);
  li.append(nameSpan, valueSpan);
  return li;
}

function renderTeacherMeta() {
  const nameEl = document.getElementById('teacher-name');
  const emailEl = document.getElementById('teacher-email');
  const updatedEl = document.getElementById('teacher-updated');
  const fallback = '-';
  if (!nameEl && !emailEl && !updatedEl) return;
  const auth = state.auth || {};
  const teacher = state.teacher || auth.docente || {};
  const user = state.authUser || auth.user || teacher.usuario || teacher.user || {};
  const pickText = (values) => {
    for (const value of values) {
      if (Array.isArray(value)) {
        const joined = value
          .filter(Boolean)
          .map((item) => String(item).trim())
          .filter(Boolean)
          .join(' ')
          .trim();
        if (joined) return joined;
      } else if (value != null) {
        const txt = String(value).trim();
        if (txt) return txt;
      }
    }
    return null;
  };
  const pickRaw = (values) => {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
    return null;
  };
  const name =
    pickText([
      auth.name,
      user.nombre_completo,
      user.nombreCompleto,
      user.full_name,
      user.fullName,
      [user.nombre || user.name || user.first_name || user.primer_nombre, user.apellidos || user.apellido || user.last_name || user.segundo_apellido],
      teacher.nombre_completo,
      teacher.nombreCompleto,
      [teacher.nombre, teacher.apellidos],
      user.username,
      teacher.username,
    ]) || fallback;
  const email =
    pickText([
      user.email,
      user.correo,
      user.mail,
      auth.email,
      auth.user?.email,
      auth.user?.correo,
      teacher.email,
      teacher.correo,
    ]) || fallback;
  const updatedRaw = pickRaw([
    teacher.actualizado_en,
    teacher.updated_at,
    teacher.updatedAt,
    teacher.updated,
    teacher.updated_en,
    teacher.modificado_en,
    teacher.updatedOn,
    auth.docente?.updated_at,
    auth.docente?.updated,
    teacher.creado_en,
    teacher.created_at,
  ]);
  if (nameEl) {
    nameEl.textContent = name;
    nameEl.title = name !== fallback ? name : '';
  }
  if (emailEl) {
    emailEl.textContent = email;
    emailEl.title = email !== fallback ? email : '';
  }
  if (updatedEl) {
    const formatted = updatedRaw ? formatDateTime(updatedRaw) : fallback;
    updatedEl.textContent = formatted || fallback;
  }
}

function renderStats() {
  const totalEl = document.getElementById('stat-total');
  if (totalEl) totalEl.textContent = String(state.totalStudents || 0);
  const highlightEl = document.getElementById('stat-highlight');
  const topYearEl = document.getElementById('stat-top-year');
  const topSpecEl = document.getElementById('stat-top-spec');
  const yearsEl = document.getElementById('stat-years');
  const specsEl = document.getElementById('stat-specs');
  const yearEntries = sortedEntries(state.stats?.por_anio);
  const specEntries = sortedEntries(state.stats?.por_especialidad);
  if (yearsEl) {
    yearsEl.innerHTML = '';
    if (yearEntries.length === 0) {
      yearsEl.appendChild(createMetricEmpty('Sin datos por ahora'));
    } else {
      yearEntries.forEach(([year, amount]) => {
        yearsEl.appendChild(createMetricItem(formatYearLabel(year), amount));
      });
    }
  }
  if (specsEl) {
    specsEl.innerHTML = '';
    if (specEntries.length === 0) {
      specsEl.appendChild(createMetricEmpty('Sin datos por ahora'));
    } else {
      specEntries.forEach(([spec, amount]) => {
        specsEl.appendChild(createMetricItem(spec, amount));
      });
    }
  }
  const topYear = yearEntries[0] || null;
  const topSpec = specEntries[0] || null;
  if (topYearEl) {
    topYearEl.textContent = topYear ? `${formatYearLabel(topYear[0])} (${topYear[1]})` : 'Sin datos';
  }
  if (topSpecEl) {
    topSpecEl.textContent = topSpec ? `${topSpec[0]} (${topSpec[1]})` : 'Sin datos';
  }
  if (highlightEl) {
    const highlightParts = [];
    if (topYear) highlightParts.push(`Mayor cohorte: ${formatYearLabel(topYear[0])} (${topYear[1]})`);
    if (topSpec) highlightParts.push(`Especialidad destacada: ${topSpec[0]} (${topSpec[1]})`);
    highlightEl.textContent = highlightParts.length ? highlightParts.join(' | ') : 'Sin coincidencias por ahora.';
  }
  state.statsSummary = { yearEntries, specEntries, topYear, topSpec };
}

function populateProfileForm() {
  const profile = state.teacher;
  if (!profile) return;
  const years = new Set((profile.anios || []).map((value) => String(value)));
  const specs = new Set((profile.especialidades || []).map((value) => String(value)));
  document.querySelectorAll('input[name="docente_anios"]').forEach((input) => {
    input.checked = years.has(input.value);
  });
  document.querySelectorAll('input[name="docente_especialidades"]').forEach((input) => {
    input.checked = specs.has(input.value);
  });
  const notes = document.getElementById('docente-notas');
  if (notes) notes.value = profile.notas || '';
}

function renderPreview(items) {
  const summary = document.getElementById('teacher-summary-text');
  if (!summary) return;
  const total = Number(state.totalStudents) || 0;
  if (total === 0) {
    summary.textContent = 'Aun no tienes estudiantes asignados. Ajusta tu perfil para comenzar.';
    return;
  }
  const source = Array.isArray(items) ? items : [];
  const sampleNames = source
    .filter((item) => item && item.nombre)
    .slice(0, 3)
    .map((item) => item.nombre)
    .filter(Boolean);
  const parts = [`Gestionas ${total} estudiantes asignados`];
  const topYear = state.statsSummary.topYear;
  const topSpec = state.statsSummary.topSpec;
  if (topYear) parts.push(`Mayor cohorte: ${formatYearLabel(topYear[0])}`);
  if (topSpec) parts.push(`Especialidad clave: ${topSpec[0]}`);
  if (sampleNames.length) parts.push(`Ejemplos: ${sampleNames.join(', ')}`);
  summary.textContent = parts.join(' | ');
}

function renderStudents() {
  const tbody = document.getElementById('teacher-students-body');
  const countLbl = document.getElementById('teacher-students-count');
  const prevBtn = document.getElementById('teacher-prev');
  const nextBtn = document.getElementById('teacher-next');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!state.students.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 6;
    td.innerHTML = '<div class="empty-state"><strong>Sin estudiantes para este filtro</strong><span>Revisa tu perfil docente o ajusta los filtros.</span></div>';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    const maxYear = deriveMaxYear(state.students);
    state.students.forEach((student) => {
      const tr = document.createElement('tr');
      const name = escapeHTML(student?.nombre || student?.name || 'Sin nombre');
      const emailValue = escapeHTML(student?.email || student?.correo || student?.mail || '');
      const levelValue = escapeHTML(student?.nivel || student?.level || '');
      const yearValue = extractYearCandidate(student);
      const specValue = escapeHTML(student?.especialidad || student?.specialidad || student?.specialty || '');
      const assignedRaw = student?.asignado_en || student?.asignado || student?.asignadoEn;
      const assignedFormatted = formatDateTime(assignedRaw);
      const progressMarkup = buildProgressMarkup(student, maxYear);
      const emailMarkup = emailValue ? `<span class="cell-secondary">${emailValue}</span>` : '<span class="cell-secondary muted">Sin email</span>';
      const levelMarkup = levelValue ? `<span class="badge badge-level">${levelValue}</span>` : '<span class="cell-secondary muted">Sin dato</span>';
      const yearMarkup = yearValue != null ? `<span class="badge badge-neutral">${escapeHTML(formatYearLabel(yearValue))}</span>` : '<span class="cell-secondary muted">Sin dato</span>';
      const specMarkup = specValue ? `<span class="badge badge-specialty">${specValue}</span>` : '<span class="cell-secondary muted">Sin dato</span>';
      const assignedMarkup = assignedFormatted === '-' ? '<span class="cell-secondary muted">Sin fecha</span>' : `<span class="cell-secondary">${assignedFormatted}</span>`;
      tr.innerHTML = `
        <td data-label="Estudiante">
          <span class="cell-primary">${name}</span>
          ${emailMarkup}
        </td>
        <td data-label="Nivel">${levelMarkup}</td>
        <td data-label="Año">${yearMarkup}</td>
        <td data-label="Especialidad">${specMarkup}</td>
        <td data-label="Progreso">${progressMarkup}</td>
        <td data-label="Asignado">${assignedMarkup}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  if (countLbl) {
    const start = state.totalStudents === 0 ? 0 : state.offset + 1;
    const end = Math.min(state.offset + state.limit, state.totalStudents);
    countLbl.textContent = `Mostrando ${start}-${end} de ${state.totalStudents}`;
  }
  if (prevBtn) {
    prevBtn.disabled = state.offset <= 0;
  }
  if (nextBtn) {
    nextBtn.disabled = state.offset + state.limit >= state.totalStudents;
  }
}

async function loadOverview() {
  const url = `${state.apiBase}/teachers/me`;
  const data = await fetchJSON(url);
  state.teacher = data?.teacher || state.teacher;
  state.stats = data?.stats || { total: 0, por_anio: {}, por_especialidad: {} };
  state.totalStudents = data?.total_students || 0;
  renderTeacherMeta();
  renderStats();
  populateProfileForm();
  renderPreview(data?.students_preview || []);
}

async function loadStudents() {
  const params = new URLSearchParams();
  params.set('limit', String(state.limit));
  params.set('offset', String(state.offset));
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.anio) params.set('anio', state.filters.anio);
  if (state.filters.especialidad) params.set('especialidad', state.filters.especialidad);
  const url = `${state.apiBase}/teachers/me/students?${params.toString()}`;
  const data = await fetchJSON(url);
  state.students = data?.items || [];
  state.totalStudents = data?.count || 0;
  state.stats = data?.stats || state.stats;
  renderStats();
  renderStudents();
}

async function submitProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.getElementById('teacher-profile-feedback');
  const btn = form.querySelector('button[type="submit"]');
  const years = Array.from(form.querySelectorAll('input[name="docente_anios"]:checked'))
    .map((input) => Number.parseInt(input.value, 10))
    .filter((value) => !Number.isNaN(value));
  const specs = Array.from(form.querySelectorAll('input[name="docente_especialidades"]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
  const notes = (form.querySelector('textarea[name="docente_notas"]')?.value || '').trim();
  btn?.setAttribute('disabled', 'true');
  if (feedback) feedback.textContent = '';
  try {
    const payload = { anios: years, especialidades: specs, notas: notes };
    const data = await fetchJSON(`${state.apiBase}/teachers/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    state.teacher = data?.teacher || state.teacher;
    if (feedback) feedback.textContent = 'Perfil guardado';
    await loadOverview();
    await loadStudents();
  } catch (err) {
    console.error('profile save error', err);
    if (feedback) feedback.textContent = `Error: ${err.message || err}`;
  } finally {
    btn?.removeAttribute('disabled');
  }
}

let searchTimer = null;

function handleFilters() {
  const search = document.getElementById('teacher-search');
  const year = document.getElementById('teacher-filter-year');
  const spec = document.getElementById('teacher-filter-spec');
  const clearBtn = document.getElementById('teacher-clear');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.q = search.value.trim();
        state.offset = 0;
        loadStudents().catch(console.error);
      }, 250);
    });
  }
  year?.addEventListener('change', () => {
    state.filters.anio = year.value;
    state.offset = 0;
    loadStudents().catch(console.error);
  });
  spec?.addEventListener('change', () => {
    state.filters.especialidad = spec.value;
    state.offset = 0;
    loadStudents().catch(console.error);
  });
  clearBtn?.addEventListener('click', () => {
    if (search) search.value = '';
    if (year) year.value = '';
    if (spec) spec.value = '';
    state.filters = { q: '', anio: '', especialidad: '' };
    state.offset = 0;
    loadStudents().catch(console.error);
  });
  const prev = document.getElementById('teacher-prev');
  const next = document.getElementById('teacher-next');
  prev?.addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - state.limit);
    loadStudents().catch(console.error);
  });
  next?.addEventListener('click', () => {
    if (state.offset + state.limit < state.totalStudents) {
      state.offset += state.limit;
      loadStudents().catch(console.error);
    }
  });
}

function registerActions() {
  document.getElementById('teacher-logout')?.addEventListener('click', () => {
    try {
      localStorage.removeItem('mb_auth');
      localStorage.removeItem('currentView');
    } catch {}
    window.location.replace('../auth/login.html');
  });
  document.getElementById('teacher-refresh')?.addEventListener('click', () => {
    loadOverview().catch(console.error);
    loadStudents().catch(console.error);
  });
  document.getElementById('teacher-profile-form')?.addEventListener('submit', submitProfile);
}

function bootstrap() {
  const auth = getAuth();
  if (!auth) {
    window.location.replace('../auth/login.html');
    return;
  }
  const role = String(auth.user?.rol || '').toLowerCase();
  if (!teacherRoles.has(role)) {
    window.location.replace('../dashboard/dashboard.html');
    return;
  }
  state.auth = auth;
  state.authUser = auth.user || auth.usuario || null;
  if (!state.teacher && auth.docente) {
    state.teacher = auth.docente;
  }
  renderTeacherMeta();
  state.token = auth.token || auth.access_token;
  state.apiBase = localStorage.getItem('mb_api_base') || 'http://127.0.0.1:8000';
  applyThemeButton();
  registerActions();
  handleFilters();
  loadOverview().catch((err) => console.error('overview error', err));
  loadStudents().catch((err) => console.error('students error', err));
}

document.addEventListener('DOMContentLoaded', bootstrap);