// Utilidades para obtener el perfil del usuario desde el backend (con auto-refresh)

function getToken() {
  try {
    const raw = localStorage.getItem('mb_auth');
    if (raw) {
      const o = JSON.parse(raw);
      return (o && (o.token || o.access_token)) || null;
    }
  } catch {}
  return localStorage.getItem('token');
}

async function fetchProfile() {
  const API_BASE = localStorage.getItem('mb_api_base') || 'http://127.0.0.1:8000';
  let token = getToken();
  if (!token) throw new Error('Token inexistente. Inicia sesión.');

  let response = await fetch(`${API_BASE}/account/me`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include'
  });

  if (response.status === 401) {
    try {
      const res2 = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (res2.ok) {
        const data = await res2.json();
        if (data && data.access_token) {
          try {
            const raw = localStorage.getItem('mb_auth');
            if (raw) {
              const o = JSON.parse(raw);
              o.token = data.access_token; o.access_token = data.access_token;
              localStorage.setItem('mb_auth', JSON.stringify(o));
            } else {
              localStorage.setItem('token', data.access_token);
            }
          } catch {}
          token = data.access_token;
          response = await fetch(`${API_BASE}/account/me`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include'
          });
        }
      }
    } catch {}
  }

  if (response.status === 401) throw new Error('Token inválido o expirado. Inicia sesión de nuevo.');
  if (!response.ok) throw new Error(`Error al obtener el perfil: ${response.status}`);
  return await response.json();
}

export async function fetchProfileAndRender() {
  try {
    const profile = await fetchProfile();
    console.log('Perfil del usuario:', profile);
  } catch (err) {
    console.error(err);
  }
}

