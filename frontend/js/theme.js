(function(){
  const STORAGE_KEY = 'theme';
  const root = document.documentElement;

  function readStoredTheme(){
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (err) {
      console.warn('theme storage read error', err);
    }
    const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    return media && media.matches ? 'dark' : 'light';
  }

  function getCurrentTheme(){
    const attr = root.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return readStoredTheme();
  }

  function applyTheme(theme){
    const next = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    if (document.body) {
      document.body.classList.toggle('dark', next === 'dark');
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.toggle('dark', next === 'dark');
      }, { once: true });
    }
    root.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    return next;
  }

  function setTheme(theme){
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      console.warn('theme storage write error', err);
    }
    return applyTheme(theme);
  }

  function toggleTheme(){
    const current = getCurrentTheme();
    return setTheme(current === 'dark' ? 'light' : 'dark');
  }

  const initial = applyTheme(getCurrentTheme());

  window.MathBotTheme = {
    getTheme: getCurrentTheme,
    applyTheme,
    setTheme,
    toggleTheme,
    STORAGE_KEY
  };

  // Mantener sincronizado con cambios del sistema
  if (window.matchMedia) {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      if (media && typeof media.addEventListener === 'function') {
        media.addEventListener('change', (ev) => {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored !== 'dark' && stored !== 'light') {
            applyTheme(ev.matches ? 'dark' : 'light');
          }
        });
      } else if (media && typeof media.addListener === 'function') {
        media.addListener((ev) => {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored !== 'dark' && stored !== 'light') {
            applyTheme(ev.matches ? 'dark' : 'light');
          }
        });
      }
    } catch (err) {
      console.warn('theme media listener error', err);
    }
  }

})();
