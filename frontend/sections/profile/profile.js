// profile.js (with auto-refresh)
(function(){
  const API_BASE = localStorage.getItem('mb_api_base') || 'http://127.0.0.1:8000';

  function getAuth(){
    try{
      const raw = localStorage.getItem('mb_auth');
      if(!raw) return null;
      const o = JSON.parse(raw);
      const hasId = !!((o && o.user && o.user.id) || o?.id);
      const hasToken = !!(o && (o.token || o.access_token));
      return (hasId && hasToken) ? o : null;
    }catch{ return null; }
  }

  function setAuthToken(newToken){
    try{
      const raw = localStorage.getItem('mb_auth');
      if(!raw) return;
      const o = JSON.parse(raw);
      o.token = newToken; o.access_token = newToken;
      localStorage.setItem('mb_auth', JSON.stringify(o));
    }catch{}
  }

  async function refreshAccessToken(){
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if(!res.ok) throw new Error('No se pudo refrescar la sesión');
    const data = await res.json();
    if(data && data.access_token){ setAuthToken(data.access_token); }
    return data;
  }

  async function fetchWithAuth(path, options={}){
    const auth = getAuth();
    const token = auth?.token || auth?.access_token || '';
    const opts = { ...options, headers: { ...(options.headers||{}), 'Authorization': `Bearer ${token}` }, credentials: 'include' };
    let res = await fetch(`${API_BASE}${path}`, opts);
    if(res.status === 401){
      try{
        await refreshAccessToken();
        const auth2 = getAuth();
        const token2 = auth2?.token || auth2?.access_token || '';
        const opts2 = { ...options, headers: { ...(options.headers||{}), 'Authorization': `Bearer ${token2}` }, credentials: 'include' };
        res = await fetch(`${API_BASE}${path}`, opts2);
      }catch{}
    }
    return res;
  }

  async function fetchProfile(){
    const auth = getAuth();
    if(!auth) return null;
    const res = await fetchWithAuth('/account/me', {});
    if(res.status === 401){ throw new Error('Token inválido o expirado. Inicia sesión de nuevo.'); }
    if(!res.ok) throw new Error('No se pudo obtener el perfil');
    return res.json();
  }

  async function saveProfile(payload){
    const auth = getAuth(); if(!auth) throw new Error('Sesión inválida');
    const res = await fetchWithAuth('/account/me', {
      method:'PUT',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok){ const err = await res.json().catch(()=>({})); throw new Error(err.detail || 'No se pudo actualizar el perfil'); }
    return res.json();
  }

  async function changePassword(current_password, new_password){
    const auth = getAuth(); if(!auth) throw new Error('Sesión inválida');
    const res = await fetchWithAuth('/account/password', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ current_password, new_password })
    });
    if(!res.ok){ const err = await res.json().catch(()=>({})); throw new Error(err.detail || 'No se pudo cambiar la contraseña'); }
    return res.json();
  }

  async function init(){
    const pf = document.getElementById('profile-form');
    const pwf = document.getElementById('password-form');
    const pfMsg = document.getElementById('pf-msg');
    const pwMsg = document.getElementById('pw-msg');

    // Rellenar formulario con server o local
    try{
      const data = await fetchProfile();
      const auth = getAuth();
      const nombre = data?.user?.nombre || auth?.name || '';
      const email = data?.user?.email || auth?.email || '';
      const nivel = data?.alumno?.nivel || auth?.level || '1º Año de Bachillerato';
      const esp = data?.alumno?.especialidad || auth?.specialty || '';
      const elNombre = document.getElementById('pf-nombre'); if (elNombre) elNombre.value = nombre;
      const elEmail = document.getElementById('pf-email'); if (elEmail) elEmail.value = email;
      const elNivel = document.getElementById('pf-nivel'); if (elNivel) elNivel.value = nivel;
      const levelSummary = document.getElementById('profile-level-summary'); if (levelSummary) levelSummary.textContent = nivel;
      const elEsp = document.getElementById('pf-especialidad'); if (elEsp) elEsp.value = esp;
    }catch(e){
      console.warn(e);
      // Mostrar mensaje útil si el token ya no es válido y redirigir a login
      const msg = (e && e.message) ? e.message : 'No se pudo cargar tu perfil.';
      if (pfMsg) { pfMsg.style.color = 'var(--danger)'; pfMsg.textContent = msg; }
      if (String(msg).toLowerCase().includes('token inválido')) {
        try { localStorage.removeItem('mb_auth'); } catch {}
        setTimeout(()=>{ window.location.replace('../auth/login.html'); }, 600);
      }
    }

    // Guardar perfil
    pf?.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const fd = new FormData(pf);
      const payload = {
        nombre: String(fd.get('nombre')||'').trim(),
        email: String(fd.get('email')||'').trim(),
        nivel: String(fd.get('nivel')||'').trim(),
        especialidad: String(fd.get('especialidad')||'').trim() || undefined,
      };
      if(!payload.nombre || !payload.email){ if(pfMsg){ pfMsg.style.color='var(--danger)'; pfMsg.textContent='Completa nombre y correo.';} return; }
      try{
        const resp = await saveProfile(payload);
        // Actualiza auth local
        try{
          const auth = getAuth();
          if(auth){
            if(resp.user){ auth.user = resp.user; auth.name = resp.user.nombre || auth.name; auth.id = resp.user.id || auth.id; }
            if(resp.alumno){ auth.alumno = resp.alumno; auth.level = resp.alumno.nivel || auth.level; if(resp.alumno.especialidad) auth.specialty = resp.alumno.especialidad; }
            localStorage.setItem('mb_auth', JSON.stringify(auth));
          }
        }catch{}

        if(pfMsg){ pfMsg.style.color = 'var(--success)'; pfMsg.textContent = 'Cambios guardados correctamente.'; }

        // Avisar a otras secciones (Settings/Dashboard) para refrescar
        try { window.dispatchEvent(new CustomEvent('mb:auth-updated', { detail: { source: 'profile' } })); } catch {}

        // Actualizar encabezado y resumen de Configuración si están presentes
        try {
          const headerName = document.getElementById('user-first-name');
          if (headerName && resp?.user?.nombre) headerName.textContent = resp.user.nombre;
          const nameSpan = document.getElementById('profile-name');
          if (nameSpan && resp?.user?.nombre) nameSpan.textContent = resp.user.nombre;
          const levelSpan = document.getElementById('profile-level');
          if (levelSpan && (resp?.alumno?.nivel || payload.nivel)) levelSpan.textContent = (resp?.alumno?.nivel || payload.nivel);
          const levelSummary2 = document.getElementById('profile-level-summary');
          if (levelSummary2 && (resp?.alumno?.nivel || payload.nivel)) levelSummary2.textContent = (resp?.alumno?.nivel || payload.nivel);
          const specSpan = document.getElementById('profile-specialty');
          if (specSpan) specSpan.textContent = (resp?.alumno?.especialidad || payload.especialidad || 'No especificada');
        } catch {}

      }catch(err){
        if(pfMsg){ pfMsg.style.color = 'var(--danger)'; pfMsg.textContent = err.message; }
        if (String(err.message||'').toLowerCase().includes('token inválido')) {
          try { localStorage.removeItem('mb_auth'); } catch {}
          setTimeout(()=>{ window.location.replace('../auth/login.html'); }, 600);
        }
      }
    });

    // Cambiar contraseña
    pwf?.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const fd = new FormData(pwf);
      const a = String(fd.get('current_password')||'');
      const b = String(fd.get('new_password')||'');
      const c = String(fd.get('confirm_password')||'');
      if(b !== c){ if(pwMsg){ pwMsg.style.color='var(--danger)'; pwMsg.textContent='Las contraseñas no coinciden.';} return; }
      if(b.length < 8){ if(pwMsg){ pwMsg.style.color='var(--danger)'; pwMsg.textContent='La nueva contraseña debe tener al menos 8 caracteres.';} return; }
      try{
        await changePassword(a,b);
        pwf.reset();
        if(pwMsg){ pwMsg.style.color='var(--success)'; pwMsg.textContent='Contraseña actualizada.'; }
      }catch(err){
        if(pwMsg){ pwMsg.style.color='var(--danger)'; pwMsg.textContent = err.message; }
        if(String(err.message||'').includes('Token inválido')){
          setTimeout(()=>{ window.location.replace('../auth/login.html'); }, 400);
        }
      }
    });

    const logoutBtn = document.getElementById('logout-btn');
    const logoutMsg = document.getElementById('logout-msg');
    logoutBtn?.addEventListener('click', async () => {
      if (logoutBtn) logoutBtn.disabled = true;
      if (logoutMsg) { logoutMsg.style.color = 'inherit'; logoutMsg.textContent = ''; }
      try {
        try {
          await fetchWithAuth('/auth/logout', { method: 'POST', headers: { 'Accept': 'application/json' } });
        } catch (logoutErr) {
          console.warn('logout request failed', logoutErr);
        }
        try { localStorage.removeItem('mb_auth'); } catch {}
        try { localStorage.removeItem('token'); } catch {}
        try { localStorage.removeItem('currentView'); } catch {}
        if (logoutMsg) { logoutMsg.style.color = 'var(--success)'; logoutMsg.textContent = 'Sesión cerrada. Redirigiendo...'; }
        try { window.dispatchEvent(new CustomEvent('mb:auth-logout', { detail: { source: 'profile' } })); } catch {}
        setTimeout(() => { window.location.replace('../auth/login.html'); }, 600);
      } catch (err) {
        console.error(err);
        if (logoutMsg) { logoutMsg.style.color = 'var(--danger)'; logoutMsg.textContent = err?.message || 'No se pudo cerrar la sesión.'; }
      } finally {
        if (logoutBtn) setTimeout(() => { logoutBtn.disabled = false; }, 1200);
      }
    });

    // Acceso rápido a Configuración
    try {
      const btnCfg = document.getElementById('go-settings');
      btnCfg?.addEventListener('click', () => {
        const link = document.querySelector('.menu a[data-section="settings"]');
        if (link) link.click();
        else window.location.href = '../settings/settings.html';
      });
    } catch {}
  }

  window.initProfileSection = init;
})();
