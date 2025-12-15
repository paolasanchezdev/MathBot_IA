// =============================
// SETTINGS.JS
// =============================

function initSettingsSection() {
  initProfileActions();
  initThemeToggle();
  initNotificationsToggle();
  initAccountActions();
  fetchProfileAndRender();
  initSecurityActions();
}

// =============================
// Helpers
// =============================
function getAuth() {
  try {
    const raw = localStorage.getItem('mb_auth');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const hasId = !!(obj?.user?.id || obj?.id);
    const hasToken = !!(obj?.token || obj?.access_token);
    return (hasId && hasToken) ? obj : null;
  } catch { return null; }
}

const API_BASE = localStorage.getItem('mb_api_base') || 'http://127.0.0.1:8000';

async function fetchProfile() {
  const auth = getAuth();
  if (!auth) return null;
  const token = auth.token || auth.access_token;
  const res = await fetch(`${API_BASE}/account/me`, { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' });
  if (res.status === 401) {
    try { localStorage.removeItem('mb_auth'); } catch {}
    throw new Error('Token invÃ¡lido o expirado. Inicia sesiÃ³n de nuevo.');
  }
  if (!res.ok) throw new Error('No se pudo obtener el perfil');
  return res.json();
}

async function fetchProfileAndRender() {
  try {
    const data = await fetchProfile();
    if (!data) return;
    renderProfileSummary(data);
    // Sincroniza auth local
    try {
      const auth = getAuth();
      if (!auth) return;
      if (data.user) {
        auth.user = data.user;
        auth.id = data.user.id || auth.id;
        auth.name = data.user.nombre || data.user.name || auth.name;
      }
      if (data.alumno) {
        auth.alumno = data.alumno;
        auth.level = data.alumno.nivel || auth.level;
        if (data.alumno.especialidad) auth.specialty = data.alumno.especialidad;
      }
      localStorage.setItem('mb_auth', JSON.stringify(auth));
    } catch {}
  } catch (e) { console.warn(e); }
}

// Exponer para que el dashboard pueda pedir un refresco cuando cambie el perfil
window.fetchProfileAndRender = fetchProfileAndRender;

// =============================
// PERFIL
// =============================
function initProfileActions() {
  const editBtn = document.querySelector('[data-action="edit-profile"]');
  if (!editBtn) return;
  editBtn.replaceWith(editBtn.cloneNode(true));
  const newEditBtn = document.querySelector('[data-action="edit-profile"]');
  newEditBtn.addEventListener('click', () => {
    const link = document.querySelector('.menu a[data-section="profile"]');
    if (link) link.click();
    else window.location.href = '../profile/profile.html';
  });
}

function renderProfileSummary(profileData) {
  const auth = getAuth();
  const infoCard = document.querySelector('#settings .cards-grid .card');
  if (!infoCard) return;
  let nameSpan = document.getElementById('profile-name');
  let levelSpan = document.getElementById('profile-level');
  let specSpan = document.getElementById('profile-specialty');
  if (!nameSpan || !levelSpan || !specSpan) {
    const nodes = infoCard.querySelectorAll('p');
    if (nodes.length >= 2) {
      nodes[0].innerHTML = '<strong>Nombre:</strong> <span id="profile-name">â€”</span>';
      nodes[1].innerHTML = '<strong>Nivel actual:</strong> <span id="profile-level">â€”</span>';
    }
    const third = document.createElement('p');
    third.innerHTML = '<strong>Especialidad:</strong> <span id="profile-specialty">No especificada</span>';
    infoCard.appendChild(third);
    nameSpan = document.getElementById('profile-name');
    levelSpan = document.getElementById('profile-level');
    specSpan = document.getElementById('profile-specialty');
  }
  const nombre = profileData?.user?.nombre || auth?.name || '';
  const nivel = profileData?.alumno?.nivel || auth?.level || '';
  const esp = profileData?.alumno?.especialidad || auth?.specialty || '';
  if (nameSpan) nameSpan.textContent = nombre || 'â€”';
  if (levelSpan) levelSpan.textContent = nivel || 'â€”';
  if (specSpan) specSpan.textContent = esp || 'No especificada';
}

async function openProfileEditor() {
  const auth = getAuth() || { name: '', email: '', level: '1Âº AÃ±o de Bachillerato', specialty: '' };
  let server = null;
  try { server = await fetchProfile(); } catch {}

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,.4)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';

  const modal = document.createElement('div');
  modal.className = 'card glass';
  modal.style.width = 'min(520px, 92vw)';
  modal.style.padding = '1rem';

  const nombreVal = (server?.user?.nombre) || auth.name || '';
  const emailVal = (server?.user?.email) || auth.email || '';
  const nivelVal = (server?.alumno?.nivel) || auth.level || '1Âº AÃ±o de Bachillerato';
  const espVal = (server?.alumno?.especialidad) || auth.specialty || '';

  modal.innerHTML = `
    <h3>Editar perfil</h3>
    <form id="profile-form" style="margin-top:.8rem">
      <div class="field">
        <label>Nombre</label>
        <input name="name" type="text" value="${nombreVal}" required />
      </div>
      <div class="field">
        <label>Correo</label>
        <input name="email" type="email" value="${emailVal}" required />
      </div>
      <div class="field">
        <label>Nueva contraseÃ±a (opcional)</label>
        <input name="password" type="password" placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" />
      </div>
      <div class="field">
        <label>Nivel</label>
        <select name="level">
          ${['1Âº AÃ±o de Bachillerato','2Âº AÃ±o de Bachillerato'].map(l=>`<option ${nivelVal===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Especialidad (opcional)</label>
        <select name="specialty">
          ${['','Software','Automotriz','General','Salud'].map(s=>`<option value="${s}" ${String(espVal||'')===s?'selected':''}>${s||'Selecciona (opcional)'}</option>`).join('')}
        </select>
      </div>
      <div class="actions">
        <button type="submit" class="btn btn-primary">Guardar</button>
        <button type="button" class="btn btn-ghost" id="cancel-edit">Cancelar</button>
      </div>
    </form>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#cancel-edit')?.addEventListener('click', () => overlay.remove());

  modal.querySelector('#profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const levels = ['1Âº AÃ±o de Bachillerato','2Âº AÃ±o de Bachillerato'];
    let level = String(fd.get('level')||levels[0]);
    if (!levels.includes(level)) level = levels[0];
    const specs = ['','Software','Automotriz','General','Salud'];
    let specialty = String(fd.get('specialty')||'').trim();
    if (!specs.includes(specialty)) specialty = '';

    const payload = {
      nombre: String(fd.get('name')||'').trim(),
      email: String(fd.get('email')||'').trim(),
      password: String(fd.get('password')||'').trim() || undefined,
      nivel: level,
      especialidad: specialty || undefined,
    };
    if (!payload.nombre || !payload.email) { alert('Completa nombre y correo.'); return; }

    const authNow = getAuth();
    if (!authNow) { alert('SesiÃ³n no vÃ¡lida.'); return; }
    try {
      const token = authNow.token || authNow.access_token;
      const res = await fetch(`${API_BASE}/account/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { try { localStorage.removeItem('mb_auth'); } catch {} throw new Error('Token inválido o expirado. Inicia sesión de nuevo.'); } if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'No se pudo actualizar el perfil'); }
      const data = await res.json();
      // Actualizar auth local
      try {
        const authUpd = getAuth();
        if (authUpd) {
          if (data.user) {
            authUpd.user = data.user;
            authUpd.name = data.user.nombre || data.user.name || authUpd.name;
          }
          if (data.alumno) {
            authUpd.alumno = data.alumno;
            authUpd.level = data.alumno.nivel || authUpd.level;
            if (data.alumno.especialidad) authUpd.specialty = data.alumno.especialidad;
          }
          localStorage.setItem('mb_auth', JSON.stringify(authUpd));
        }
      } catch {}
      overlay.remove();
      fetchProfileAndRender();
      const headerName = document.getElementById('user-first-name');
      if (headerName && data?.user?.nombre) headerName.textContent = data.user.nombre;
      // Confirmación accesible y consistente
      try {
        const el = document.getElementById('settings-msg');
        if (el) {
          el.textContent = 'Cambios guardados correctamente.';
          el.style.color = 'var(--success)';
          el.setAttribute('role', 'status');
          el.setAttribute('aria-live', 'polite');
          setTimeout(() => { try { el.textContent = ''; } catch {} }, 2500);
        } else {
          alert('Cambios guardados correctamente.');
        }
      } catch { alert('Cambios guardados correctamente.'); }
    } catch (err) {
      console.error(err);
      alert(err.message || 'No se pudo guardar el perfil.');
    }
  });
}

// =============================
// TEMA
// =============================
function initThemeToggle() {
  const themeBtn = document.querySelector('[data-action="toggle-theme"]');
  if (!themeBtn) return;

  themeBtn.replaceWith(themeBtn.cloneNode(true));
  const newThemeBtn = document.querySelector('[data-action="toggle-theme"]');

  newThemeBtn.addEventListener('click', () => {
    const body = document.body;
    const isDark = body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    alert(`Tema cambiado a ${isDark ? 'oscuro' : 'claro'}.`);
  });
}

// =============================
// NOTIFICACIONES
// =============================
function initNotificationsToggle() {
  const notifToggle = document.getElementById('notifications-toggle');
  if (!notifToggle) return;

  notifToggle.replaceWith(notifToggle.cloneNode(true));
  const newNotifToggle = document.getElementById('notifications-toggle');

  newNotifToggle.addEventListener('change', () => {
    if (newNotifToggle.checked) alert('Notificaciones activadas.');
    else alert('Notificaciones desactivadas.');
  });
}

// =============================
// CUENTA
// =============================
function initAccountActions() {
  const logoutBtn = document.querySelector('[data-action="logout"]');
  const deleteBtn = document.querySelector('[data-action="delete-account"]');

  if (logoutBtn) {
    logoutBtn.replaceWith(logoutBtn.cloneNode(true));
    const newLogoutBtn = document.querySelector('[data-action="logout"]');

    newLogoutBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem('mb_auth');
        localStorage.removeItem('mathbot_state');
      } catch {}
      window.location.href = '../../index.html';
    });
  }

  if (deleteBtn) {
    deleteBtn.replaceWith(deleteBtn.cloneNode(true));
    const newDeleteBtn = document.querySelector('[data-action="delete-account"]');

    newDeleteBtn.addEventListener('click', () => {
      const confirmDelete = confirm('Â¿EstÃ¡s seguro de eliminar tu cuenta? Esta acciÃ³n no se puede deshacer.');
      if (!confirmDelete) return;
      // AquÃ­ podrÃ­as llamar a la API para borrar cuenta.
      try {
        localStorage.removeItem('mb_auth');
        localStorage.removeItem('mathbot_state');
      } catch {}
      alert('Cuenta eliminada localmente.');
      window.location.href = '../../index.html';
    });
  }
}

// Exponer init para dashboard
window.initSettingsSection = initSettingsSection;

// =============================
// Seguridad (cambiar contraseÃ±a)
// =============================
function initSecurityActions() {
  const form = document.getElementById('password-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const current_password = String(fd.get('current_password')||'');
    const new_password = String(fd.get('new_password')||'');
    const confirm_password = String(fd.get('confirm_password')||'');
    if (!current_password || !new_password) { alert('Completa las contraseÃ±as.'); return; }
    if (new_password !== confirm_password) { alert('Las contraseÃ±as no coinciden.'); return; }
    if (new_password.length < 8) { alert('La nueva contraseÃ±a debe tener al menos 8 caracteres.'); return; }
    const auth = getAuth();
    if (!auth) { alert('SesiÃ³n no vÃ¡lida.'); return; }
    try {
      const token = auth.token || auth.access_token;
      const res = await fetch(`${API_BASE}/account/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ current_password, new_password })
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.detail || 'No se pudo cambiar la contraseÃ±a');
      }
      form.reset();
      alert('ContraseÃ±a actualizada.');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Error al cambiar la contraseÃ±a.');
    }
  });
}

// Refrescar resumen de perfil automáticamente cuando se actualice la sesión en otra sección
window.addEventListener('mb:auth-updated', () => {
  try { fetchProfileAndRender(); } catch {}
  // Mostrar confirmación accesible
  try {
    const el = document.getElementById('settings-msg');
    if (el) {
      el.textContent = 'Cambios guardados correctamente.';
      el.style.color = 'var(--success)';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      setTimeout(() => { try { el.textContent = ''; } catch {} }, 2500);
    }
  } catch {}
});

// Override: evitar borrar sesión en 401 transitorio
async function fetchProfile() {
  const auth = getAuth();
  if (!auth) return null;
  const token = auth.token || auth.access_token;
  const res = await fetch(`${API_BASE}/account/me`, { headers: { 'Authorization': `Bearer ${token}` } });
  if (res.status === 401) { throw new Error('Token inválido o expirado. Inicia sesión de nuevo.'); }
  if (!res.ok) throw new Error('No se pudo obtener el perfil');
  return res.json();
}

