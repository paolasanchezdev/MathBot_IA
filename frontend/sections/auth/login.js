// login.js
const teacherRoles = new Set(["maestro", "maestra", "docente", "profesor", "profesora", "teacher"]);

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('auth-form');
  const errorBox = document.getElementById('auth-error');
  const toggle = document.getElementById('mode-register');
  const fieldNombre = document.getElementById('field-nombre');
  const fieldRol = document.getElementById('field-rol');
  const fieldNivel = document.getElementById('field-nivel');
  const fieldEsp = document.getElementById('field-especialidad');
  const fieldDocAnios = document.getElementById('field-docente-anios');
  const fieldDocSpecs = document.getElementById('field-docente-especialidades');
  const fieldDocNotas = document.getElementById('field-docente-notas');
  const rolSel = document.getElementById('rol');

  const API_BASE = localStorage.getItem('mb_api_base') || 'http://127.0.0.1:8000';
  const showPwd = document.getElementById('show-password');
  const pwd = document.getElementById('password');

  showPwd?.addEventListener('change', () => {
    if (!pwd) return;
    pwd.setAttribute('type', showPwd.checked ? 'text' : 'password');
  });

  function updateVisibility() {
    const isReg = !!(toggle && toggle.checked);
    if (fieldNombre) fieldNombre.style.display = isReg ? '' : 'none';
    if (fieldRol) fieldRol.style.display = isReg ? '' : 'none';
    const rol = (rolSel && rolSel.value) || 'estudiante';
    const showStudent = isReg && rol === 'estudiante';
    const showTeacher = isReg && rol === 'docente';
    if (fieldNivel) fieldNivel.style.display = showStudent ? '' : 'none';
    if (fieldEsp) fieldEsp.style.display = showStudent ? '' : 'none';
    if (fieldDocAnios) fieldDocAnios.style.display = showTeacher ? '' : 'none';
    if (fieldDocSpecs) fieldDocSpecs.style.display = showTeacher ? '' : 'none';
    if (fieldDocNotas) fieldDocNotas.style.display = showTeacher ? '' : 'none';
  }

  toggle?.addEventListener('change', updateVisibility);
  rolSel?.addEventListener('change', updateVisibility);
  updateVisibility();

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const isReg = !!(toggle && toggle.checked);
    const nombre = String(fd.get('nombre') || '').trim();
    const rol = String(fd.get('rol') || 'estudiante');
    const nivel = String(fd.get('nivel') || '').trim();
    const especialidad = String(fd.get('especialidad') || '').trim();
    const docenteAniosRaw = fd.getAll('docente_anios') || [];
    const docenteEspecialidadesRaw = fd.getAll('docente_especialidades') || [];
    const docenteNotas = String(fd.get('docente_notas') || '').trim();

    const docenteAnios = Array.from(
      new Set(
        docenteAniosRaw
          .map((value) => parseInt(String(value), 10))
          .filter((value) => !Number.isNaN(value))
      )
    );

    const docenteEspecialidades = Array.from(
      new Set(
        docenteEspecialidadesRaw
          .map((value) => String(value).trim())
          .filter(Boolean)
      )
    );

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn?.setAttribute('disabled', 'true');
    if (errorBox) errorBox.textContent = '';

    try {
      const endpoint = isReg ? '/auth/register' : '/auth/login';
      const payload = isReg ? { email, password, nombre, rol } : { email, password };
      if (isReg && rol === 'estudiante') {
        payload.nivel = nivel;
        payload.especialidad = especialidad;
      }
      if (isReg && rol === 'docente') {
        payload.docente_anios = docenteAnios;
        payload.docente_especialidades = docenteEspecialidades;
        if (docenteNotas) payload.docente_notas = docenteNotas;
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let detail = isReg ? 'Error al registrar' : 'Error de autenticacion';
        try {
          const dataErr = await res.json();
          detail = dataErr?.detail || detail;
        } catch {}
        throw new Error(detail);
      }

      const data = await res.json();
      const auth = {
        token: data.access_token,
        token_type: data.token_type || 'bearer',
        user: data.user,
        loggedAt: new Date().toISOString(),
      };
      const roleDb = String(auth.user?.rol || '').toLowerCase();
      if (data.docente) auth.docente = data.docente;

      try {
        if (!teacherRoles.has(roleDb)) {
          const uid = auth.user?.id;
          if (uid != null) {
            const resAl = await fetch(`${API_BASE}/alumnos/${encodeURIComponent(uid)}`, {
              headers: { 'Authorization': `Bearer ${auth.token}` },
            });
            if (resAl.ok) {
              auth.alumno = await resAl.json();
            }
          }
        } else {
          const resDoc = await fetch(`${API_BASE}/teachers/me`, {
            headers: { 'Authorization': `Bearer ${auth.token}` },
          });
          if (resDoc.ok) {
            const docData = await resDoc.json();
            if (docData?.teacher) auth.docente = docData.teacher;
          }
        }
      } catch (hydrateErr) {
        console.warn('profile hydration error', hydrateErr);
      }

      try {
        if (auth.user && auth.user.id != null) auth.id = auth.user.id;
        if (auth.user && (auth.user.nombre || auth.user.name)) auth.name = auth.user.nombre || auth.user.name;
        if (auth.alumno && auth.alumno.nivel) auth.level = auth.alumno.nivel;
      } catch {}

      try {
        localStorage.setItem('mb_auth', JSON.stringify(auth));
      } catch (storageErr) {
        console.error('No se pudo guardar la sesion', storageErr);
        throw new Error('No se pudo guardar la sesion en este navegador.');
      }

      const destination = teacherRoles.has(roleDb) ? '../teacher/panel.html' : '../dashboard/dashboard.html';
      window.location.replace(destination);
    } catch (err) {
      const msg = err && err.message ? err.message : 'Error inesperado';
      if (errorBox) errorBox.textContent = msg;
      else alert(msg);
    } finally {
      submitBtn?.removeAttribute('disabled');
    }
  });
});
