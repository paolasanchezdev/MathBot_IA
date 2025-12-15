(function(){
  const STORAGE_KEY = 'mb_lessons_progress_v1';
  const CURRENT_VERSION = 2;
  const MAX_HISTORY = 400;
  const MAX_SESSIONS = 120;
  const MAX_SESSION_MINUTES = 180;

  const subscribers = new Set();
  let state = loadState();

  function defaultStudyState(){
    return {
      totalMinutes: 0,
      minutesByDay: {},
      sessions: [],
      lastSession: null,
    };
  }

  function defaultState(){
    return {
      version: CURRENT_VERSION,
      completed: {},
      opened: {},
      history: [],
      active: {},
      study: defaultStudyState(),
    };
  }

  function ensureStudyShape(obj){
    if (!obj || typeof obj !== 'object') {
      return defaultStudyState();
    }
    obj.totalMinutes = Number.isFinite(obj.totalMinutes) ? obj.totalMinutes : 0;
    obj.minutesByDay = obj.minutesByDay && typeof obj.minutesByDay === 'object' ? obj.minutesByDay : {};
    obj.sessions = Array.isArray(obj.sessions) ? obj.sessions : [];
    obj.lastSession = obj.lastSession && typeof obj.lastSession === 'object' ? obj.lastSession : null;
    return obj;
  }

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaultState();
      parsed.version = Number.isFinite(parsed.version) ? parsed.version : 1;
      parsed.completed = parsed.completed || {};
      parsed.opened = parsed.opened || {};
      parsed.history = Array.isArray(parsed.history) ? parsed.history : [];
      parsed.active = parsed.active && typeof parsed.active === 'object' ? parsed.active : {};
      parsed.study = ensureStudyShape(parsed.study);
      if (parsed.version < CURRENT_VERSION){
        parsed.version = CURRENT_VERSION;
      }
      return parsed;
    } catch (err) {
      console.warn('MathBotProgress loadState failed', err);
      return defaultState();
    }
  }

  function persist(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('MathBotProgress persist failed', err);
    }
  }

  function emit(reason, detail){
    subscribers.forEach(fn => {
      try {
        fn({ reason, detail });
      } catch (err) {
        console.error('MathBotProgress subscriber error', err);
      }
    });
  }

  function trimHistory(){
    if (state.history.length > MAX_HISTORY){
      state.history.splice(0, state.history.length - MAX_HISTORY);
    }
  }

  function registerHistory(event){
    if (!event || typeof event !== 'object') return;
    state.history.push(event);
    trimHistory();
  }

  function computeSessionMinutes(startIso, endIso){
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start){
      return 0;
    }
    const rawMinutes = Math.round((end - start) / 60000);
    return Math.min(MAX_SESSION_MINUTES, Math.max(1, rawMinutes));
  }

  function recordStudySession(lessonId, startedAt, endedAt){
    const minutes = computeSessionMinutes(startedAt, endedAt);
    if (!minutes) return;
    const entry = {
      lessonId,
      startedAt,
      endedAt,
      minutes,
    };
    const study = state.study;
    study.totalMinutes = (study.totalMinutes || 0) + minutes;
    const dayKey = endedAt.slice(0, 10);
    study.minutesByDay[dayKey] = (study.minutesByDay[dayKey] || 0) + minutes;
    study.sessions.push(entry);
    if (study.sessions.length > MAX_SESSIONS){
      study.sessions.splice(0, study.sessions.length - MAX_SESSIONS);
    }
    study.lastSession = entry;
    registerHistory({ type: 'study', lessonId, minutes, ts: endedAt });
  }

  function finalizeActiveSession(id, completedTs){
    const active = state.active[id];
    const openedTs = state.opened[id];
    const startedAt = active && active.startedAt ? active.startedAt : openedTs;
    if (startedAt){
      recordStudySession(id, startedAt, completedTs);
    }
    if (state.active[id]) delete state.active[id];
  }

  function markLesson(lessonId, options){
    const opts = options || {};
    const id = Number(lessonId);
    if (!id) return;
    const completed = opts.completed !== false;
    const ts = opts.timestamp || new Date().toISOString();
    const already = !!state.completed[id];

    if (completed){
      if (already && !opts.force) return;
      state.completed[id] = ts;
      registerHistory({ type: 'completed', lessonId: id, ts });
      finalizeActiveSession(id, ts);
      persist();
      emit('lesson-completed', { lessonId: id, timestamp: ts });
    } else {
      if (!already) return;
      delete state.completed[id];
      registerHistory({ type: 'uncompleted', lessonId: id, ts });
      if (state.active[id]) delete state.active[id];
      persist();
      emit('lesson-uncompleted', { lessonId: id, timestamp: ts });
    }
  }

  function toggleLesson(lessonId){
    const id = Number(lessonId);
    if (!id) return;
    const completed = !!state.completed[id];
    markLesson(id, { completed: !completed, force: true });
  }

  function touchLesson(lessonId){
    const id = Number(lessonId);
    if (!id) return;
    const ts = new Date().toISOString();
    state.opened[id] = ts;
    state.active[id] = { startedAt: ts };
    registerHistory({ type: 'opened', lessonId: id, ts });
    persist();
    emit('lesson-opened', { lessonId: id, timestamp: ts });
  }

  function isCompleted(lessonId){
    const id = Number(lessonId);
    if (!id) return false;
    return !!state.completed[id];
  }

  function computeStudySnapshot(){
    const study = state.study;
    const minutesByDay = Object.assign({}, study.minutesByDay || {});
    const sessions = Array.isArray(study.sessions) ? study.sessions.slice(-10) : [];

    const today = new Date();
    const lastSevenDays = [];
    for (let offset = 6; offset >= 0; offset -= 1){
      const cursor = new Date(today);
      cursor.setHours(0,0,0,0);
      cursor.setDate(today.getDate() - offset);
      const key = cursor.toISOString().slice(0, 10);
      lastSevenDays.push({ day: key, minutes: minutesByDay[key] || 0 });
    }

    let thisWeek = 0;
    lastSevenDays.forEach(item => { thisWeek += item.minutes || 0; });

    return {
      totalMinutes: study.totalMinutes || 0,
      minutesByDay,
      lastSevenDays,
      thisWeekMinutes: thisWeek,
      sessions,
      lastSession: study.lastSession || null,
    };
  }

  function computeSnapshot(){
    const lessons = window.MathBotLessons && window.MathBotLessons.getLessons ? window.MathBotLessons.getLessons() : [];
    const completedIds = new Set(Object.keys(state.completed).map(key => Number(key)));

    const areaMap = new Map();
    const unitMap = new Map();

    lessons.forEach(lesson => {
      const areaEntry = areaMap.get(lesson.areaKey) || {
        key: lesson.areaKey,
        label: lesson.areaLabel,
        total: 0,
        completed: 0,
      };
      areaEntry.total += 1;
      if (completedIds.has(lesson.id)) areaEntry.completed += 1;
      areaMap.set(lesson.areaKey, areaEntry);

      const unitEntry = unitMap.get(lesson.unitId) || {
        id: lesson.unitId,
        titulo: lesson.unitTitulo,
        numero: lesson.unitNumero,
        areaKey: lesson.areaKey,
        areaLabel: lesson.areaLabel,
        total: 0,
        completed: 0,
      };
      unitEntry.total += 1;
      if (completedIds.has(lesson.id)) unitEntry.completed += 1;
      unitMap.set(lesson.unitId, unitEntry);
    });

    const totals = {
      lessons: lessons.length,
      lessonsCompleted: completedIds.size,
      unitsCompleted: Array.from(unitMap.values()).filter(u => u.total > 0 && u.completed >= u.total).length,
      areasCompleted: Array.from(areaMap.values()).filter(a => a.total > 0 && a.completed >= a.total).length,
    };

    const streak = computeStreak();
    const study = computeStudySnapshot();

    return {
      completedIds,
      totals,
      areas: Array.from(areaMap.values()),
      units: Array.from(unitMap.values()),
      streak,
      history: state.history.slice(),
      study,
    };
  }

  function computeStreak(){
    const daySet = new Set();
    state.history.forEach(event => {
      if (event.type === 'completed' && typeof event.ts === 'string'){
        daySet.add(event.ts.slice(0, 10));
      }
    });
    if (!daySet.size){
      return { count: 0, lastDate: null };
    }

    const today = new Date();
    let count = 0;
    for (let offset = 0; offset < 365; offset += 1){
      const cursor = new Date(today);
      cursor.setHours(0,0,0,0);
      cursor.setDate(today.getDate() - offset);
      const key = cursor.toISOString().slice(0, 10);
      if (daySet.has(key)){
        count += 1;
      } else {
        if (offset === 0) {
          count = 0;
        }
        break;
      }
    }

    const lastDate = Array.from(daySet).sort().pop() || null;
    return { count, lastDate };
  }

  function getRecentActivity(days){
    const range = Number.isFinite(days) && days > 0 ? Math.floor(days) : 7;
    const counts = new Map();
    state.history.forEach(event => {
      if (event.type === 'completed' && typeof event.ts === 'string'){
        const key = event.ts.slice(0, 10);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });

    const today = new Date();
    const result = [];
    for (let offset = range - 1; offset >= 0; offset -= 1){
      const cursor = new Date(today);
      cursor.setHours(0,0,0,0);
      cursor.setDate(today.getDate() - offset);
      const key = cursor.toISOString().slice(0, 10);
      result.push({ day: key, value: counts.get(key) || 0 });
    }
    return result;
  }

  function subscribe(fn){
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  window.MathBotProgress = {
    snapshot: computeSnapshot,
    getRecentActivity,
    markLesson,
    toggleLesson,
    touchLesson,
    isCompleted,
    subscribe,
  };

  window.addEventListener('lessons:completed', event => {
    const detail = event && event.detail ? event.detail : {};
    if (!detail.lessonId) return;
    const completed = detail.completed !== false;
    markLesson(detail.lessonId, { completed, force: true });
  });

  window.addEventListener('lessons:opened', event => {
    const detail = event && event.detail ? event.detail : {};
    if (!detail.lessonId) return;
    touchLesson(detail.lessonId);
  });
})();
