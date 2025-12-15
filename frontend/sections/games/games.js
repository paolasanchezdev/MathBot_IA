(function(){
  const QUIZ_QUESTIONS = 5;
  const QUIZ_OPTIONS = 4;
  const EXAM_THEORY_COUNT = 3;
  const EXAM_PRACTICE_COUNT = 3;
  const EXAM_TOTAL = EXAM_THEORY_COUNT + EXAM_PRACTICE_COUNT;

  let cachedLessons = [];
  let areaMap = new Map();
  let quickModule = null;
  let quizModule = null;
  let examModule = null;

  function formatMinutes(value){
    const total = Math.max(0, Math.round(value || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours && mins) return `${hours}h ${mins}m`;
    if (hours) return `${hours}h`;
    return `${mins}m`;
  }

  function injectCssOnce(href){
    if (document.querySelector(`link[data-games-css="true"][href$="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.gamesCss = 'true';
    document.head.appendChild(link);
  }

  function ensureLessonsData(){
    if (cachedLessons.length){
      updateSummaryUI();
      return Promise.resolve(cachedLessons);
    }
    if (!window.MathBotLessons || typeof window.MathBotLessons.ready !== 'function'){
      updateSummaryUI(true);
      return Promise.resolve([]);
    }
    return window.MathBotLessons.ready()
      .then(() => {
        cachedLessons = window.MathBotLessons.getLessons ? window.MathBotLessons.getLessons() : [];
        buildAreaMap();
        updateSummaryUI();
        quickModule?.setLessons(cachedLessons);
        quizModule?.setLessons(cachedLessons, areaMap);
        examModule?.setLessons(cachedLessons, areaMap);
        return cachedLessons;
      })
      .catch(err => {
        console.warn('games lessons fetch error', err);
        updateSummaryUI(true);
        return [];
      });
  }


  function buildAreaMap(){
    areaMap = new Map();
    cachedLessons.forEach(lesson => {
      const key = lesson.areaKey || 'sin-area';
      const entry = areaMap.get(key) || {
        key,
        label: lesson.areaLabel || 'Sin area',
        lessons: [],
      };
      entry.lessons.push(lesson);
      areaMap.set(key, entry);
    });
  }

  function getProgressSnapshot(){
    try {
      if (window.MathBotProgress && typeof window.MathBotProgress.snapshot === 'function'){
        return window.MathBotProgress.snapshot();
      }
    } catch (err){
      console.warn('games progress snapshot error', err);
    }
    return null;
  }

  function updateSummaryUI(hasError){
    const summaryEl = document.getElementById('games-summary');
    const progressEl = document.getElementById('games-progress');
    const tagEl = document.getElementById('games-tag');
    if (!summaryEl) return;
    if (hasError){
      summaryEl.textContent = 'No pudimos cargar tus lecciones en este momento.';
      if (progressEl) progressEl.hidden = true;
      return;
    }
    if (!cachedLessons.length){
      summaryEl.textContent = 'Cargando datos de tus lecciones...';
      if (progressEl) progressEl.hidden = true;
      return;
    }
    const snapshot = getProgressSnapshot();
    const completedCount = snapshot && snapshot.totals ? snapshot.totals.lessonsCompleted || 0 : 0;
    const total = cachedLessons.length;
    const studyMinutes = snapshot && snapshot.study ? (snapshot.study.thisWeekMinutes || snapshot.study.totalMinutes || 0) : 0;
    const studyMessage = studyMinutes
      ? `Has estudiado ${formatMinutes(studyMinutes)} esta semana.`
      : 'Activa tu racha con un reto rapido.';
    summaryEl.textContent = `Basamos estos retos en ${total} lecciones activas. ${studyMessage}`;
    if (progressEl){
      progressEl.hidden = false;
      const base = `${completedCount}/${total} lecciones completadas`;
      progressEl.textContent = studyMinutes ? `${base} - ${formatMinutes(studyMinutes)} esta semana` : base;
    }
    if (tagEl){
      const areas = areaMap.size || 1;
      const label = areas > 1 ? 'Entrenamiento adaptativo por area' : 'Entrenamiento adaptativo';
      tagEl.textContent = studyMinutes >= 120 ? `${label} - modo experto` : `${label}`;
    }
  }

  function num(value){
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : 999;
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

  function pickPendingLesson(){
    if (!cachedLessons.length) return null;
    const snapshot = getProgressSnapshot();
    const completed = snapshot && snapshot.completedIds instanceof Set ? snapshot.completedIds : new Set();
    const pending = cachedLessons.filter(lesson => !completed.has(lesson.id));
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

  function shuffle(items){
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i -= 1){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function takeRandom(items, count){
    return shuffle(items).slice(0, count);
  }

  function confettiBurst(container, count){
    if (!container) return;
    const colors = ['var(--rojo)', 'var(--rosa)', 'var(--naranja)', 'var(--violeta)'];
    const total = count || 14;
    const rect = container.getBoundingClientRect();
    for (let i = 0; i < total; i += 1){
      const piece = document.createElement('div');
      piece.className = 'confetti';
      piece.style.background = colors[i % colors.length];
      const x = `${Math.random() * 200 - 100}px`;
      const r = `${Math.floor(Math.random() * 360)}deg`;
      piece.style.setProperty('--x', x);
      piece.style.setProperty('--r', r);
      piece.style.left = `${rect.width / 2}px`;
      piece.style.animation = 'fall .9s ease-out forwards';
      container.appendChild(piece);
      setTimeout(() => piece.remove(), 950);
    }
  }

  function getAreaLabel(areaKey){
    if (areaKey === 'all') return 'todas las areas';
    const entry = areaMap.get(areaKey);
    return entry ? entry.label : areaKey;
  }
  function QuickMath(card){
    if (!card) return null;
    const startBtn = card.querySelector('#qm-start');
    const bestEl = card.querySelector('#qm-best');
    const areaWrap = card.querySelector('#qm-area');
    const timeEl = card.querySelector('#qm-time');
    const scoreEl = card.querySelector('#qm-score');
    const questionEl = card.querySelector('#qm-question');
    const form = card.querySelector('#qm-form');
    const answerInput = card.querySelector('#qm-answer');
    const feedbackEl = card.querySelector('#qm-feedback');
    const timerWrap = card.querySelector('#qm-timer');
    const timerBar = card.querySelector('#qm-timer-bar');
    const streakWrap = card.querySelector('#qm-streak');
    const streakVal = card.querySelector('#qm-streak-val');
    const recommendWrap = card.querySelector('#qm-recommend');
    const recommendBtn = card.querySelector('#qm-go-lesson');
    const resultsWrap = card.querySelector('#qm-results');
    const resultTitle = card.querySelector('#qm-result-title');
    const resultScore = card.querySelector('#qm-result-score');
    const resultBest = card.querySelector('#qm-result-best');
    const resultReplay = card.querySelector('#qm-results-retry');
    const resultClose = card.querySelector('#qm-results-close');

    let raf = null;
    let duration = 60;
    let remaining = 60;
    let score = 0;
    let streak = 0;
    let currentAnswer = 0;
    let startTs = 0;
    let recommendedLesson = null;
    let weekMinutesSnapshot = 0;

    function getBest(){
      try {
        return parseInt(localStorage.getItem('mb_qm_best') || '0', 10) || 0;
      } catch {
        return 0;
      }
    }

    function setBest(value){
      try {
        localStorage.setItem('mb_qm_best', String(value));
      } catch {}
    }

    function determineDuration(){
      const snapshot = getProgressSnapshot();
      const study = snapshot && snapshot.study ? snapshot.study : {};
      weekMinutesSnapshot = study.thisWeekMinutes || 0;
      if (weekMinutesSnapshot >= 180) return 90;
      if (weekMinutesSnapshot >= 120) return 75;
      if (weekMinutesSnapshot >= 60) return 60;
      return 45;
    }

    function rand(min, max){
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function pickOp(){
      const progress = 1 - Math.max(0, Math.min(1, remaining / duration));
      if (progress < 0.33) return ['+', '-'][rand(0, 1)];
      if (progress < 0.66) return ['+', '-', 'x'][rand(0, 2)];
      return ['+', '-', 'x', '/'][rand(0, 3)];
    }

    function makeQuestion(){
      const op = pickOp();
      let a = rand(3, 20);
      let b = rand(3, 20);
      if (op === 'x'){
        currentAnswer = a * b;
      } else if (op === '/'){
        currentAnswer = a;
        b = rand(2, 12);
        a = a * b;
      } else if (op === '+'){
        currentAnswer = a + b;
      } else {
        if (a < b) [a, b] = [b, a];
        currentAnswer = a - b;
      }
      questionEl.textContent = `${a} ${op} ${b} = ?`;
      answerInput.value = '';
      answerInput.focus();
    }

    function updateTimer(){
      const now = performance.now();
      const elapsed = (now - startTs) / 1000;
      remaining = Math.max(0, duration - elapsed);
      timeEl.textContent = String(Math.ceil(remaining));
      const pct = Math.max(0, Math.min(1, remaining / duration));
      if (timerBar) timerBar.style.width = `${(pct * 100).toFixed(2)}%`;
      if (remaining <= 0){
        finish();
        return;
      }
      raf = requestAnimationFrame(updateTimer);
    }

    function hideResults(){
      if (resultsWrap) resultsWrap.hidden = true;
    }

    function resetHud(){
      score = 0;
      streak = 0;
      scoreEl.textContent = '0';
      feedbackEl.textContent = '';
      feedbackEl.className = 'feedback muted';
      streakWrap.hidden = true;
      timeEl.textContent = String(duration);
      hideResults();
      if (recommendWrap) recommendWrap.hidden = true;
    }

    function updateRecommendation(){
      if (!recommendWrap || !recommendBtn) return;
      const nextLesson = pickPendingLesson();
      recommendedLesson = nextLesson;
      if (!nextLesson){
        recommendWrap.hidden = true;
        return;
      }
      recommendWrap.hidden = false;
      recommendBtn.textContent = formatLessonLabel(nextLesson);
    }

    function start(){
      ensureLessonsData().then(() => {
        duration = determineDuration();
        remaining = duration;
        resetHud();
        startBtn.disabled = true;
        startBtn.textContent = 'En curso...';
        areaWrap.hidden = false;
        timerWrap.hidden = false;
        startTs = performance.now();
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(updateTimer);
        makeQuestion();
      });
    }

    function finish(){
      if (raf){
        cancelAnimationFrame(raf);
        raf = null;
      }
      startBtn.disabled = false;
      startBtn.textContent = 'Iniciar';
      areaWrap.hidden = true;
      timerWrap.hidden = true;
      updateRecommendation();
      const bestPrev = getBest();
      const isRecord = score > bestPrev;
      if (isRecord){
        setBest(score);
        if (bestEl) bestEl.textContent = String(score);
        confettiBurst(card, 28);
      }
      if (resultsWrap){
        resultsWrap.hidden = false;
        if (resultTitle) resultTitle.textContent = isRecord ? 'Nuevo record' : 'Buen trabajo';
        if (resultScore) resultScore.textContent = String(score);
        if (resultBest) resultBest.textContent = String(Math.max(bestPrev, score));
      }
    }

    function handleCorrect(){
      score += 1;
      streak += 1;
      scoreEl.textContent = String(score);
      feedbackEl.textContent = 'Correcto';
      feedbackEl.className = 'feedback ok';
      card.classList.remove('shake');
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 260);
      if (streak >= 2){
        streakWrap.hidden = false;
        streakVal.textContent = String(streak);
      }
      confettiBurst(card, Math.min(12 + streak, 24));
      makeQuestion();
    }

    function handleMistake(){
      streak = 0;
      streakWrap.hidden = true;
      feedbackEl.textContent = 'Intenta de nuevo';
      feedbackEl.className = 'feedback err';
      card.classList.remove('flash');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 360);
    }

    function submit(evt){
      evt.preventDefault();
      const value = Number(answerInput.value);
      if (Number.isFinite(value) && Math.abs(value - currentAnswer) < 1e-9){
        handleCorrect();
      } else {
        handleMistake();
      }
    }

    function closeResults(){
      hideResults();
      startBtn.focus();
    }

    if (bestEl) bestEl.textContent = String(getBest());
    startBtn?.addEventListener('click', start);
    form?.addEventListener('submit', submit);
    recommendBtn?.addEventListener('click', () => {
      if (recommendedLesson) navigateToLesson(recommendedLesson);
    });
    resultReplay?.addEventListener('click', start);
    resultClose?.addEventListener('click', closeResults);

    return {
      setLessons(){ updateRecommendation(); },
      refreshRecommendation(){ updateRecommendation(); },
    };
  }
  function LessonQuiz(card){
    if (!card) return null;
    const startBtn = card.querySelector('#lq-start');
    const areaSelect = card.querySelector('#lq-area');
    const panel = card.querySelector('#lq-panel');
    const promptEl = card.querySelector('#lq-prompt');
    const optionsWrap = card.querySelector('#lq-options');
    const counterEl = card.querySelector('#lq-counter');
    const scoreEl = card.querySelector('#lq-score');
    const feedbackEl = card.querySelector('#lq-feedback');
    const summaryEl = card.querySelector('#lq-summary');
    const bestEl = card.querySelector('#lq-best');

    let areaEntries = [];
    let currentArea = 'all';
    let questionSet = [];
    let currentIndex = 0;
    let score = 0;
    let active = false;

    function getAreaLabelLocal(key){
      if (key === 'all') return 'todas las areas';
      const entry = areaEntries.find(item => item.key === key);
      return entry ? entry.label : key;
    }

    function getPoolForArea(key){
      if (key === 'all') return cachedLessons.slice();
      const entry = areaEntries.find(item => item.key === key);
      return entry ? entry.lessons.slice() : [];
    }

    function populateAreaSelect(){
      if (!areaSelect) return;
      const selected = areaSelect.value || currentArea || 'all';
      areaSelect.innerHTML = '';
      const optAll = document.createElement('option');
      optAll.value = 'all';
      optAll.textContent = `Todas las areas (${cachedLessons.length})`;
      areaSelect.appendChild(optAll);
      areaEntries.forEach(entry => {
        const option = document.createElement('option');
        option.value = entry.key;
        option.textContent = `${entry.label} (${entry.lessons.length})`;
        areaSelect.appendChild(option);
      });
      if (areaSelect.querySelector(`option[value="${selected}"]`)){
        areaSelect.value = selected;
      }
      currentArea = areaSelect.value || 'all';
      updateBestLabel();
    }

    function getBestKey(areaKey){
      return `mb_lq_best:${areaKey || 'all'}`;
    }

    function getBestValue(areaKey){
      try {
        return parseInt(localStorage.getItem(getBestKey(areaKey)), 10) || 0;
      } catch {
        return 0;
      }
    }

    function setBestValue(areaKey, value){
      try {
        localStorage.setItem(getBestKey(areaKey), String(value));
      } catch {}
    }

    function updateBestLabel(){
      if (!bestEl) return;
      bestEl.textContent = String(getBestValue(currentArea));
    }

    function createQuestion(lesson, areaKey){
      const areaPool = getPoolForArea(areaKey);
      const globalPool = cachedLessons.slice();
      const distractors = shuffle(areaPool.length > QUIZ_OPTIONS ? areaPool : globalPool);
      const options = [];
      const used = new Set([lesson.id]);
      options.push({ id: lesson.id, label: lesson.nombre, correct: true, lesson });
      for (let i = 0; i < distractors.length && options.length < QUIZ_OPTIONS; i += 1){
        const candidate = distractors[i];
        if (!candidate || used.has(candidate.id) || candidate.id === lesson.id) continue;
        used.add(candidate.id);
        options.push({ id: candidate.id, label: candidate.nombre, correct: false, lesson: candidate });
      }
      shuffle(options);
      const preview = (lesson.preview || '').trim();
      const prompt = preview
        ? `Que leccion corresponde a este resumen?\n"${preview.slice(0, 220)}${preview.length > 220 ? '...' : ''}"`
        : `Que leccion corresponde al tema ${lesson.topicNumero || ''} ${lesson.topicTitulo || ''}?`;
      return { lesson, prompt, options };
    }

    function buildQuestionSet(areaKey){
      const pool = getPoolForArea(areaKey);
      const source = pool.length ? pool : cachedLessons;
      const unique = shuffle(source);
      const total = Math.min(unique.length, QUIZ_QUESTIONS);
      const result = [];
      for (let i = 0; i < total; i += 1){
        result.push(createQuestion(unique[i], areaKey));
      }
      return result;
    }

    function renderQuestion(){
      if (!panel) return;
      const question = questionSet[currentIndex];
      if (!question){
        finish();
        return;
      }
      panel.hidden = false;
      summaryEl?.setAttribute('hidden', '');
      counterEl.textContent = String(currentIndex + 1);
      scoreEl.textContent = String(score);
      promptEl.textContent = question.prompt;
      feedbackEl.textContent = '';
      feedbackEl.className = 'quiz-feedback';
      optionsWrap.innerHTML = '';
      active = true;
      question.options.forEach(option => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = option.label;
        btn.addEventListener('click', () => handleAnswer(question, option, btn));
        optionsWrap.appendChild(btn);
      });
    }

    function handleAnswer(question, option, button){
      if (!active) return;
      active = false;
      const buttons = Array.from(optionsWrap.querySelectorAll('button'));
      buttons.forEach(btn => { btn.disabled = true; });
      if (option.correct){
        score += 1;
        scoreEl.textContent = String(score);
        button.classList.add('correct');
        feedbackEl.textContent = 'Correcto';
        feedbackEl.className = 'quiz-feedback ok';
      } else {
        button.classList.add('wrong');
        const correctBtn = buttons.find(btn => btn.textContent === question.options.find(opt => opt.correct).label);
        correctBtn?.classList.add('correct');
        feedbackEl.textContent = 'Respuesta incorrecta';
        feedbackEl.className = 'quiz-feedback err';
      }
      setTimeout(() => {
        currentIndex += 1;
        renderQuestion();
      }, 750);
    }

    function finish(){
      panel.hidden = true;
      const areaKey = currentArea || 'all';
      const bestPrev = getBestValue(areaKey);
      if (score > bestPrev){
        setBestValue(areaKey, score);
      }
      updateBestLabel();
      if (summaryEl){
        const bestNow = Math.max(bestPrev, score);
        const lesson = pickPendingLesson();
        const areaLabel = getAreaLabelLocal(areaKey);
        summaryEl.hidden = false;
        summaryEl.innerHTML = `
          <strong>Resultado:</strong> ${score}/${questionSet.length}
          <span class="small muted">Mejor marca para ${areaLabel}: ${bestNow}</span>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-action="retry">Repetir quiz</button>
            ${lesson ? '<button type="button" class="btn btn-ghost" data-action="open-lesson">Reforzar leccion sugerida</button>' : ''}
          </div>
        `;
        const retry = summaryEl.querySelector('[data-action="retry"]');
        const openLesson = summaryEl.querySelector('[data-action="open-lesson"]');
        retry?.addEventListener('click', startGame);
        openLesson?.addEventListener('click', () => navigateToLesson(lesson));
      }
      startBtn.disabled = false;
      startBtn.textContent = 'Iniciar';
    }

    function startGame(){
      if (!cachedLessons.length){
        ensureLessonsData().then(() => startGame());
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = 'Preparando...';
      summaryEl?.setAttribute('hidden', '');
      feedbackEl.textContent = '';
      feedbackEl.className = 'quiz-feedback';
      score = 0;
      currentIndex = 0;
      questionSet = buildQuestionSet(currentArea);
      if (!questionSet.length){
        panel.hidden = true;
        if (summaryEl){
          summaryEl.hidden = false;
          summaryEl.innerHTML = '<p>No hay suficientes lecciones en esta area para generar un quiz. Prueba otra area.</p>';
        }
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar';
        return;
      }
      setTimeout(() => {
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar';
      }, 250);
      renderQuestion();
    }

    startBtn?.addEventListener('click', startGame);
    areaSelect?.addEventListener('change', () => {
      currentArea = areaSelect.value || 'all';
      updateBestLabel();
    });

    return {
      setLessons(lessons, areas){
        areaEntries = [];
        if (areas instanceof Map){
          areaEntries = Array.from(areas.values()).map(entry => ({
            key: entry.key,
            label: entry.label,
            lessons: entry.lessons.slice(),
          })).sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
        }
        populateAreaSelect();
      },
      refreshStats(){
        populateAreaSelect();
      },
    };
  }
  function ExamMode(card){
    if (!card) return null;
    const startBtn = card.querySelector('#em-start');
    const areaSelect = card.querySelector('#em-area');
    const panel = card.querySelector('#em-panel');
    const counterEl = card.querySelector('#em-counter');
    const totalEl = card.querySelector('#em-total');
    const scoreEl = card.querySelector('#em-score');
    const titleEl = card.querySelector('#em-title');
    const promptEl = card.querySelector('#em-prompt');
    const optionsWrap = card.querySelector('#em-options');
    const form = card.querySelector('#em-form');
    const answerInput = card.querySelector('#em-answer');
    const feedbackEl = card.querySelector('#em-feedback');
    const summaryWrap = card.querySelector('#em-summary');
    const summaryScore = card.querySelector('#em-summary-score');
    const summaryDetail = card.querySelector('#em-summary-detail');
    const retryBtn = card.querySelector('#em-retry');
    const openLessonBtn = card.querySelector('#em-open-lesson');
    const bestEl = card.querySelector('#em-best');

    let areaEntries = [];
    let currentArea = 'all';
    let questionSet = [];
    let currentIndex = 0;
    let score = 0;
    let active = false;
    let pendingRecommendation = null;

    function describeArea(areaKey){
      if (areaKey === 'all') return 'todas las areas';
      const entry = areaEntries.find(item => item.key === areaKey);
      return entry ? entry.label : areaKey;
    }

    function getBestKey(areaKey){
      return `mb_em_best:${areaKey || 'all'}`;
    }

    function getBest(areaKey){
      try {
        return parseInt(localStorage.getItem(getBestKey(areaKey)), 10) || 0;
      } catch {
        return 0;
      }
    }

    function setBest(areaKey, value){
      try {
        localStorage.setItem(getBestKey(areaKey), String(value));
      } catch {}
    }

    function updateBest(){
      if (bestEl) bestEl.textContent = String(getBest(currentArea));
    }

    function populateAreaSelect(){
      if (!areaSelect) return;
      const previous = areaSelect.value || currentArea || 'all';
      areaSelect.innerHTML = '';
      const optAll = document.createElement('option');
      optAll.value = 'all';
      optAll.textContent = `Todas las areas (${cachedLessons.length})`;
      areaSelect.appendChild(optAll);
      areaEntries.forEach(entry => {
        const option = document.createElement('option');
        option.value = entry.key;
        option.textContent = `${entry.label} (${entry.lessons.length})`;
        areaSelect.appendChild(option);
      });
      if (areaSelect.querySelector(`option[value="${previous}"]`)){
        areaSelect.value = previous;
      }
      currentArea = areaSelect.value || 'all';
      updateBest();
    }

    function getPoolForArea(areaKey){
      if (areaKey === 'all') return cachedLessons.slice();
      const entry = areaEntries.find(item => item.key === areaKey);
      return entry ? entry.lessons.slice() : [];
    }

    function truncate(text, max){
      if (!text) return '';
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean.length <= max) return clean;
      return `${clean.slice(0, max - 1)}...`;
    }

    function buildTheoryQuestion(lesson, pool){
      const candidates = pool.length ? pool.slice() : cachedLessons.slice();
      const options = [{ label: lesson.nombre, correct: true, lesson }];
      const used = new Set([lesson.id]);
      shuffle(candidates).some(candidate => {
        if (!candidate || used.has(candidate.id)) return false;
        options.push({ label: candidate.nombre, correct: false, lesson: candidate });
        used.add(candidate.id);
        return options.length >= QUIZ_OPTIONS;
      });
      if (options.length < QUIZ_OPTIONS){
        shuffle(cachedLessons).some(candidate => {
          if (!candidate || used.has(candidate.id)) return false;
          options.push({ label: candidate.nombre, correct: false, lesson: candidate });
          used.add(candidate.id);
          return options.length >= QUIZ_OPTIONS;
        });
      }
      shuffle(options);
      const excerpt = truncate(lesson.preview || `${lesson.topicTitulo || ''} ${lesson.objetivo || ''}` || lesson.nombre, 200);
      const prompt = excerpt
        ? `Identifica la leccion segun este fragmento:\n"${excerpt}"`
        : `A que leccion corresponde ${lesson.nombre}?`;
      return {
        type: 'theory',
        title: 'Teoria aplicada',
        prompt,
        options,
        lesson,
      };
    }

    function buildPracticeQuestion(lesson){
      const ops = ['+', '-', 'x', '/'];
      const op = ops[Math.floor(Math.random() * ops.length)];
      let a = Math.floor(Math.random() * 21) + 9;
      let b = Math.floor(Math.random() * 21) + 4;
      let answer = 0;
      if (op === 'x'){
        answer = a * b;
      } else if (op === '/'){
        answer = a;
        b = Math.floor(Math.random() * 11) + 2;
        a = a * b;
      } else if (op === '+'){
        answer = a + b;
      } else {
        if (a < b) [a, b] = [b, a];
        answer = a - b;
      }
      return {
        type: 'practice',
        title: 'Ejercicio practico',
        prompt: `Resuelve: ${a} ${op} ${b}`,
        answer,
        tolerance: 1e-6,
        lesson,
      };
    }
    function buildQuestionSet(areaKey){
      const pool = getPoolForArea(areaKey);
      const source = pool.length ? pool : cachedLessons.slice();
      if (!source.length) return [];
      const shuffled = shuffle(source);
      const questions = [];
      const theoryLessons = shuffled.slice(0, Math.min(EXAM_THEORY_COUNT, shuffled.length));
      theoryLessons.forEach(lesson => {
        questions.push(buildTheoryQuestion(lesson, source));
      });
      for (let i = 0; i < EXAM_PRACTICE_COUNT; i += 1){
        const baseLesson = shuffled[i % shuffled.length];
        questions.push(buildPracticeQuestion(baseLesson));
      }
      return questions.slice(0, Math.min(EXAM_TOTAL, questions.length));
    }

    function renderQuestion(){
      const question = questionSet[currentIndex];
      if (!question){
        finish();
        return;
      }
      counterEl.textContent = String(currentIndex + 1);
      totalEl.textContent = String(questionSet.length);
      scoreEl.textContent = String(score);
      titleEl.textContent = question.title;
      promptEl.textContent = question.prompt;
      feedbackEl.textContent = '';
      feedbackEl.className = 'exam-feedback';
      optionsWrap.innerHTML = '';
      optionsWrap.hidden = question.type !== 'theory';
      form.hidden = question.type !== 'practice';
      if (question.type === 'practice'){
        answerInput.value = '';
        answerInput.focus();
      }
      active = true;
      if (question.type === 'theory'){
        question.options.forEach(option => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = option.label;
          btn.addEventListener('click', () => handleTheoryAnswer(question, option, btn));
          optionsWrap.appendChild(btn);
        });
      }
    }

    function handleTheoryAnswer(question, option, button){
      if (!active) return;
      active = false;
      const buttons = Array.from(optionsWrap.querySelectorAll('button'));
      buttons.forEach(btn => { btn.disabled = true; });
      if (option.correct){
        score += 1;
        feedbackEl.textContent = 'Correcto';
        feedbackEl.className = 'exam-feedback ok';
        button.classList.add('correct');
      } else {
        feedbackEl.textContent = 'Revisa la teoria';
        feedbackEl.className = 'exam-feedback err';
        button.classList.add('wrong');
        const correct = buttons.find(btn => btn.textContent === question.options.find(opt => opt.correct).label);
        correct?.classList.add('correct');
      }
      scoreEl.textContent = String(score);
      setTimeout(advance, 900);
    }

    function handlePracticeSubmit(evt){
      evt.preventDefault();
      if (!active) return;
      const question = questionSet[currentIndex];
      const value = Number(answerInput.value);
      if (!Number.isFinite(value)){
        feedbackEl.textContent = 'Ingresa un numero';
        feedbackEl.className = 'exam-feedback err';
        return;
      }
      active = false;
      const tolerance = question.tolerance || 0;
      if (Math.abs(value - question.answer) <= tolerance){
        score += 1;
        feedbackEl.textContent = 'Muy bien';
        feedbackEl.className = 'exam-feedback ok';
        confettiBurst(card, 20);
      } else {
        feedbackEl.textContent = `Respuesta esperada: ${question.answer}`;
        feedbackEl.className = 'exam-feedback err';
      }
      scoreEl.textContent = String(score);
      setTimeout(advance, 900);
    }

    function advance(){
      currentIndex += 1;
      renderQuestion();
    }

    function finish(){
      panel.hidden = true;
      summaryWrap.hidden = false;
      const bestPrev = getBest(currentArea);
      const bestNow = Math.max(bestPrev, score);
      const isRecord = score > bestPrev;
      if (isRecord){
        setBest(currentArea, score);
        updateBest();
        confettiBurst(card, 34);
      }
      summaryScore.textContent = `${score}/${questionSet.length}`;
      const areaLabel = describeArea(currentArea);
      let detail = `Mejor marca en ${areaLabel}: ${bestNow} aciertos.`;
      if (isRecord) detail += ' Nuevo record!';
      pendingRecommendation = pickPendingLesson();
      if (pendingRecommendation){
        detail += ` Recomendacion: repasa ${formatLessonLabel(pendingRecommendation)}.`;
        openLessonBtn.hidden = false;
        openLessonBtn.textContent = formatLessonLabel(pendingRecommendation);
      } else {
        openLessonBtn.hidden = true;
      }
      summaryDetail.textContent = detail;
      startBtn.disabled = false;
      startBtn.textContent = 'Iniciar';
    }

    function startExam(){
      ensureLessonsData().then(() => {
        startBtn.disabled = true;
        startBtn.textContent = 'Preparando...';
        panel.hidden = true;
        summaryWrap.hidden = true;
        feedbackEl.textContent = '';
        feedbackEl.className = 'exam-feedback';
        score = 0;
        currentIndex = 0;
        questionSet = buildQuestionSet(currentArea);
        if (!questionSet.length){
          summaryWrap.hidden = false;
          summaryScore.textContent = '0/0';
          summaryDetail.textContent = 'No hay suficientes lecciones en esta area para generar un examen. Selecciona otra area.';
          startBtn.disabled = false;
          startBtn.textContent = 'Iniciar';
          return;
        }
        panel.hidden = false;
        renderQuestion();
        startBtn.disabled = false;
        startBtn.textContent = 'En curso...';
      });
    }

    startBtn?.addEventListener('click', startExam);
    areaSelect?.addEventListener('change', () => {
      currentArea = areaSelect.value || 'all';
      updateBest();
    });
    form?.addEventListener('submit', handlePracticeSubmit);
    retryBtn?.addEventListener('click', startExam);
    openLessonBtn?.addEventListener('click', () => {
      if (pendingRecommendation) navigateToLesson(pendingRecommendation);
    });

    return {
      setLessons(lessons, areas){
        areaEntries = [];
        if (areas instanceof Map){
          areaEntries = Array.from(areas.values()).map(entry => ({
            key: entry.key,
            label: entry.label,
            lessons: entry.lessons.slice(),
          })).sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
        }
        populateAreaSelect();
      },
      refreshStats(){
        populateAreaSelect();
      },
    };
  }

  function initGamesSection(){
    injectCssOnce('../games/games.css');
    const quickCard = document.getElementById('quick-math-card');
    const quizCard = document.getElementById('lesson-quiz-card');
    const examCard = document.getElementById('exam-mode-card');

    quickModule = QuickMath(quickCard);
    quizModule = LessonQuiz(quizCard);
    examModule = ExamMode(examCard);

    ensureLessonsData();

    if (window.MathBotProgress && typeof window.MathBotProgress.subscribe === 'function'){
      window.MathBotProgress.subscribe(() => {
        updateSummaryUI();
        quickModule?.refreshRecommendation?.();
        quizModule?.refreshStats?.();
        examModule?.refreshStats?.();
      });
    }
  }

  window.initGamesSection = initGamesSection;
})();
