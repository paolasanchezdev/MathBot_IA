// achievements.js
window.initAchievementsSection = function(){
  const cssHref = '../achievements/achievements.css';
  if (!document.querySelector(`link[data-achievements-css="true"][href$="${cssHref}"]`)){
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    link.dataset.achievementsCss = 'true';
    document.head.appendChild(link);
  }

  const summaryEl = document.getElementById('achievements-summary');
  const progressPill = document.getElementById('achievements-progress');
  const listEl = document.getElementById('achievements-list');
  const unitsEl = document.getElementById('achievements-units');
  const actionsEl = document.getElementById('achievements-actions');

  const achievementsDefs = [
    {
      id: 'first-lesson',
      title: 'Primer paso',
      description: 'Completa tu primera leccion.',
      goal: 1,
      getValue: snapshot => snapshot.totals?.lessonsCompleted || 0,
    },
    {
      id: 'collector',
      title: 'Coleccionista',
      description: 'Completa 5 lecciones diferentes.',
      goal: 5,
      getValue: snapshot => snapshot.totals?.lessonsCompleted || 0,
    },
    {
      id: 'streak-3',
      title: 'Habito activado',
      description: 'Mantiene una racha de estudio de 3 dias.',
      goal: 3,
      getValue: snapshot => snapshot.streak?.count || 0,
    },
  ];

  let unsubscribeProgress = null;


  function getLessons(){
    if (window.MathBotLessons && typeof window.MathBotLessons.getLessons === 'function'){
      try { return window.MathBotLessons.getLessons() || []; } catch {}
    }
    return [];
  }

  function getUnits(){
    if (window.MathBotLessons && typeof window.MathBotLessons.getUnits === 'function'){
      try { return window.MathBotLessons.getUnits() || []; } catch {}
    }
    return [];
  }

  function getSnapshot(){
    if (window.MathBotProgress && typeof window.MathBotProgress.snapshot === 'function'){
      try { return window.MathBotProgress.snapshot(); } catch (err){ console.warn('achievements snapshot error', err); }
    }
    return {
      completedIds: new Set(),
      totals: { lessonsCompleted: 0, lessons: 0 },
      areas: [],
      units: [],
      streak: { count: 0 },
      history: [],
    };
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

  function formatLessonLabel(lesson){
    if (!lesson) return '';
    const code = lesson.numero ? `Leccion ${lesson.numero}` : 'Leccion';
    return `${code} - ${lesson.nombre}`;
  }

  function navigateToLesson(lesson){
    if (!lesson || !lesson.id) return;
    window.dispatchEvent(new CustomEvent('dashboard:open-lesson', { detail: { lessonId: lesson.id } }));
  }

  function buildDynamicAchievements(snapshot, lessons, unitsCatalog){
    const dynamic = [];
    const pendingLesson = pickNextLesson(lessons, snapshot.completedIds);
    if (pendingLesson){
      dynamic.push({
        id: 'next-lesson',
        title: 'Constancia',
        description: 'Completa la siguiente leccion recomendada para seguir avanzando.',
        goal: 1,
        value: 0,
        completed: false,
        lesson: pendingLesson,
      });
    }

    const unitsProgress = snapshot.units || [];
    const nextUnit = unitsProgress.find(u => u.total > 0 && u.completed < u.total);
    if (nextUnit){
      const catalog = unitsCatalog.find(unit => unit.id === nextUnit.id);
      const catalogTitle = catalog ? [catalog.numero, catalog.titulo].filter(Boolean).join(' - ') : '';
      dynamic.push({
        id: `unit-${nextUnit.id}`,
        title: catalogTitle ? `Unidad ${catalogTitle}` : `Unidad ${nextUnit.numero || ''}`,
        description: 'Termina todas las lecciones de esta unidad.',
        goal: nextUnit.total,
        value: nextUnit.completed,
        completed: nextUnit.completed >= nextUnit.total,
        lesson: pickNextLesson(lessons.filter(l => l.unitId === nextUnit.id), snapshot.completedIds),
      });
    }

    return dynamic;
  }

  function pickNextLesson(lessons, completed){
    if (!lessons || !lessons.length) return null;
    const completedIds = completed instanceof Set ? completed : new Set();
    const pending = lessons.filter(lesson => !completedIds.has(lesson.id));
    if (!pending.length) return null;
    pending.sort(compareLessons);
    return pending[0];
  }

  function renderAchievements(){
    if (!summaryEl || !listEl || !unitsEl || !actionsEl) return;
    const lessons = getLessons();
    const unitsCatalog = getUnits();
    if (!lessons.length){
      summaryEl.textContent = 'No hay lecciones disponibles todavia.';
      listEl.innerHTML = '';
      unitsEl.innerHTML = '';
      actionsEl.innerHTML = '';
      if (progressPill) progressPill.hidden = true;
      return;
    }
    const snapshot = getSnapshot();
    const staticAchievements = achievementsDefs.map(def => {
      const value = typeof def.getValue === 'function' ? def.getValue(snapshot) : 0;
      return {
        id: def.id,
        title: def.title,
        description: def.description,
        goal: def.goal,
        value,
        completed: value >= def.goal,
      };
    });
    const achievements = staticAchievements.concat(buildDynamicAchievements(snapshot, lessons, unitsCatalog));
    const completedCount = achievements.filter(item => item.completed).length;
    if (progressPill){
      progressPill.hidden = false;
      progressPill.textContent = `${completedCount}/${achievements.length} logros completados`;
    }
    summaryEl.textContent = `Haz completado ${snapshot.totals?.lessonsCompleted || 0} de ${lessons.length} lecciones.`;
    renderAchievementsList(achievements);
    renderUnits(unitsCatalog, snapshot);
    renderActions(lessons, snapshot);
  }

  function renderAchievementsList(items){
    if (!listEl) return;
    listEl.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'achievement-card';
      if (item.completed) card.classList.add('completed');
      const title = document.createElement('h3');
      title.textContent = item.title;
      const desc = document.createElement('p');
      desc.textContent = item.description;
      const progressWrap = document.createElement('div');
      progressWrap.className = 'progress-line';
      const bar = document.createElement('span');
      const pct = item.goal ? Math.min(100, (item.value / item.goal) * 100) : 0;
      bar.style.width = `${pct.toFixed(2)}%`;
      progressWrap.appendChild(bar);
      const badge = document.createElement('span');
      badge.className = 'badge';
      if (item.completed){
        badge.classList.add('completed');
        badge.textContent = 'Completado';
      } else {
        const remaining = Math.max(item.goal - item.value, 0);
        badge.textContent = `${remaining} por completar`;
      }
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(progressWrap);
      card.appendChild(badge);
      if (!item.completed && item.lesson){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link-btn';
        btn.textContent = `Ir a ${formatLessonLabel(item.lesson)}`;
        btn.addEventListener('click', () => navigateToLesson(item.lesson));
        card.appendChild(btn);
      }
      listEl.appendChild(card);
    });
  }

  function renderUnits(unitsCatalog, snapshot){
    if (!unitsEl) return;
    unitsEl.innerHTML = '';
    const unitsProgress = snapshot.units || [];
    if (!unitsProgress.length){
      unitsEl.innerHTML = '<p>Todavia no hay avance registrado por unidad.</p>';
      return;
    }
    unitsProgress.sort((a, b) => num(a.numero) - num(b.numero));
    unitsProgress.forEach(unit => {
      const card = document.createElement('article');
      card.className = 'unit-card';
      const title = document.createElement('h4');
      const catalog = unitsCatalog.find(item => item.id === unit.id);
      const catalogTitle = catalog ? [catalog.numero, catalog.titulo].filter(Boolean).join(' - ') : '';
      title.textContent = catalogTitle ? `Unidad ${catalogTitle}` : `Unidad ${unit.numero || ''}`;
      const meta = document.createElement('div');
      meta.className = 'meta';
      const completed = unit.completed || 0;
      const total = unit.total || 0;
      meta.textContent = `${completed}/${total} lecciones completadas`;
      const progress = document.createElement('div');
      progress.className = 'progress-line';
      const bar = document.createElement('span');
      const pct = total ? Math.min(100, (completed / total) * 100) : 0;
      bar.style.width = `${pct.toFixed(2)}%`;
      progress.appendChild(bar);
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(progress);
      unitsEl.appendChild(card);
    });
  }

  function renderActions(lessons, snapshot){
    if (!actionsEl) return;
    actionsEl.innerHTML = '';
    const completed = snapshot.completedIds instanceof Set ? snapshot.completedIds : new Set();
    const pending = lessons.filter(lesson => !completed.has(lesson.id));
    if (!pending.length){
      const msg = document.createElement('p');
      msg.textContent = 'No quedan lecciones pendientes. ¡Gran trabajo!';
      actionsEl.appendChild(msg);
      return;
    }
    pending.sort(compareLessons);
    pending.slice(0, 4).forEach(lesson => {
      const card = document.createElement('article');
      card.className = 'action-card';
      const title = document.createElement('h4');
      title.textContent = formatLessonLabel(lesson);
      const desc = document.createElement('p');
      desc.textContent = lesson.preview || 'Marca esta leccion cuando la completes.';
      const actionRow = document.createElement('div');
      actionRow.className = 'action-row';
      const label = document.createElement('label');
      label.className = 'toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      checkbox.addEventListener('change', () => {
        if (window.MathBotProgress && typeof window.MathBotProgress.markLesson === 'function'){
          window.MathBotProgress.markLesson(lesson.id, { completed: checkbox.checked });
        } else {
          window.dispatchEvent(new CustomEvent('lessons:completed', { detail: { lessonId: lesson.id, completed: checkbox.checked } }));
        }
      });
      label.appendChild(checkbox);
      const span = document.createElement('span');
      span.textContent = 'Marcar completada';
      label.appendChild(span);
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn-ghost';
      openBtn.textContent = 'Abrir';
      openBtn.addEventListener('click', () => navigateToLesson(lesson));
      actionRow.appendChild(label);
      actionRow.appendChild(openBtn);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(actionRow);
      actionsEl.appendChild(card);
    });
  }

  function init(){
    if (window.MathBotLessons && typeof window.MathBotLessons.ready === 'function'){
      window.MathBotLessons.ready().then(renderAchievements).catch(() => {
        summaryEl.textContent = 'No se pudieron cargar los logros.';
      });
    } else {
      renderAchievements();
    }

    if (typeof unsubscribeProgress === 'function') {
      unsubscribeProgress();
      unsubscribeProgress = null;
    }
    if (window.MathBotProgress && typeof window.MathBotProgress.subscribe === 'function') {
      unsubscribeProgress = window.MathBotProgress.subscribe(renderAchievements);
    }
  }

  init();
};

