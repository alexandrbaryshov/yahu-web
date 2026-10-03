// Чистые решения старта клиента: пересчёт снимка «на сегодня», когда прятать
// заставку, хранение снимка в localStorage и т.п.
//
// Вынесены из app.js отдельным файлом без DOM, чтобы их можно было проверить
// тестом в Node (test/startup.test.js). В браузере подключается обычным
// <script> в <head> (после today.js) и кладёт объект в window.YahuStartup —
// заставка пользуется shouldSkipSplash ещё до загрузки app.js.
(function (root) {
  var YahuToday = root && root.YahuToday
    ? root.YahuToday
    : (typeof require === 'function' ? require('./today.js') : null);

  var SNAPSHOT_KEY = 'yahu:lastState:v2';
  var LEGACY_SNAPSHOT_KEY = 'yahu:lastState:v1';
  var SPLASH_SESSION_KEY = 'yahu:splashShown';

  // Тайминги — из «Решений по реализации» спецификации.
  var SPLASH_MIN_MS = 3500;           // «чуть дольше 3 секунд»
  var SPLASH_MAX_WITH_SNAPSHOT_MS = 6000; // со снимком дольше не держим
  var SLOW_HINT_MS = 6000;            // без снимка: «Сервер просыпается…»
  var FETCH_TIMEOUT_MS = 60000;       // Render просыпается до ~50 с
  var REVISIT_REFRESH_MS = 60000;     // возврат во вкладку — перезапрос

  var MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

  function copy(obj) {
    var out = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    return out;
  }

  // Копия снимка с цифрами «сегодня», пересчитанными по московским суткам
  // той же формулой, что и на сервере. Подсказка по Б/Ж/У считается сервером
  // по вчерашним цифрам — если снимок не за сегодня, она устарела и скрывается.
  function applyLocalToday(state, now) {
    now = now || new Date();
    var t = YahuToday.computeToday({
      foods: state.foods,
      water: state.water,
      weights: state.weights,
      dailyTarget: state.dailyTarget,
      waterTarget: state.waterTarget,
      startWeight: state.startWeight,
    }, now);
    var out = copy(state);
    for (var k in t) out[k] = t[k];
    out.motivationalPhrase = YahuToday.getMotivationalPhrase(now);
    if (state.serverDayKey !== YahuToday.moscowDayKey(now)) out.macroTip = null;
    return out;
  }

  // Когда прятать заставку. input = { elapsedMs (от старта страницы),
  // hasSnapshot, hasFresh (свежий ответ сервера уже пришёл), failed (запрос
  // упал или истёк 60 с), repeatVisit (заставку в этой вкладке уже видели) }.
  function splashDecision(input) {
    var hasSomething = input.hasSnapshot || input.hasFresh;
    var res = { hide: false, slowHint: false, showError: false };
    if (input.repeatVisit && hasSomething) { res.hide = true; return res; }
    if (input.hasFresh) {
      res.hide = input.elapsedMs >= SPLASH_MIN_MS;
      return res;
    }
    if (input.hasSnapshot) {
      // Ответ уже не придёт — ждать до 6 с незачем, но минимум держим.
      res.hide = input.failed ? input.elapsedMs >= SPLASH_MIN_MS : input.elapsedMs >= SPLASH_MAX_WITH_SNAPSHOT_MS;
      return res;
    }
    // Показать нечего — держим до ответа сервера.
    res.slowHint = input.elapsedMs >= SLOW_HINT_MS;
    res.showError = !!input.failed;
    return res;
  }

  function canDismissSplash(input) {
    return !!(input.hasSnapshot || input.hasFresh);
  }

  // F5/pull-to-refresh в той же вкладке: заставку не показываем, если есть
  // снимок, — сразу главная. Без снимка показать нечего, заставка нужна.
  function shouldSkipSplash(session, local) {
    try {
      if (!session.getItem(SPLASH_SESSION_KEY)) return false;
      return !!(local.getItem(SNAPSHOT_KEY) || local.getItem(LEGACY_SNAPSHOT_KEY));
    } catch (e) { return false; }
  }

  function markSplashShown(session) {
    try { session.setItem(SPLASH_SESSION_KEY, '1'); } catch (e) { /* приватный режим — не критично */ }
  }

  // Снимок: { savedAt: ISO, state: ответ сервера без фото }. Фото (если вдруг
  // пришло) не кладём — может весить мегабайты, а лимит localStorage 5–10 МБ.
  function writeSnapshot(storage, state, now) {
    try {
      var s = copy(state);
      if (s.profile) { s.profile = copy(s.profile); delete s.profile.photoDataUrl; }
      storage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: new Date(now || Date.now()).toISOString(), state: s }));
    } catch (e) { /* приватный режим, переполнение квоты — не критично */ }
  }

  // Читает снимок v2; старый v1 (голое состояние без времени) подхватывается
  // один раз: переносится в v2 с savedAt = null и удаляется.
  function readSnapshot(storage) {
    var legacy = null;
    try {
      legacy = storage.getItem(LEGACY_SNAPSHOT_KEY);
      if (legacy !== null) storage.removeItem(LEGACY_SNAPSHOT_KEY);
    } catch (e) { legacy = null; }
    try {
      var raw = storage.getItem(SNAPSHOT_KEY);
      if (raw) {
        var snap = JSON.parse(raw);
        return snap && snap.state ? snap : null;
      }
      if (legacy) {
        var migrated = { savedAt: null, state: JSON.parse(legacy) };
        try { storage.setItem(SNAPSHOT_KEY, JSON.stringify(migrated)); } catch (e) { /* не критично */ }
        return migrated;
      }
    } catch (e) { /* испорченный JSON — как будто снимка нет */ }
    return null;
  }

  function shouldRefreshOnVisible(nowMs, lastSuccessMs) {
    return nowMs - lastSuccessMs > REVISIT_REFRESH_MS;
  }

  // Гонка запросов. Клиент нумерует применённые ответы сервера (serverSeq:
  // +1 на каждый принятый /api/state и ответ мутации). Ответ /api/state,
  // запрошенный при меньшем номере, мог уйти на сервер ДО мутации — применять
  // его нельзя, иначе он затрёт только что добавленную воду/еду.
  //   'apply'   — с момента запроса ничего не применялось;
  //   'drop'    — на экране уже более свежий ответ мутации (статус fresh);
  //   'refetch' — свежего на экране нет (мутация потом не удалась) — перезапросить.
  function stateResponseAction(input) {
    if (input.requestSeq === input.currentSeq) return 'apply';
    return input.status === 'fresh' ? 'drop' : 'refetch';
  }

  // Мутация не удалась. Откат на состояние до неё допустим, только если с
  // начала действия не пришло ничего свежего — иначе prevState старше того,
  // что уже на экране. В любом случае на экране не подтверждённые сервером
  // данные: статус «Обновляю…» (снимок не перезаписывается) и перезапрос.
  function mutationFailureAction(input) {
    return { restore: input.startSeq === input.currentSeq, status: 'syncing' };
  }

  // «Нет связи · данные на HH:MM» — время снимка по МСК (не по часам устройства).
  function offlineLabel(savedAt) {
    if (!savedAt) return 'Нет связи · данные из прошлого сеанса';
    var t = new Date(new Date(savedAt).getTime() + MOSCOW_OFFSET_MS);
    var h = String(t.getUTCHours());
    var m = String(t.getUTCMinutes());
    return 'Нет связи · данные на ' + (h.length < 2 ? '0' + h : h) + ':' + (m.length < 2 ? '0' + m : m);
  }

  var api = {
    SPLASH_MIN_MS: SPLASH_MIN_MS,
    SPLASH_MAX_WITH_SNAPSHOT_MS: SPLASH_MAX_WITH_SNAPSHOT_MS,
    SLOW_HINT_MS: SLOW_HINT_MS,
    FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS,
    REVISIT_REFRESH_MS: REVISIT_REFRESH_MS,
    applyLocalToday: applyLocalToday,
    splashDecision: splashDecision,
    canDismissSplash: canDismissSplash,
    shouldSkipSplash: shouldSkipSplash,
    markSplashShown: markSplashShown,
    writeSnapshot: writeSnapshot,
    readSnapshot: readSnapshot,
    shouldRefreshOnVisible: shouldRefreshOnVisible,
    offlineLabel: offlineLabel,
    stateResponseAction: stateResponseAction,
    mutationFailureAction: mutationFailureAction,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.YahuStartup = api;
})(typeof window !== 'undefined' ? window : null);
