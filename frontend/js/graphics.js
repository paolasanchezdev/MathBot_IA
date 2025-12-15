// Simple helpers for rendering images and charts

const CHARTJS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js';

function injectScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Chart.js failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.addEventListener('load', () => { s.dataset.loaded = 'true'; resolve(); });
    s.addEventListener('error', () => reject(new Error('Chart.js failed to load')));
    document.head.appendChild(s);
  });
}

export async function ensureChartJs() {
  if (window.Chart) return;
  await injectScriptOnce(CHARTJS_CDN);
}

export function renderImage(container, src, opts = {}) {
  const { alt = '', title = '', className = '' } = opts;
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  if (title) img.title = title;
  if (className) img.className = className;
  container.innerHTML = '';
  container.appendChild(img);
  return img;
}

export async function renderChart(container, cfg = {}) {
  await ensureChartJs();

  // Resolve canvas element
  let canvas;
  if (container instanceof HTMLCanvasElement) {
    canvas = container;
  } else {
    container.innerHTML = '';
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
  }

  // Build a minimal Chart.js config depending on input
  const { type, datasets, points, labels, options } = cfg;

  let finalType = type || (points ? 'scatter' : 'line');
  let data;
  if (datasets) {
    data = { labels: labels || [], datasets };
  } else if (points) {
    data = {
      datasets: [{
        label: 'Serie',
        showLine: true,
        parsing: false,
        data: points, // [{x, y}, ...]
        borderColor: '#06f',
        backgroundColor: 'rgba(0, 102, 255, 0.2)',
        pointRadius: 2
      }]
    };
  } else if (labels) {
    data = { labels, datasets: [{ label: 'Serie', data: labels.map(() => 0) }] };
  } else {
    data = { datasets: [] };
  }

  const defaultOptions = {
    responsive: true,
    scales: {
      x: { type: (finalType === 'scatter' || finalType === 'line') ? 'linear' : 'category', position: 'bottom' },
      y: { type: 'linear' }
    }
  };

  const chart = new window.Chart(canvas.getContext('2d'), {
    type: finalType,
    data,
    options: Object.assign({}, defaultOptions, options || {})
  });

  return chart;
}

export default { ensureChartJs, renderImage, renderChart };

