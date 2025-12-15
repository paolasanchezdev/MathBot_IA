// stats.js
window.initStatsSection = function(){
  const cssHref = '../stats/stats.css';
  if (!document.querySelector(`link[data-stats-css="true"][href$="${cssHref}"]`)){
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    link.dataset.statsCss = 'true';
    document.head.appendChild(link);
  }

  const summaryEl = document.getElementById('stats-summary');
  const progressPill = document.getElementById('stats-progress-pill');
  const lessonsCompleteEl = document.getElementById('stats-lessons-complete');
  const lessonsTotalEl = document.getElementById('stats-lessons-total');
  const lessonProgressBar = document.getElementById('stats-lesson-progress');
  const unitsEl = document.getElementById('stats-units');
  const nextUnitEl = document.getElementById('stats-next-unit');
  const streakEl = document.getElementById('stats-streak');
  const lastActivityEl = document.getElementById('stats-last-activity');
  const nextLessonBtn = document.getElementById('stats-next-lesson');
  const nextLessonDetail = document.getElementById('stats-next-lesson-detail');
  const recommendationsWrap = document.getElementById('stats-recommendations');
  const areasCanvas = document.getElementById('chart-areas-stats');
  const weekCanvas = document.getElementById('chart-week-stats');

  const charts = {
    areas: null,
    week: null,
  };

  let unsubscribeProgress = null;
  let chartRetryHandle = null;
  let lastSnapshot = null;

  function getSnapshot(){
    if (window.MathBotProgress && typeof window.MathBotProgress.snapshot === 'function'){
      try {
        return window.MathBotProgress.snapshot();
      } catch (err){
        console.warn('stats snapshot error', err);
      }
    }
    return {
      completedIds: new Set(),
      totals: { lessons: 0, lessonsCompleted: 0, unitsCompleted: 0 },
      areas: [],
      units: [],
      streak: { count: 0, lastDate: null },
      history: [],
    };
  }

  function getLessons(){
    if (window.MathBotLessons && typeof window.MathBotLessons.getLessons === 'function'){
      try { return window.MathBotLessons.getLessons() || []; } catch (err){ console.warn('stats lessons get error', err); }
    }
    return [];
  }

  function getAreasSummary(){
    if (window.MathBotLessons && typeof window.MathBotLessons.getAreaSummary === 'function'){
      try { return window.MathBotLessons.getAreaSummary() || []; } catch {}
    }
    return [];
  }

  function num(value){
    const n = Number(value);
    return Number.isFinite(n) ? n : 999;
  }

  function lessonNumberValue(text){
    if (!text) return 999;
    const clean = String(text).replace(/[^0-9.]/g, '');
    const value = Number(clean);
    return Number.isFinite(value) ? value : 999;
  }

  function compareLessons(a, b){
    return (num(a.unitNumero) - num(b.unitNumero))
      || (num(a.topicNumero) - num(b.topicNumero))
      || (lessonNumberValue(a.numero) - lessonNumberValue(b.numero))
      || (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
  }

  function pickPendingLesson(lessons, completedIds){
    if (!lessons.length) return null;
    const set = completedIds instanceof Set ? completedIds : new Set();
    const pending = lessons.filter(lesson => !set.has(lesson.id));
    if (!pending.length) return null;
    pending.sort(compareLessons);
    return pending[0];
  }

  function formatLessonLabel(lesson){
    if (!lesson) return '';
    const code = lesson.numero ? `Leccion ${lesson.numero}` : 'Leccion';
    return `${code} - ${lesson.nombre}`;
  }

  function navigateToLesson(lesson){
    if (!lesson || !lesson.id) return;
    window.dispatchEvent(new CustomEvent('dashboard:open-lesson', { detail: { lessonId: lesson.id } }));
  }

  function renderSummary(){
    const lessons = getLessons();
    const snapshot = getSnapshot();
    lastSnapshot = { lessons, snapshot };

    if (!lessons.length){
      summaryEl.textContent = 'No hay lecciones registradas aun.';
      if (progressPill) progressPill.hidden = true;
      if (chartRetryHandle){
        window.clearTimeout(chartRetryHandle);
        chartRetryHandle = null;
      }
      if (charts.week){
        charts.week.destroy();
        charts.week = null;
      }
      if (charts.areas){
        charts.areas.destroy();
        charts.areas = null;
      }
      if (recommendationsWrap) recommendationsWrap.innerHTML = '';
      return;
    }

    const total = lessons.length;
    const completed = snapshot.totals?.lessonsCompleted || 0;
    const pending = Math.max(total - completed, 0);
    summaryEl.textContent = `Tienes ${completed} de ${total} lecciones completadas y ${pending} pendientes.`;
    if (progressPill){
      progressPill.hidden = false;
      progressPill.textContent = `${snapshot.totals?.unitsCompleted || 0} unidades completadas`;
    }

    if (lessonsCompleteEl) lessonsCompleteEl.textContent = String(completed);
    if (lessonsTotalEl) lessonsTotalEl.textContent = String(total);
    if (lessonProgressBar){
      const pct = total ? Math.min(100, (completed / total) * 100) : 0;
      lessonProgressBar.style.width = `${pct.toFixed(2)}%`;
    }

    if (unitsEl){
      const unitsCompleted = snapshot.totals?.unitsCompleted || 0;
      unitsEl.textContent = String(unitsCompleted);
    }

    if (nextUnitEl){
      const units = snapshot.units || [];
      const next = units.find(u => u.total > 0 && u.completed < u.total);
      if (next){
        const remaining = next.total - next.completed;
        nextUnitEl.textContent = `Completa ${remaining} leccion(es) para dominar la unidad ${next.numero || ''} ${next.titulo || ''}`;
      } else {
        nextUnitEl.textContent = 'Todas las unidades registradas estan completas.';
      }
    }

    if (streakEl){
      const streak = snapshot.streak?.count || 0;
      streakEl.textContent = String(streak);
    }

    if (lastActivityEl){
      const last = snapshot.streak?.lastDate;
      lastActivityEl.textContent = last ? `Ultimo registro: ${last}` : 'Aun no has registrado actividad.';
    }

    if (recommendationsWrap){
      renderRecommendations(lessons, snapshot);
    }

    const nextLesson = pickPendingLesson(lessons, snapshot.completedIds);
    if (nextLessonBtn){
      nextLessonBtn.disabled = !nextLesson;
      nextLessonBtn.onclick = nextLesson ? () => navigateToLesson(nextLesson) : null;
    }
    if (nextLessonDetail){
      nextLessonDetail.textContent = nextLesson ? formatLessonLabel(nextLesson) : 'Sin lecciones pendientes.';
    }

    renderCharts(snapshot);
  }

    function renderRecommendations(lessons, snapshot){
    if (!recommendationsWrap) return;
    const completed = snapshot.completedIds instanceof Set ? snapshot.completedIds : new Set();
    const pending = lessons.filter(lesson => !completed.has(lesson.id));
    pending.sort(compareLessons);
    const top = pending.slice(0, 3);
    recommendationsWrap.innerHTML = '';
    if (!top.length){
      const msg = document.createElement('p');
      msg.textContent = 'Todas tus lecciones estan completadas. Excelente trabajo.';
      recommendationsWrap.appendChild(msg);
      return;
    }
    top.forEach(lesson => {
      const card = document.createElement('article');
      card.className = 'recommendation-card';
      const title = document.createElement('h4');
      title.textContent = formatLessonLabel(lesson);
      const desc = document.createElement('p');
      desc.textContent = lesson.preview || 'Repasa esta leccion para consolidar tus habilidades.';
      const actions = document.createElement('div');
      actions.className = 'actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = 'Abrir leccion';
      btn.addEventListener('click', () => navigateToLesson(lesson));
      actions.appendChild(btn);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(actions);
      recommendationsWrap.appendChild(card);
    });
  }

  function renderCharts(snapshot){
    if (!snapshot) return;
    if (!window.Chart){
      if (!chartRetryHandle){
        chartRetryHandle = window.setTimeout(() => {
          chartRetryHandle = null;
          renderCharts(lastSnapshot?.snapshot || snapshot);
        }, 250);
      }
      return;
    }
    if (chartRetryHandle){
      window.clearTimeout(chartRetryHandle);
      chartRetryHandle = null;
    }
    renderWeekChart(snapshot);
    renderAreaChart(snapshot);
  }

  function renderWeekChart(snapshot){
    if (!weekCanvas) return;
    if (charts.week && charts.week.canvas !== weekCanvas) {
      charts.week.destroy();
      charts.week = null;
    }
    const history = (window.MathBotProgress && typeof window.MathBotProgress.getRecentActivity === 'function')
      ? window.MathBotProgress.getRecentActivity(7)
      : [];
    const labels = history.map(item => formatDay(item.day));
    const values = history.map(item => item.value);
    if (!charts.week){
      charts.week = new Chart(weekCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Lecciones completadas',
            data: values,
            backgroundColor: 'rgba(236,72,153,0.35)',
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
        },
      });
    } else {
      charts.week.data.labels = labels;
      charts.week.data.datasets[0].data = values;
      charts.week.update();
    }
  }

  function renderAreaChart(snapshot){
    if (!areasCanvas) return;
    if (charts.areas && charts.areas.canvas !== areasCanvas) {
      charts.areas.destroy();
      charts.areas = null;
    }
    const areas = snapshot.areas || [];
    const labels = areas.map(item => item.label || item.key);
    const completed = areas.map(item => item.completed || 0);
    const pending = areas.map((item, index) => {
      const total = item.total !== undefined ? item.total : (completed[index] || 0);
      return Math.max(total - (completed[index] || 0), 0);
    });

    if (!charts.areas){
      charts.areas = new Chart(areasCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Completadas',
              data: completed,
              backgroundColor: 'rgba(59,130,246,0.6)',
            },
            {
              label: 'Pendientes',
              data: pending,
              backgroundColor: 'rgba(148,163,184,0.45)',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
        },
      });
    } else {
      charts.areas.data.labels = labels;
      charts.areas.data.datasets[0].data = completed;
      charts.areas.data.datasets[1].data = pending;
      charts.areas.update();
    }
  }

  function formatDay(day){
    if (!day) return '';
    try {
      const date = new Date(day);
      if (Number.isNaN(date.getTime())) return day;
      return date.toLocaleDateString('es-ES', { weekday: 'short' });
    } catch {
      return day;
    }
  }

  function init(){
    if (window.MathBotLessons && typeof window.MathBotLessons.ready === 'function'){
      window.MathBotLessons.ready().then(renderSummary).catch(() => {
        summaryEl.textContent = 'No se pudo cargar la informacion de lecciones.';
      });
    } else {
      renderSummary();
    }

    if (typeof unsubscribeProgress === 'function') {
      unsubscribeProgress();
      unsubscribeProgress = null;
    }
    if (window.MathBotProgress && typeof window.MathBotProgress.subscribe === 'function') {
      unsubscribeProgress = window.MathBotProgress.subscribe(() => renderSummary());
    }

    if (nextLessonBtn){
      nextLessonBtn.addEventListener('click', () => {
        const lesson = pickPendingLesson(getLessons(), getSnapshot().completedIds || new Set());
        if (lesson) navigateToLesson(lesson);
      });
    }
  }

  init();
};





