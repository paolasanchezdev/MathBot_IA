// Lightweight MathJax helper to render LaTeX in DOM nodes
// Usage:
//   import { renderLatexToElement, typesetElement } from './renderMath.js';
//   renderLatexToElement(container, 'Sea $x^2 + y^2 = r^2$ ...');

const MATHJAX_CDN = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';

function injectScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('MathJax failed to load')));
      return;
    }

    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.addEventListener('load', () => {
      s.dataset.loaded = 'true';
      resolve();
    });
    s.addEventListener('error', () => reject(new Error('MathJax failed to load')));
    document.head.appendChild(s);
  });
}

export async function ensureMathJax(config) {
  if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
    return;
  }
  // Provide a minimal default config if none present
  if (!window.MathJax) {
    window.MathJax = {
      tex: { inlineMath: [['$', '$'], ['\\(', '\\)']] },
      svg: { fontCache: 'global' },
      ...(config || {})
    };
  }
  await injectScriptOnce(MATHJAX_CDN);
}

export async function typesetElement(element) {
  await ensureMathJax();
  if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
    // Limit to the passed element for performance
    await window.MathJax.typesetPromise([element]);
  }
}

export async function renderLatexToElement(element, text, opts = {}) {
  const { markdown = false } = opts;
  if (markdown && window.marked) {
    element.innerHTML = window.marked.parse(text);
  } else {
    element.innerHTML = text;
  }
  await typesetElement(element);
}

export default { ensureMathJax, typesetElement, renderLatexToElement };

