(function(){



  const AREA_LABELS = {



    precalculo: 'Precalculo',



    algebra: 'Algebra',



    geometria: 'Geometria',



    estadistica: 'Estadistica',



    calculo: 'Calculo',



  };



  const store = {



    listPromise: null,



    computed: null,



    unitsMap: new Map(),



    lessonsMap: new Map(),



    areaSummary: new Map(),



  };



  const subscribers = new Set();



  function normalizeId(value){



    if (value === null || value === undefined) return null;



    const str = String(value).trim();



    if (!str) return null;



    const num = Number(str);



    if (Number.isInteger(num)) return num;



    return str;



  }



  function registerMapEntry(map, key, value){



    if (!map || key === null || key === undefined) return;



    map.set(key, value);



    const strKey = String(key);



    if (strKey !== key) {



      map.set(strKey, value);



    }



    const numKey = Number(strKey);



    if (Number.isInteger(numKey)) {



      map.set(numKey, value);



    }



  }



  function resolveFromMap(map, key){



    if (!map || key === null || key === undefined) return null;



    if (map.has(key)) return map.get(key);



    const strKey = String(key);



    if (map.has(strKey)) return map.get(strKey);



    const numKey = Number(strKey);



    if (Number.isInteger(numKey) && map.has(numKey)) {



      return map.get(numKey);



    }



    return null;



  }



  function getApiBase(){



    try {



      const saved = localStorage.getItem('mb_api_base');



      return saved || 'http://127.0.0.1:8000';



    } catch (err) {



      console.warn('MathBotLessons getApiBase failed', err);



      return 'http://127.0.0.1:8000';



    }



  }



  function getCachedRawLessons(){



    try {



      const raw = localStorage.getItem('mb_lessons_cache');



      return raw ? JSON.parse(raw) : null;



    } catch (err) {



      console.warn('MathBotLessons cache read failed', err);



      return null;



    }



  }



  function saveRawLessons(unitsInput){



    try {



      localStorage.setItem('mb_lessons_cache', JSON.stringify(unitsInput));



    } catch (err) {



      console.warn('MathBotLessons cache write failed', err);



    }



  }



  function normalizeArea(area){



    if (!area) {



      return { key: 'sin-area', label: 'Sin area' };



    }



    const raw = String(area).trim().toLowerCase();



    if (!raw) {



      return { key: 'sin-area', label: 'Sin area' };



    }



    const label = AREA_LABELS[raw] || raw.charAt(0).toUpperCase() + raw.slice(1);



    return { key: raw, label };



  }



  function notify(reason){



    subscribers.forEach(fn => {



      try {



        fn({ reason, data: store.computed });



      } catch (err) {



        console.error('MathBotLessons subscriber error', err);



      }



    });



  }



  function normalizeUnits(unidades){
    const units = [];
    const lessons = [];
    const unitsMap = new Map();
    const lessonsMap = new Map();
    const areaSummary = new Map();

    let topicsCount = 0;

    (unidades || []).forEach(unit => {
      const unitIdRaw = unit && (unit.id !== undefined ? unit.id : unit.id_unidad);
      const unitId = normalizeId(unitIdRaw);
      const unitKey = unitId !== null && unitId !== undefined ? unitId : unitIdRaw;
      const { key: areaKey, label: areaLabel } = normalizeArea(unit.area);

      const normalizedUnit = {
        id: unitKey,
        numero: unit.numero,
        titulo: unit.titulo,
        areaKey,
        areaLabel,
        temas: [],
        temasCount: 0,
        temas_count: 0,
        lessonsCount: 0,
        lecciones_count: 0,
      };

      const areaEntry = areaSummary.get(areaKey) || {
        key: areaKey,
        label: areaLabel,
        unitCount: 0,
        lessonCount: 0,
        topicCount: 0,
        units: [],
      };
      areaEntry.unitCount += 1;

      (unit.temas || []).forEach(topic => {
        const topicIdRaw = topic && (topic.id !== undefined ? topic.id : topic.id_tema);
        const topicId = normalizeId(topicIdRaw);
        const topicKey = topicId !== null && topicId !== undefined ? topicId : topicIdRaw;
        const lessonList = [];
        const normalizedTopic = {
          id: topicKey,
          numero: topic.numero,
          titulo: topic.titulo,
          lessons: lessonList,
          lecciones: lessonList,
          leccionesCount: 0,
          lecciones_count: 0,
        };

        normalizedUnit.temas.push(normalizedTopic);
        normalizedUnit.temasCount += 1;
        topicsCount += 1;

        (topic.lecciones || []).forEach(lesson => {
          const lessonIdRaw = lesson && (lesson.id !== undefined ? lesson.id : lesson.id_leccion);
          const lessonId = normalizeId(lessonIdRaw);
          const lessonKey = lessonId !== null && lessonId !== undefined ? lessonId : lessonIdRaw;
          const normalizedLesson = {
            id: lessonKey,
            numero: lesson.numero,
            nombre: lesson.nombre,
            preview: lesson.preview || '',
            areaKey,
            areaLabel,
            unitId: normalizedUnit.id,
            unitNumero: normalizedUnit.numero,
            unitTitulo: normalizedUnit.titulo,
            topicId: normalizedTopic.id,
            topicNumero: normalizedTopic.numero,
            topicTitulo: normalizedTopic.titulo,
          };

          lessonList.push(normalizedLesson);
          normalizedUnit.lessonsCount += 1;
          lessons.push(normalizedLesson);
          registerMapEntry(lessonsMap, normalizedLesson.id, normalizedLesson);
        });

        normalizedTopic.leccionesCount = lessonList.length;
        normalizedTopic.lecciones_count = lessonList.length;
        areaEntry.lessonCount += lessonList.length;
      });

      normalizedUnit.temas_count = normalizedUnit.temasCount;
      normalizedUnit.lecciones_count = normalizedUnit.lessonsCount;

      units.push(normalizedUnit);
      registerMapEntry(unitsMap, normalizedUnit.id, normalizedUnit);
      areaEntry.topicCount += normalizedUnit.temasCount;
      areaEntry.units.push(normalizedUnit);
      areaSummary.set(areaKey, areaEntry);
    });

    return {
      units,
      lessons,
      totals: {
        units: units.length,
        lessons: lessons.length,
        topics: topicsCount,
      },
      areaSummary,
      unitsMap,
      lessonsMap,
    };
  }

function applyNormalizedData(normalized) {



    if (!normalized) return;



    store.computed = {



      units: normalized.units,



      lessons: normalized.lessons,



      totals: normalized.totals,



      areaSummary: normalized.areaSummary,



    };



    store.unitsMap = normalized.unitsMap;



    store.lessonsMap = normalized.lessonsMap;



    store.areaSummary = normalized.areaSummary;



    store.listPromise = Promise.resolve(store.computed);



    notify('index-loaded');



  }



  function hydrateFromNormalized(unitsInput){



    try {



      if (Array.isArray(unitsInput)) {



        saveRawLessons(unitsInput);



        const normalized = normalizeUnits(unitsInput);



        applyNormalizedData(normalized);



      } else if (unitsInput && typeof unitsInput === 'object') {



        applyNormalizedData(unitsInput);



      }



      if (store.computed) {



        store.listPromise = Promise.resolve(store.computed);



      }



    } catch (err) {



      console.warn('MathBotLessons hydrate error', err);



    }



  }



  async function fetchIndex(force){



    if (!force && store.listPromise) {



      return store.listPromise;



    }



    const runner = (async () => {



      const apiBase = getApiBase();



      const url = `${apiBase}/lessons/`;



      try {



        const resp = await fetch(url);



        if (!resp.ok) {



          throw new Error(`HTTP ${resp.status}`);



        }



        const payload = await resp.json();



        const rawUnits = payload.unidades || [];



        saveRawLessons(rawUnits);



        const normalized = normalizeUnits(rawUnits);



        applyNormalizedData(normalized);



        store.listPromise = Promise.resolve(store.computed);



        return store.computed;



      } catch (err) {



        console.error('MathBotLessons fetchIndex error', err);



        const cached = getCachedRawLessons();



        if (cached) {



          const normalized = normalizeUnits(cached);



          applyNormalizedData(normalized);



          store.listPromise = Promise.resolve(store.computed);



          return store.computed;



        }



        store.listPromise = null;



        throw err;



      }



    })();



    store.listPromise = runner;



    return runner;



  }



  function getLessons(){



    return store.computed ? store.computed.lessons.slice() : [];



  }



  function getUnits(){



    return store.computed ? store.computed.units.slice() : [];



  }



  function getLessonById(id){



    if (!id) return null;



    return store.lessonsMap.get(Number(id));



  }



  function getUnitsByArea(areaKey){



    if (!store.computed) return [];



    const key = areaKey ? String(areaKey).toLowerCase() : 'sin-area';



    const entry = store.areaSummary.get(key);



    if (!entry) return [];



    return entry.units.slice();



  }



  function getAreaSummary(){



    if (!store.computed) return [];



    return Array.from(store.areaSummary.values()).map(entry => ({



      key: entry.key,



      label: entry.label,



      unitCount: entry.unitCount,



      lessonCount: entry.lessonCount,



      topicCount: entry.topicCount,



    }));



  }



  function subscribe(fn){



    if (typeof fn !== 'function') return () => {};



    subscribers.add(fn);



    return () => subscribers.delete(fn);



  }



  window.MathBotLessons = {



    ready: () => fetchIndex(false),



    refresh: () => fetchIndex(true),



    getIndex: () => store.computed,



    getLessons,



    getUnits,



    getLessonById,



    getUnitsByArea,



    getAreaSummary,



    subscribe,



    hydrateFromNormalized,



  };



})();



