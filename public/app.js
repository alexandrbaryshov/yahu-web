let appState = null;
let selectedFood = null;
let editingFoodId = null; // id записи в дневнике, которую сейчас редактируем (null — режим "добавить новую")
let searchTimer = null;
let activeSearch = 0;
let wasOverBudget = false;

// ---------- Общие хелперы для работы с датами ----------
// Используются и дневником (группировка по дням), и графиками прогресса
// (границы недели/месяца), поэтому вынесены в одно место.
//
// День считается по МОСКОВСКОМУ времени (тем же приёмом, что и на сервере —
// см. lib/moscow-time.js), а не по часовому поясу устройства: так дневник и
// дашборд всегда согласованы друг с другом и с сервером, даже если часы на
// телефоне почему-то настроены неверно.
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000; // Europe/Moscow = UTC+3 круглый год (без перехода на летнее время с 2014 г.)
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function shiftToMoscow(d) { return new Date(d.getTime() + MOSCOW_OFFSET_MS); }

// Достаёт год/месяц/день по-московски из любого момента — не через
// getFullYear/getMonth/getDate (те смотрят на часовой пояс устройства).
function moscowParts(d) {
  const s = shiftToMoscow(d);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth(), day: s.getUTCDate() };
}

function startOfDay(d) {
  const p = moscowParts(d);
  return new Date(Date.UTC(p.year, p.month, p.day) - MOSCOW_OFFSET_MS);
}
function endOfDay(d) {
  return new Date(startOfDay(d).getTime() + MS_PER_DAY - 1);
}
// Подпись для 7-дневного блока графика («1–7» либо, если блок пересекает
// границу месяца, «25–1 сент.»). Используется и для калорий/воды, и для веса.
function chunkLabel(chunk) {
  const ps = moscowParts(chunk.start);
  const pe = moscowParts(chunk.end);
  const sameMonth = ps.month === pe.month;
  const range = `${ps.day}–${pe.day}`;
  return sameMonth ? range : `${range} ${chunk.end.toLocaleDateString('ru-RU', { month: 'short', timeZone: 'Europe/Moscow' })}`;
}

// Общий helper для запросов к API — убирает повторяющийся boilerplate
// fetch(...).then(JSON.stringify(...)) по всему файлу. Сервер всегда отвечает
// валидным JSON (даже на ошибку — {error: '...'} с кодом 4xx), поэтому можно
// просто возвращать распарсенный результат и проверять result.error у вызывающего.
const api = {
  get: (path) => fetch(path).then((r) => r.json()),
  post: (path, body) => fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()),
  put: (path, body) => fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()),
  del: (path) => fetch(path, { method: 'DELETE' }).then((r) => r.json()),
};

// ---------- Журнал действий (для "Инструмента разработчика") ----------
// Отправляется "по факту" (fire-and-forget) — ни на что не влияет и не должно
// тормозить основной интерфейс, поэтому ошибки записи в журнал намеренно
// проглатываются.
function logAction(action, details) {
  api.post('/api/devlog', { action, details: details || '' }).catch(() => {});
}

// ---------- Навигация ----------
// Профиль можно открыть с любого раздела (кнопка-аватар в правом верхнем
// углу), поэтому запоминаем, откуда пришли, чтобы «Назад» возвращал именно
// туда, а не всегда на главную.
let screenBeforeProfile = 'home';

const SCREEN_LABELS = { home: 'Главная', diary: 'Дневник', progress: 'Прогресс', achievements: 'Награды', profile: 'Профиль', devtools: 'Инструмент разработчика' };

function showScreen(name) {
  const current = document.querySelector('.screen.active');
  if (name === 'profile' && current && current.id !== 'screen-profile') {
    screenBeforeProfile = current.id.replace('screen-', '');
  }
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  if (name !== 'devtools') logAction('Переход в раздел', SCREEN_LABELS[name] || name);
}

function closeProfile() {
  showScreen(screenBeforeProfile);
}

function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Загрузка состояния ----------
// ---------- Кэш состояния (мгновенная загрузка при обновлении страницы) ----------
// localStorage переживает полную перезагрузку страницы (в отличие от обычных
// JS-переменных), поэтому используем его как "снимок" последнего известного
// состояния: при каждом обновлении страницы он показывается СРАЗУ, без
// ожидания ответа сервера, а затем тихо обновляется свежими данными, как
// только они приходят (классический паттерн stale-while-revalidate). Именно
// это убирает заметную паузу в 1.5-2 секунды при каждом F5/pull-to-refresh —
// пользователь не смотрит на пустой экран, пока идёт сетевой запрос.
const STATE_CACHE_KEY = 'yahu:lastState:v1';

function cacheState(state) {
  try {
    // Фото профиля может весить несколько мегабайт в base64 — кэшировать его
    // на каждый рендер бессмысленно (не нужно для "мгновенных цифр" на
    // главном экране) и рискованно для лимита localStorage (обычно 5-10 МБ).
    const toCache = { ...state, profile: { ...state.profile, photoDataUrl: null } };
    localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(toCache));
  } catch (e) { /* приватный режим браузера, переполнение квоты и т.п. — не критично */ }
}

function readCachedState() {
  try {
    const raw = localStorage.getItem(STATE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function loadState() {
  // 1) Мгновенно показываем последний известный снимок, если он есть —
  // без этого шага экран был бы пустым все 1.5-2 секунды сетевого запроса.
  const cached = readCachedState();
  if (cached) {
    appState = cached;
    wasOverBudget = appState.isOverBudget;
    render();
  }
  // 2) Догружаем актуальные данные с сервера и тихо обновляем экран —
  // пользователь к этому моменту уже видит интерфейс и может им пользоваться.
  try {
    appState = await api.get('/api/state');
    wasOverBudget = appState.isOverBudget;
    render();
  } catch (e) {
    if (!cached) toast('Не удалось связаться с сервером');
  }
}

function render() {
  if (!appState) return;
  cacheState(appState);
  renderHome();
  renderMacroTip();
  renderDiary();
  renderProgress();
  renderAchievements();
  renderProfile();
  renderReminders();
}

// ---------- Главная: мотивационная фраза + калории + дашборд Б/Ж/У + вода ----------
function renderHome() {
  const {
    lastWeight, goalWeight, startWeight, todayCalories, dailyTarget,
    todayProtein, todayFat, todayCarbs, proteinTarget, fatTarget, carbsTarget, isOverBudget,
    motivationalPhrase,
  } = appState;

  document.getElementById('motivationalPhrase').textContent = motivationalPhrase || 'Хорошего дня!';

  document.getElementById('goalNums').textContent = `${lastWeight.toFixed(1)} кг`;
  document.getElementById('goalSub').textContent = `→ ${goalWeight.toFixed(0)} кг`;
  const totalToLose = Math.max(startWeight - goalWeight, 1);
  const lost = Math.max(0, startWeight - lastWeight);
  const pct = Math.max(0, Math.min(100, (lost / totalToLose) * 100));
  document.getElementById('goalBar').style.width = pct.toFixed(0) + '%';
  document.getElementById('goalFooter').textContent = `${lastWeight.toFixed(1)} кг сейчас · ${goalWeight.toFixed(0)} кг цель`;

  const remaining = Math.max(0, dailyTarget - todayCalories);
  const ringPct = Math.max(0, Math.min(100, (todayCalories / dailyTarget) * 100));
  const ringColor = isOverBudget ? 'var(--danger)' : 'var(--accent)';
  document.getElementById('calRing').style.background = `conic-gradient(${ringColor} 0 ${ringPct}%, #e4eee8 ${ringPct}%)`;
  document.getElementById('calRingText').innerHTML = `${todayCalories}<small>ккал</small>`;
  document.getElementById('calTitle').textContent = isOverBudget ? 'Дневная цель превышена' : `Ещё ${remaining} ккал`;
  document.getElementById('calSub').textContent = `из мягкой цели ${dailyTarget} ккал`;

  // Карточка калорий целиком светится красным при переедании
  document.getElementById('caloriesCard').classList.toggle('over-budget', isOverBudget);

  // Баннер предупреждения
  document.getElementById('overBudgetBanner').style.display = isOverBudget ? 'flex' : 'none';

  // Разовое всплывающее уведомление в момент, когда порог был превышен
  if (isOverBudget && !wasOverBudget) toast('⚠️ Вы сегодня переели!');
  wasOverBudget = isOverBudget;

  renderMacroBar('proteinBar', 'proteinVal', todayProtein, proteinTarget, isOverBudget);
  renderMacroBar('fatBar', 'fatVal', todayFat, fatTarget, isOverBudget);
  renderMacroBar('carbsBar', 'carbsVal', todayCarbs, carbsTarget, isOverBudget);

  renderWater();
}

function renderWater() {
  const { todayWater, waterTarget, waterRemaining } = appState;
  const pct = Math.max(0, Math.min(100, (todayWater / waterTarget) * 100));
  document.getElementById('waterBar').style.width = pct.toFixed(0) + '%';
  document.getElementById('waterSub').textContent = `Выпито ${todayWater} из ${waterTarget} мл`;
  document.getElementById('waterRemainingText').textContent = waterRemaining > 0
    ? `Осталось выпить ${waterRemaining} мл`
    : 'Норма воды на сегодня выполнена 🎉';
}

async function addWaterQuick() {
  appState = await api.post('/api/water', { amount: 250 });
  renderWater();
  const left = appState.waterRemaining;
  toast(left > 0 ? `💧 +250 мл, осталось ${left} мл` : '💧 Норма воды выполнена!');
  logAction('Добавлена вода', '+250 мл (быстрое действие)');
}

function renderMacroBar(barId, valId, value, target, isOverBudget) {
  const pct = Math.max(0, Math.min(100, (value / target) * 100));
  const bar = document.getElementById(barId);
  bar.style.width = pct.toFixed(0) + '%';
  bar.style.background = isOverBudget ? 'var(--danger)' : bar.dataset.tint;
  document.getElementById(valId).textContent = `${Math.round(value)} / ${target} г`;
}

// Подсказка «один макрос уже набран — добавьте что-то богатое другим»
// (данные и подбор блюд считает сервер, см. lib/macro-tip.js).
function renderMacroTip() {
  const box = document.getElementById('macroTipCard');
  const tip = appState.macroTip;
  if (!tip || !tip.suggestions.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="macro-tip">
      <div class="macro-tip-head">🎯 Норма по <b>${tip.metLabel}</b> уже набрана — добавьте что-то богатое <b>${tip.needLabel}</b>, чтобы выровнять баланс БЖУ:</div>
      <div class="macro-tip-chips">
        ${tip.suggestions.map((s, i) => `<button type="button" class="macro-chip" onclick="quickAddMacroSuggestion(${i})">${escapeHtml(s.name)} · ${s.kcal100} ккал/100г</button>`).join('')}
      </div>
    </div>`;
}

// Открывает уже знакомый диалог добавления еды с предзаполненным блюдом из
// подсказки — пользователю остаётся только проверить порцию и нажать «Добавить».
function quickAddMacroSuggestion(index) {
  const s = appState.macroTip && appState.macroTip.suggestions[index];
  if (!s) return;
  openFoodForm();
  document.getElementById('foodName').value = s.name;
  selectFood({ name: s.name, kcal: s.kcal100, protein: s.protein100, fat: s.fat100, carbs: s.carbs100, portion: s.portion, isWater: false }, null, true);
}

// ---------- Дневник ----------
// Записи из /api/state приходят уже отсортированными по убыванию даты (см.
// server.js), поэтому достаточно один раз пройтись по списку и вставлять
// заголовок дня при каждой смене календарного дня.
function renderDiary() {
  const list = document.getElementById('foodList');
  list.innerHTML = '';
  if (!appState.foods.length) {
    list.innerHTML = `<div class="empty"><span class="ico">🍽️</span><div>Пока нет записей.<br>Добавьте первую еду на главном экране.</div></div>`;
    return;
  }

  const groups = groupFoodsByDay(appState.foods);
  groups.forEach(({ dayDate, items }) => {
    list.appendChild(renderDiaryDayGroup(dayDate, items));
  });
}

// Разбивает отсортированный по дате список записей на группы по календарным дням.
function groupFoodsByDay(foods) {
  const groups = [];
  let current = null;
  foods.forEach((food) => {
    const dayKey = startOfDay(new Date(food.date)).getTime();
    if (!current || current.key !== dayKey) {
      current = { key: dayKey, dayDate: new Date(dayKey), items: [] };
      groups.push(current);
    }
    current.items.push(food);
  });
  return groups;
}

function renderDiaryDayGroup(dayDate, items) {
  const group = document.createElement('div');
  group.className = 'diary-day';

  const dayTotal = items.reduce((sum, f) => sum + (f.calories || 0), 0);
  const head = document.createElement('div');
  head.className = 'diary-day-head';
  head.innerHTML = `<h3>${diaryDayLabel(dayDate)}</h3><span>${dayTotal} ккал</span>`;
  group.appendChild(head);

  items.forEach((food) => group.appendChild(renderFoodRow(food)));
  return group;
}

function renderFoodRow(food) {
  const date = new Date(food.date);
  const row = document.createElement('div');
  row.className = 'food-row';
  const macro = (food.protein || food.fat || food.carbs)
    ? `<div class="fdate">Б${round1(food.protein)} · Ж${round1(food.fat)} · У${round1(food.carbs)}</div>` : '';
  row.innerHTML = `
    <div style="flex:1">
      <div class="fname">${escapeHtml(food.name)}</div>
      <div class="fdate">${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
      ${macro}
    </div>
    <div class="fcal">${food.calories} ккал</div>
    <button class="fedit" title="Редактировать" onclick="editFood('${food.id}')">✎</button>
    <button class="fdel" title="Удалить" onclick="deleteFood('${food.id}')">✕</button>`;
  return row;
}

// «Сегодня» / «Вчера» для ближайших дней, иначе обычная календарная дата
// (день недели, число и месяц; год добавляется, только если он отличается
// от текущего — например, для записей из прошлого года).
function diaryDayLabel(dayDate) {
  const diffDays = Math.round((startOfDay(new Date()) - dayDate) / MS_PER_DAY);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  const opts = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' };
  if (moscowParts(dayDate).year !== moscowParts(new Date()).year) opts.year = 'numeric';
  const label = dayDate.toLocaleDateString('ru-RU', opts);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function round1(n) {
  return Math.round((n || 0) * 10) / 10;
}

async function deleteFood(id) {
  const food = appState.foods.find((f) => f.id === id);
  appState = await api.del('/api/foods/' + id);
  render();
  logAction('Удалена запись еды', food ? `${food.name} · ${food.calories} ккал` : id);
}

// ---------- Прогресс: календарные периоды (неделя Пн–Вс / месяц 1–31) с навигацией ----------
// Для каждого графика храним режим (неделя/месяц) и "якорную" дату — она
// определяет, какой именно календарный период сейчас показан. Навигация
// назад/вперёд двигает якорь на -1/+1 неделю или месяц.
let chartPeriod = {
  weight: { mode: 'week', anchor: new Date() },
  calories: { mode: 'week', anchor: new Date() },
  water: { mode: 'week', anchor: new Date() },
};

function startOfWeek(d) {
  const start = startOfDay(d);
  const dow = (shiftToMoscow(d).getUTCDay() + 6) % 7; // Пн=0 ... Вс=6, по-московски
  return new Date(start.getTime() - dow * MS_PER_DAY);
}
function endOfWeek(d) {
  return new Date(startOfWeek(d).getTime() + 7 * MS_PER_DAY - 1);
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }

function getPeriodRange(mode, anchor) {
  return mode === 'week' ? { start: startOfWeek(anchor), end: endOfWeek(anchor) } : { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}

function firstRecordDate(entries) {
  if (!entries.length) return null;
  return entries.reduce((min, e) => { const d = new Date(e.date); return d < min ? d : min; }, new Date(entries[0].date));
}

// Не даём уйти в будущее (дальше текущей недели/месяца) и не даём уйти раньше
// периода, в котором была самая первая запись — так история пролистывается
// от начала ведения статистики и до сегодняшнего дня, и не дальше.
function clampAnchor(mode, anchor, entries) {
  let a = new Date(anchor);
  const nowRange = getPeriodRange(mode, new Date());
  if (a > nowRange.end) a = new Date();
  const first = firstRecordDate(entries);
  if (first) {
    const firstRange = getPeriodRange(mode, first);
    if (a < firstRange.start) a = new Date(first);
  }
  return a;
}

function entriesForChart(chartKey) {
  if (chartKey === 'weight') return appState.weights;
  if (chartKey === 'water') return appState.water || [];
  return appState.foods; // calories (и статистика Б/Ж/У под ним)
}

function setPeriod(chartKey, mode) {
  chartPeriod[chartKey].mode = mode;
  document.querySelectorAll(`.period-btn[data-chart="${chartKey}"]`).forEach((b) => {
    b.classList.toggle('active', b.dataset.period === mode);
  });
  renderProgress();
}

function shiftPeriod(chartKey, direction) {
  const st = chartPeriod[chartKey];
  const a = new Date(st.anchor);
  if (st.mode === 'week') a.setDate(a.getDate() + direction * 7);
  else a.setMonth(a.getMonth() + direction);
  st.anchor = a;
  renderProgress();
}

function formatPeriodLabel(mode, range) {
  if (mode === 'month') {
    return range.start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
  }
  const sameMonth = moscowParts(range.start).month === moscowParts(range.end).month;
  const startStr = range.start.toLocaleDateString('ru-RU', { day: 'numeric', month: sameMonth ? undefined : 'short', timeZone: 'Europe/Moscow' });
  const endStr = range.end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
  return `${startStr}–${endStr}`;
}

function updatePeriodNav(chartKey, range, entries) {
  const first = firstRecordDate(entries);
  const nowRange = getPeriodRange(chartPeriod[chartKey].mode, new Date());
  document.getElementById(chartKey + 'PeriodLabel').textContent = formatPeriodLabel(chartPeriod[chartKey].mode, range);
  document.getElementById(chartKey + 'PrevBtn').disabled = !first || range.start <= getPeriodRange(chartPeriod[chartKey].mode, first).start;
  document.getElementById(chartKey + 'NextBtn').disabled = range.end >= nowRange.end;
}

// Разбивает диапазон [start, end] на 7-дневные блоки (используется для режима
// «месяц» — так график остаётся читаемым и не превращается в частокол из
// ~28–31 узких столбиков; последний блок в конце месяца может быть короче).
function chunkRangeByWeek(start, end) {
  const chunks = [];
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = new Date(cur.getTime() + 6 * MS_PER_DAY);
    const actualEnd = endOfDay(chunkEnd) > end ? new Date(end) : endOfDay(chunkEnd);
    chunks.push({ start: new Date(cur), end: actualEnd });
    cur = new Date(startOfDay(actualEnd).getTime() + MS_PER_DAY);
  }
  return chunks;
}

function sumInRange(entries, field, start, end) {
  return entries.filter((e) => { const d = new Date(e.date); return d >= start && d <= end; }).reduce((s, e) => s + (e[field] || 0), 0);
}

// values для дневного (недельного) режима: по одному числу на каждый день Пн..Вс.
function dailySeries(entries, field, range) {
  const values = [], labels = [];
  let d = new Date(range.start);
  while (d <= range.end) {
    values.push(sumInRange(entries, field, d, endOfDay(d)));
    labels.push(d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'Europe/Moscow' }));
    d = new Date(d.getTime() + MS_PER_DAY);
  }
  return { values, labels };
}

// values для месячного режима: среднее в день по 7-дневным блокам внутри месяца.
function monthlyChunkedSeries(entries, field, range, aggregate) {
  const chunks = chunkRangeByWeek(range.start, range.end);
  const values = [], labels = [];
  chunks.forEach((c) => {
    const sum = sumInRange(entries, field, c.start, c.end);
    const days = Math.round((c.end - c.start) / MS_PER_DAY) + 1;
    values.push(aggregate === 'avg' ? sum / days : sum);
    labels.push(chunkLabel(c));
  });
  return { values, labels };
}

// Вес — особый случай: в отличие от калорий/воды, «0 кг» не является
// осмысленным значением дня без записи, поэтому дни/блоки без реальной записи
// веса помечаются как null (а не 0) — renderBars рисует под ними пустую
// колонку без столбика. При этом сама колонка ВСЕГДА присутствует (даже без
// записи) — иначе, например, единственная запись веса за неделю становится
// единственным столбиком и растягивается на всю ширину и высоту графика.
function weightWeekSeries(range) {
  const entries = appState.weights;
  const values = [], labels = [];
  let d = new Date(range.start);
  while (d <= range.end) {
    const dayEnd = endOfDay(d);
    const dayEntries = entries.filter((e) => { const ed = new Date(e.date); return ed >= d && ed <= dayEnd; });
    values.push(dayEntries.length ? dayEntries[dayEntries.length - 1].kilograms : null);
    labels.push(d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'Europe/Moscow' }));
    d = new Date(d.getTime() + MS_PER_DAY);
  }
  return { values, labels };
}

function weightMonthSeries(range) {
  const entries = appState.weights;
  const chunks = chunkRangeByWeek(range.start, range.end);
  const values = [], labels = [];
  chunks.forEach((c) => {
    const inChunk = entries.filter((e) => { const d = new Date(e.date); return d >= c.start && d <= c.end; });
    values.push(inChunk.length ? inChunk.reduce((s, e) => s + e.kilograms, 0) / inChunk.length : null);
    labels.push(chunkLabel(c));
  });
  return { values, labels };
}

function getSeries(chartKey, field, aggregateInMonth) {
  const st = chartPeriod[chartKey];
  const entries = entriesForChart(chartKey);
  st.anchor = clampAnchor(st.mode, st.anchor, entries);
  const range = getPeriodRange(st.mode, st.anchor);
  updatePeriodNav(chartKey, range, entries);

  if (chartKey === 'weight') {
    return st.mode === 'week' ? weightWeekSeries(range) : weightMonthSeries(range);
  }
  return st.mode === 'week' ? dailySeries(entries, field, range) : monthlyChunkedSeries(entries, field, range, aggregateInMonth);
}

// Анимация: столбики сначала отрисовываются нулевой высоты, затем на
// следующем кадре получают реальную высоту — CSS-переход (ease-out) на
// height даёт эффект «заполнения слева направо с замедлением в конце»,
// т.к. у каждого столбика свой transition-delay по индексу.
function renderBars(containerId, values, labels, tint, decimals = 0) {
  const el = document.getElementById(containerId);
  // null — это «нет записи за день» (используется для веса), а не значение 0;
  // если реальных данных нет вовсе — показываем то же пустое состояние, что и
  // при полностью пустом массиве.
  const realValues = values.filter((v) => v != null);
  if (!values.length || !realValues.length) {
    el.innerHTML = `<div class="empty"><span class="ico">📊</span>Пока недостаточно данных за этот период.</div>`;
    return;
  }
  const max = Math.max(...realValues, 1);
  // Для null-колонок высота строго 0 (пустая колонка), а не минимальные 6px,
  // которые использует значение 0 у калорий/воды — иначе "нет записи" визуально
  // не отличить от "записано 0".
  const heights = values.map((v) => (v == null ? 0 : Math.max(6, (v / max) * 120)));
  el.innerHTML = `<div class="chartcard"><div class="bars">${values.map((v, i) => `
    <div class="col">
      <div class="val">${v == null ? '' : v.toFixed(decimals)}</div>
      <div class="stick" data-h="${heights[i]}" style="height:0px;background:${tint};transition-delay:${i * 45}ms"></div>
      <div class="lbl">${labels ? labels[i] : ''}</div>
    </div>`).join('')}</div></div>`;
  requestAnimationFrame(() => {
    el.querySelectorAll('.stick').forEach((s) => { s.style.height = s.dataset.h + 'px'; });
  });
}

function renderMacroSummary(range) {
  const protein = sumInRange(appState.foods, 'protein', range.start, range.end);
  const fat = sumInRange(appState.foods, 'fat', range.start, range.end);
  const carbs = sumInRange(appState.foods, 'carbs', range.start, range.end);
  document.getElementById('calSummaryProtein').textContent = Math.round(protein) + ' г';
  document.getElementById('calSummaryFat').textContent = Math.round(fat) + ' г';
  document.getElementById('calSummaryCarbs').textContent = Math.round(carbs) + ' г';
  document.getElementById('calSummaryLabel').textContent = chartPeriod.calories.mode === 'week' ? 'за неделю' : 'за месяц';
}

function renderProgress() {
  const w = getSeries('weight', 'kilograms', 'avg');
  renderBars('weightChart', w.values, w.labels, 'var(--accent)', 1);

  const c = getSeries('calories', 'calories', 'avg');
  renderBars('calChart', c.values, c.labels, 'var(--orange)');
  renderMacroSummary(getPeriodRange(chartPeriod.calories.mode, chartPeriod.calories.anchor));

  const wt = getSeries('water', 'amount', 'avg');
  renderBars('waterProgressChart', wt.values, wt.labels, '#2ea6c9');
}

// ---------- Награды ----------
function renderAchievements() {
  renderMainGoal();
  renderQuestList('dailyQuestList', dailyQuestItems());
  renderQuestList('weeklyQuestList', weeklyQuestItems());
  renderMilestones();
}

function renderMainGoal() {
  const el = document.getElementById('mainGoalCard');
  const mg = appState.achievements && appState.achievements.mainGoal;
  if (!mg) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="main-goal-card ${mg.done ? '' : 'locked'}">
      <div class="mg-icon">${mg.done ? '🏆' : '🔒'}</div>
      <h3>Пушинка!${mg.done ? ' ✅' : ''}</h3>
      <p>${mg.done
        ? `Вы достигли желаемого веса — ${mg.goalWeight.toFixed(0)} кг! Это главная награда ЯХУ.`
        : `Присваивается, когда вы достигнете желаемого веса ${mg.goalWeight.toFixed(0)} кг.`}</p>
    </div>`;
}

// Ежедневные задания: подводятся итогом каждого прошедшего дня на сервере
// (lib/achievements.js) — здесь только отображение сегодняшнего статуса
// и накопленной коллекции ("×N" — сколько раз всего выполнено).
function dailyQuestItems() {
  const d = appState.achievements && appState.achievements.daily;
  if (!d) return [];
  return [
    { icon: '🔥', title: 'Не превышено калорий', done: d.calories.done, count: d.calories.collected,
      detail: d.calories.done ? 'Сегодня в пределах нормы' : 'Пока не выполнено сегодня' },
    { icon: '💧', title: 'Выпита норма воды', done: d.water.done, count: d.water.collected,
      detail: d.water.done ? 'Норма на сегодня выполнена' : 'Пока не выполнено сегодня' },
    { icon: '⚖️', title: 'Записан вес', done: d.weight.done, count: d.weight.collected,
      detail: d.weight.done ? 'Вес сегодня отмечен' : 'Ещё не отмечено сегодня' },
  ];
}

function weeklyQuestItems() {
  const w = appState.achievements && appState.achievements.weekly;
  if (!w) return [];
  return [
    { icon: '📆', title: 'Слежу за калориями', done: w.calories.progress === w.calories.total, count: w.calories.collected,
      detail: `${w.calories.progress} из ${w.calories.total} дней на этой неделе без превышения` },
    { icon: '🚰', title: 'Любитель воды', done: w.water.progress === w.water.total, count: w.water.collected,
      detail: `${w.water.progress} из ${w.water.total} дней на этой неделе выполнена норма` },
  ];
}

function renderQuestList(containerId, items) {
  document.getElementById(containerId).innerHTML = items.map((it) => `
    <div class="quest-row">
      <div class="quest-icon" style="background:${it.done ? '#fdeec2' : '#eef0ed'}">${it.icon}</div>
      <div><div class="quest-title">${it.title}</div><div class="quest-detail">${it.detail}</div></div>
      <div class="quest-status">
        <span class="quest-count">×${it.count}</span>
        <span class="quest-check">${it.done ? '✅' : '⏳'}</span>
      </div>
    </div>`).join('');
}

// Вехи — разовые достижения по общему факту использования приложения
// (не завязаны на конкретный день/неделю, поэтому считаются на клиенте).
function renderMilestones() {
  const uniqueDays = new Set(appState.foods.map((f) => startOfDay(new Date(f.date)).getTime())).size;
  const remindersOn = !!(appState.reminders && (appState.reminders.water.enabled || appState.reminders.stretch.enabled));
  const items = [
    { title: 'Первый шаг', detail: 'Записать первую еду', icon: '🌱', unlocked: appState.foods.length > 0 },
    { title: 'Забота о себе', detail: 'Включить напоминания', icon: '💧', unlocked: remindersOn },
    { title: 'Спокойная неделя', detail: '7 дней с записями', icon: '📅', unlocked: uniqueDays >= 7 },
  ];
  const list = document.getElementById('achList');
  list.innerHTML = items.map((it) => `
    <div class="ach-row">
      <div class="ach-icon" style="background:${it.unlocked ? '#fdeec2' : '#eef0ed'}">${it.icon}</div>
      <div><div class="ach-title">${it.title}</div><div class="ach-detail">${it.detail}</div></div>
      <div class="ach-check">${it.unlocked ? '✅' : '🔒'}</div>
    </div>`).join('');
}

// ---------- Напоминания (вода и разминка — отдельно, настраиваемый интервал, кратно 5 мин) ----------
const reminderTimers = { water: null, stretch: null };
// Конфигурация, для которой СЕЙЧАС запущен таймер каждого напоминания. Нужна,
// чтобы отличить «пользователь и правда изменил напоминание» от «render()
// вызвался по любой другой причине» (добавили еду/воду, сохранили профиль
// и т.п.) — раньше renderReminders() безусловно пересоздавал оба таймера
// при КАЖДОМ render(), поэтому отсчёт до напоминания обнулялся любым
// действием в приложении и мог никогда не долетать до нуля.
const appliedReminderConfig = { water: null, stretch: null };
const REMINDER_MESSAGES = { water: '💧 Время попить воды', stretch: '🧘 Время для небольшой разминки' };

function renderReminders() {
  const r = appState.reminders;
  if (!r) return;
  ['water', 'stretch'].forEach((kind) => {
    const cfg = r[kind];
    document.getElementById(kind + 'ReminderToggle').classList.toggle('on', cfg.enabled);
    document.getElementById(kind + 'IntervalLabel').textContent = `Каждые ${cfg.intervalMinutes} мин`;
    applyReminderTimer(kind, cfg);
  });
}

function applyReminderTimer(kind, cfg) {
  const prev = appliedReminderConfig[kind];
  const unchanged = prev && prev.enabled === cfg.enabled && prev.intervalMinutes === cfg.intervalMinutes;
  if (unchanged) return; // ничего не поменялось — не трогаем уже идущий отсчёт
  appliedReminderConfig[kind] = { enabled: cfg.enabled, intervalMinutes: cfg.intervalMinutes };

  clearInterval(reminderTimers[kind]);
  reminderTimers[kind] = null;
  if (cfg.enabled && cfg.intervalMinutes > 0) {
    reminderTimers[kind] = setInterval(() => fireReminder(kind), cfg.intervalMinutes * 60 * 1000);
  }
}

// Тексты и иконки для каждого вида напоминания — единственное, что зависит
// от kind; сама механика показа/звука общая.
const REMINDER_INFO = {
  water: { icon: '💧', phrase: 'пора выпить воды', tip: 'Небольшой стакан воды сейчас — и организм скажет спасибо.' },
  stretch: { icon: '🧘', phrase: 'сделать разминку', tip: 'Встаньте, потянитесь, разомните шею и плечи — пары минут достаточно.' },
};

// Показывает крупное модальное окно напоминания. <dialog>.showModal() поднимает
// элемент в top layer браузера, поэтому окно оказывается поверх содержимого
// ЛЮБОГО раздела приложения — не важно, какой экран сейчас открыт.
function showReminderPopup(kind) {
  const info = REMINDER_INFO[kind];
  const name = appState.profile && appState.profile.firstName ? appState.profile.firstName.trim() : '';
  const title = name ? `${name}, ${info.phrase}` : `Эй, ${info.phrase}`;
  document.getElementById('reminderModalIcon').textContent = info.icon;
  document.getElementById('reminderModalTitle').textContent = title.charAt(0).toUpperCase() + title.slice(1);
  document.getElementById('reminderModalTip').textContent = info.tip;
  const dialog = document.getElementById('reminderDialog');
  if (!dialog.open) dialog.showModal();
}

// ---------- Общий звук приложения (Web Audio API) ----------
// Генерируем короткие звуки сами, без аудиофайлов — работает даже по обычному
// http (в отличие от системных Notification, которым для многих браузеров
// нужен именно https). AudioContext создаём один раз и стараемся "разбудить"
// его при первом клике пользователя по странице — иначе браузеры блокируют
// звук, запущенный не от прямого действия пользователя (например, из
// сработавшего таймера напоминания).
let appAudioCtx = null;
function ensureAppAudioContext() {
  if (!appAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    appAudioCtx = new Ctx();
  }
  if (appAudioCtx.state === 'suspended') appAudioCtx.resume().catch(() => {});
  return appAudioCtx;
}

function playReminderBeep() {
  const ctx = ensureAppAudioContext();
  if (!ctx) return;
  // Два коротких мягких тона подряд — заметно, но не резко ("аккуратный бип").
  [880, 660].forEach((freq, i) => {
    const start = ctx.currentTime + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.26);
  });
}

// Негромкий короткий "тик" при нажатии любой кнопки в приложении — заметно
// тише и короче сигнала напоминания (одиночный тон ~90мс, вместо двойного
// ~400мс), чтобы не раздражать при частых нажатиях.
function playClickSound() {
  const ctx = ensureAppAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(720, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.07, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

// Единая точка входа для отклика на нажатие: звук + короткое визуальное
// "сжатие" (совпадает с CSS-переходом transform в :active, но :active не
// всегда надёжно ловится на мобильных тачскринах, поэтому дублируем классом).
// Событие ловим один раз на document (делегирование) — работает для ЛЮБОЙ
// кнопки в приложении, включая те, что появляются позже (диалоги, списки).
document.addEventListener('pointerdown', (e) => {
  const control = e.target.closest('button, .toggle, .photo-upload-btn');
  if (!control || control.disabled) return;
  ensureAppAudioContext(); // тот же клик "разбудит" звук и для будущих напоминаний
  playClickSound();
  control.classList.add('pressed');
}, true);
document.addEventListener('pointerup', (e) => {
  const control = e.target.closest('button, .toggle, .photo-upload-btn');
  control && control.classList.remove('pressed');
}, true);
document.addEventListener('pointercancel', (e) => {
  const control = e.target.closest('button, .toggle, .photo-upload-btn');
  control && control.classList.remove('pressed');
}, true);

// Показывает крупное модальное окно (поверх любого раздела) со звуковым
// сигналом — и, если разрешено, дополнительно системное уведомление на
// случай, если вкладка свёрнута или экран заблокирован.
function fireReminder(kind) {
  showReminderPopup(kind);
  playReminderBeep();
  if (window.Notification && Notification.permission === 'granted') {
    try {
      new Notification('ЯХУ · Я ХУДЕЮ', { body: REMINDER_MESSAGES[kind], icon: '/icons/icon-192.png', tag: 'yahu-reminder-' + kind });
    } catch (e) { /* некоторые браузеры не поддерживают Notification вне service worker — не критично, окно уже показано */ }
  }
}

async function saveReminders() {
  appState = await api.post('/api/reminders', appState.reminders);
  renderReminders();
  renderAchievements();
}

function toggleReminderKind(kind) {
  const cfg = appState.reminders[kind];
  cfg.enabled = !cfg.enabled;
  if (cfg.enabled) {
    ensureAppAudioContext(); // подготавливаем звук заранее, пока есть клик пользователя
    // Системные уведомления требуют разрешения браузера — запрашиваем его
    // именно в момент включения напоминания (по клику пользователя), иначе
    // браузер такой запрос молча игнорирует.
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
  toast(cfg.enabled
    ? `${kind === 'water' ? '💧 Напоминания пить воду' : '🧘 Напоминания о разминке'} включены — каждые ${cfg.intervalMinutes} мин`
    : `${kind === 'water' ? 'Напоминания пить воду' : 'Напоминания о разминке'} выключены`);
  logAction(cfg.enabled ? 'Включено напоминание' : 'Выключено напоминание', kind === 'water' ? 'Пить воду' : 'Сделать разминку');
  saveReminders();
}

function adjustReminderInterval(kind, delta) {
  const cfg = appState.reminders[kind];
  cfg.intervalMinutes = Math.max(5, Math.min(240, cfg.intervalMinutes + delta));
  logAction('Изменён интервал напоминания', `${kind === 'water' ? 'Пить воду' : 'Сделать разминку'}: ${cfg.intervalMinutes} мин`);
  saveReminders();
}

// ---------- Диалог: еда (поиск только по собственной базе dishes.xlsx) ----------
function openFoodForm() {
  selectedFood = null;
  editingFoodId = null;
  document.getElementById('foodDialogTitle').textContent = 'Записать еду';
  document.getElementById('saveFoodButton').textContent = 'Добавить';
  document.getElementById('foodName').value = '';
  document.getElementById('foodPortion').value = 120;
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('estimateLabel').textContent = 'Введите название блюда';
  document.getElementById('foodEstimate').textContent = '— ккал';
  document.getElementById('estimateDetail').textContent = 'Начните печатать — подсказки появятся сразу.';
  document.getElementById('saveFoodButton').disabled = true;
  hideManualEntry();
  document.getElementById('foodDialog').showModal();
  setTimeout(() => document.getElementById('foodName').focus(), 100);
}

// Открывает тот же диалог добавления еды, но в режиме редактирования уже
// существующей записи: подставляет название и порцию, а дальше пользователь
// может как поправить вес порции (пересчитается автоматически), так и найти
// в поиске другое блюдо, если ошибся в названии.
async function editFood(id) {
  const food = appState.foods.find((f) => f.id === id);
  if (!food) return;
  selectedFood = null;
  editingFoodId = id;
  document.getElementById('foodDialogTitle').textContent = 'Редактировать запись';
  document.getElementById('saveFoodButton').textContent = 'Сохранить';
  document.getElementById('searchResults').innerHTML = '';
  hideManualEntry();
  document.getElementById('foodName').value = food.name;
  // Старые записи (до появления поля grams) веса порции не хранят — берём
  // 100 г как нейтральную базу пересчёта, чтобы уже сохранённые Б/Ж/У не исказились.
  const baseGrams = food.grams > 0 ? food.grams : 100;
  document.getElementById('foodPortion').value = baseGrams;
  document.getElementById('foodDialog').showModal();
  setTimeout(() => document.getElementById('foodName').focus(), 100);

  // Пытаемся найти это же блюдо в базе — тогда при изменении веса порции всё
  // пересчитается по настоящим данным на 100 г. Если блюда больше нет в базе
  // (или запись была добавлена вручную), собираем профиль "на 100 г" из уже
  // сохранённых значений — это не исказит исходные Б/Ж/У, даже если точный
  // вес порции неизвестен.
  let matchedDish = null;
  try {
    const data = await api.get('/api/dishes/search?query=' + encodeURIComponent(food.name));
    matchedDish = (data.dishes || []).find((d) => d.name.toLowerCase() === food.name.toLowerCase()) || null;
  } catch (e) { /* поиск не удался — используем данные из самой записи ниже */ }

  if (editingFoodId !== id) return; // пользователь уже закрыл/сменил диалог, пока шёл запрос

  if (matchedDish) {
    selectFood({
      name: matchedDish.name, kcal: matchedDish.kcal100, protein: matchedDish.protein100,
      fat: matchedDish.fat100, carbs: matchedDish.carbs100, portion: baseGrams, isWater: !!matchedDish.isWater,
    }, null, false);
  } else {
    selectFood({
      name: food.name,
      kcal: round1((food.calories / baseGrams) * 100),
      protein: round1((food.protein / baseGrams) * 100),
      fat: round1((food.fat / baseGrams) * 100),
      carbs: round1((food.carbs / baseGrams) * 100),
      portion: baseGrams,
      isWater: false,
    }, null, false);
  }
}

function searchFood() {
  clearTimeout(searchTimer);
  selectedFood = null;
  updateEstimate();
  const query = document.getElementById('foodName').value.trim();
  const results = document.getElementById('searchResults');
  results.innerHTML = '';
  if (query.length < 1) {
    document.getElementById('estimateLabel').textContent = 'Введите название блюда';
    document.getElementById('estimateDetail').textContent = 'Начните печатать — подсказки появятся сразу.';
    hideManualEntry();
    return;
  }
  document.getElementById('estimateLabel').textContent = 'Ищем в базе блюд ЯХУ…';
  document.getElementById('estimateDetail').textContent = '';
  searchTimer = setTimeout(() => loadFoodResults(query), 150);
}

async function loadFoodResults(query) {
  const request = ++activeSearch;
  try {
    const data = await api.get('/api/dishes/search?query=' + encodeURIComponent(query));
    if (request !== activeSearch || document.getElementById('foodName').value.trim() !== query) return;
    const dishes = (data.dishes || []).map((d) => ({
      name: d.name,
      kcal: d.kcal100,
      protein: d.protein100,
      fat: d.fat100,
      carbs: d.carbs100,
      portion: d.portion,
      isWater: !!d.isWater,
    }));
    renderSearchResults(dishes);
  } catch (e) {
    if (request !== activeSearch) return;
    document.getElementById('estimateLabel').textContent = 'Не удалось выполнить поиск';
    document.getElementById('estimateDetail').textContent = 'Попробуйте ещё раз или введите калории вручную.';
    showManualEntry();
  }
}

function renderSearchResults(dishes) {
  const results = document.getElementById('searchResults');
  results.innerHTML = '';
  if (!dishes.length) {
    document.getElementById('estimateLabel').textContent = 'В базе ЯХУ не нашли такого блюда';
    document.getElementById('estimateDetail').textContent = 'Введите калорийность вручную ниже.';
    showManualEntry();
    return;
  }
  hideManualEntry();
  dishes.forEach((food) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-result';
    const waterTag = food.isWater ? ' 💧' : '';
    item.innerHTML = `<b>${escapeHtml(food.name)}${waterTag}</b><small>${food.kcal} ккал на 100 г · Б${food.protein} Ж${food.fat} У${food.carbs}</small>`;
    item.onclick = () => selectFood(food, item, true);
    results.appendChild(item);
  });
  selectFood(dishes[0], results.firstChild);
}

function showManualEntry() {
  document.getElementById('manualEntryBlock').style.display = 'block';
}
function hideManualEntry() {
  document.getElementById('manualEntryBlock').style.display = 'none';
  document.getElementById('manualCalories').value = '';
}
function useManualCalories() {
  const name = document.getElementById('foodName').value.trim();
  const kcal = Number(document.getElementById('manualCalories').value);
  if (!name || !Number.isFinite(kcal) || kcal <= 0) {
    toast('Укажите блюдо и калорийность на 100 г');
    return;
  }
  // Для ручного ввода БЖУ и признак «вода» неизвестны — считаем только калории.
  selectFood({ name, kcal, protein: 0, fat: 0, carbs: 0, isWater: false }, null);
}

function selectFood(food, el, userInitiated) {
  selectedFood = food;
  document.querySelectorAll('.search-result').forEach((n) => n.classList.remove('selected'));
  if (el) el.classList.add('selected');
  // Обновляем видимый текст в поле только при явном клике по подсказке — иначе
  // автовыбор первого результата после каждой напечатанной буквы перебивал бы
  // то, что пользователь ещё печатает.
  if (userInitiated) document.getElementById('foodName').value = food.name;
  if (food.portion) document.getElementById('foodPortion').value = food.portion;
  updateEstimate();
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function updateEstimate() {
  const grams = Number(document.getElementById('foodPortion').value) || 0;
  const button = document.getElementById('saveFoodButton');
  if (!selectedFood || grams <= 0) {
    document.getElementById('foodEstimate').textContent = '— ккал';
    button.disabled = true;
    return;
  }
  const calories = Math.round((selectedFood.kcal * grams) / 100);
  const protein = round1((selectedFood.protein * grams) / 100);
  const fat = round1((selectedFood.fat * grams) / 100);
  const carbs = round1((selectedFood.carbs * grams) / 100);
  document.getElementById('estimateLabel').textContent = `${selectedFood.name} · ${selectedFood.kcal} ккал на 100 г`;
  document.getElementById('foodEstimate').textContent = calories + ' ккал';
  document.getElementById('estimateDetail').textContent = selectedFood.isWater
    ? `${grams} г · засчитается как ${grams} мл воды 💧`
    : `${grams} г · Б${protein} Ж${fat} У${carbs} г`;
  button.disabled = false;
}

async function saveFood(event) {
  event.preventDefault();
  const grams = Number(document.getElementById('foodPortion').value);
  if (!selectedFood || !grams) return;
  // ВАЖНО: имя берём из выбранного объекта блюда (selectedFood), а не из текста
  // в поле ввода — пользователь мог напечатать только часть названия ("вода"),
  // и сервер ищет точное совпадение по базе, чтобы определить isWater и т.д.
  const name = selectedFood.name;
  const calories = Math.round((selectedFood.kcal * grams) / 100);
  const protein = round1((selectedFood.protein * grams) / 100);
  const fat = round1((selectedFood.fat * grams) / 100);
  const carbs = round1((selectedFood.carbs * grams) / 100);
  const wasWater = !!selectedFood.isWater;
  const payload = { name, calories, protein, fat, carbs, grams };

  if (editingFoodId) {
    appState = await api.put('/api/foods/' + editingFoodId, payload);
    editingFoodId = null;
    document.getElementById('foodDialog').close();
    render();
    toast(`Запись обновлена: ${name} · ${calories} ккал`);
    logAction('Отредактирована запись еды', `${name} · ${calories} ккал, ${grams} г`);
    return;
  }

  appState = await api.post('/api/foods', payload);
  document.getElementById('foodDialog').close();
  render();
  if (!appState.isOverBudget) {
    toast(wasWater ? `Добавлено: ${name} · +${grams} мл воды 💧` : `Добавлено: ${name} · ${calories} ккал`);
  }
  logAction('Добавлена еда', `${name} · ${calories} ккал, ${grams} г${wasWater ? ' (учтено как вода)' : ''}`);
}

// ---------- Диалог: вес ----------
function openWeightForm() {
  document.getElementById('weightInput').value = appState.lastWeight ? appState.lastWeight.toFixed(1) : '';
  document.getElementById('weightDialog').showModal();
  setTimeout(() => document.getElementById('weightInput').focus(), 100);
}

async function saveWeight(event) {
  event.preventDefault();
  const raw = document.getElementById('weightInput').value.replace(',', '.');
  const kilograms = Number(raw);
  if (!Number.isFinite(kilograms) || kilograms <= 0) return;
  appState = await api.post('/api/weights', { kilograms });
  document.getElementById('weightDialog').close();
  render();
  toast('Вес сохранён');
  logAction('Записан вес', `${kilograms} кг`);
}

// ---------- Профиль ----------
let selectedGender = '';

function renderProfile() {
  const p = appState.profile || {};

  // Кнопка-аватар в правом верхнем углу каждого раздела: показываем фото,
  // если оно есть, иначе иконку-заглушку. Кнопка продублирована на всех
  // экранах (data-profile-btn), поэтому обновляем их все разом.
  document.querySelectorAll('[data-profile-btn]').forEach((avatarBtn) => {
    if (p.photoDataUrl) {
      avatarBtn.style.backgroundImage = `url("${p.photoDataUrl}")`;
      avatarBtn.textContent = '';
    } else {
      avatarBtn.style.backgroundImage = '';
      avatarBtn.textContent = '🌿';
    }
  });

  // Фото в самом разделе профиля
  const photoPreview = document.getElementById('profilePhotoPreview');
  const removeBtn = document.getElementById('photoRemoveBtn');
  if (p.photoDataUrl) {
    photoPreview.style.backgroundImage = `url("${p.photoDataUrl}")`;
    photoPreview.textContent = '';
    removeBtn.style.display = 'inline-block';
  } else {
    photoPreview.style.backgroundImage = '';
    photoPreview.textContent = '👤';
    removeBtn.style.display = 'none';
  }

  // Поля формы — не перетираем то, что пользователь сейчас печатает: обновляем
  // только если поле не в фокусе.
  const setIfNotFocused = (id, value) => {
    const el = document.getElementById(id);
    if (document.activeElement !== el) el.value = value ?? '';
  };
  setIfNotFocused('profileFirstName', p.firstName);
  setIfNotFocused('profileLastName', p.lastName);
  setIfNotFocused('profileBirthYear', p.birthYear);
  setIfNotFocused('profileTargetWeight', p.targetWeight);
  autoCalcAge(); // возраст всегда пересчитывается из года рождения, а не хранится независимо

  selectedGender = p.gender || '';
  document.querySelectorAll('.gender-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.gender === selectedGender);
  });
}

// Возраст считается автоматически по году рождения — поле только для отображения.
function autoCalcAge() {
  const birthYear = Number(document.getElementById('profileBirthYear').value);
  const ageInput = document.getElementById('profileAge');
  const currentYear = new Date().getFullYear();
  if (birthYear && birthYear >= 1900 && birthYear <= currentYear) {
    ageInput.value = currentYear - birthYear;
  } else {
    ageInput.value = '';
  }
}

function setGender(g) {
  selectedGender = selectedGender === g ? '' : g; // повторный клик снимает выбор
  document.querySelectorAll('.gender-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.gender === selectedGender);
  });
}

async function saveProfile(event) {
  event.preventDefault();
  const body = {
    firstName: document.getElementById('profileFirstName').value.trim(),
    lastName: document.getElementById('profileLastName').value.trim(),
    age: document.getElementById('profileAge').value,
    birthYear: document.getElementById('profileBirthYear').value,
    gender: selectedGender,
    targetWeight: document.getElementById('profileTargetWeight').value.replace(',', '.'),
  };
  const result = await api.post('/api/profile', body);
  if (result.error) { toast(result.error); return; }
  appState = result;
  render();
  toast('Профиль сохранён');
  logAction('Сохранён профиль', `${body.firstName} ${body.lastName}`.trim() || '(без имени)');
}

function handlePhotoSelect(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // сброс, чтобы повторный выбор того же файла тоже сработал
  if (!file) return;

  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    toast('Допустимы только файлы JPEG или PNG');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast('Файл больше 5 МБ — выберите другой');
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const result = await api.post('/api/profile/photo', { dataUrl: reader.result });
      if (result.error) { toast(result.error); return; }
      appState = result;
      render();
      toast('Фото обновлено');
      logAction('Загружено фото профиля', file.name);
    } catch (e) {
      toast('Не удалось загрузить фото');
    }
  };
  reader.onerror = () => toast('Не удалось прочитать файл');
  reader.readAsDataURL(file);
}

async function removePhoto() {
  appState = await api.del('/api/profile/photo');
  render();
  toast('Фото удалено');
  logAction('Удалено фото профиля');
}

loadState();

// ---------- Инструмент разработчика (журнал действий пользователя) ----------
function openDevToolsAuth() {
  document.getElementById('devToolsPassword').value = '';
  document.getElementById('devToolsAuthError').textContent = '';
  document.getElementById('devToolsAuthDialog').showModal();
  setTimeout(() => document.getElementById('devToolsPassword').focus(), 100);
}

async function submitDevToolsPassword(event) {
  event.preventDefault();
  const password = document.getElementById('devToolsPassword').value;
  const errorEl = document.getElementById('devToolsAuthError');
  let data;
  try {
    data = await api.post('/api/devtools/auth', { password });
  } catch (e) {
    errorEl.textContent = 'Не удалось проверить пароль — попробуйте ещё раз';
    return;
  }
  if (data.ok) {
    document.getElementById('devToolsAuthDialog').close();
    showScreen('devtools');
    renderDevLog();
  } else {
    errorEl.textContent = 'Неверный пароль';
    document.getElementById('devToolsPassword').value = '';
    document.getElementById('devToolsPassword').focus();
  }
}

function closeDevTools() {
  showScreen('profile');
}

async function renderDevLog() {
  renderStorageStatus();
  const list = document.getElementById('devLogList');
  list.innerHTML = `<div class="empty"><span class="ico">⏳</span>Загрузка журнала…</div>`;
  let data;
  try {
    data = await api.get('/api/devlog');
  } catch (e) {
    list.innerHTML = `<div class="empty"><span class="ico">⚠️</span>Не удалось загрузить журнал.</div>`;
    return;
  }
  const entries = data.entries || [];
  if (!entries.length) {
    list.innerHTML = `<div class="empty"><span class="ico">🗒️</span>Журнал пуст.</div>`;
    return;
  }
  list.innerHTML = entries.map((e) => {
    const d = new Date(e.ts);
    const when = `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    return `<div class="devlog-row">
      <div class="dl-action">${escapeHtml(e.action)}</div>
      <div class="dl-meta"><span>${escapeHtml(e.details || '')}</span><span>${when}</span></div>
    </div>`;
  }).join('');
}

async function renderStorageStatus() {
  const el = document.getElementById('storageStatus');
  let health;
  try {
    health = await api.get('/api/health');
  } catch (e) {
    el.innerHTML = `<div class="storage-status warn"><b>⚠️ Не удалось получить статус хранилища</b>Проверьте соединение с сервером.</div>`;
    return;
  }
  const u = health.upstash;
  if (u.configError) {
    el.innerHTML = `<div class="storage-status warn"><b>⚠️ Upstash настроен неверно</b>${escapeHtml(u.configError)}</div>`;
    return;
  }
  if (!u.configured) {
    el.innerHTML = `<div class="storage-status off"><b>💾 Только локальное хранилище</b>Upstash Redis не подключён — на "засыпающем" бесплатном хостинге прогресс будет сбрасываться при пробуждении контейнера. Инструкция — в README, раздел «Хостинг, который засыпает».</div>`;
    return;
  }
  const loadLine = u.lastLoadOk === true ? 'Состояние при старте сервера восстановлено успешно.'
    : u.lastLoadOk === false ? `Ошибка при восстановлении состояния: ${escapeHtml(u.lastLoadError || '')}`
    : 'Восстановление при старте ещё не проверялось.';
  const saveLine = u.lastSaveOk === true ? `Последнее сохранение прошло успешно (${new Date(u.lastSaveAt).toLocaleTimeString('ru-RU')}).`
    : u.lastSaveOk === false ? `Ошибка последнего сохранения: ${escapeHtml(u.lastSaveError || '')}`
    : 'Изменений с момента старта сервера ещё не было.';
  const allGood = u.lastLoadOk !== false && u.lastSaveOk !== false;
  el.innerHTML = `<div class="storage-status ${allGood ? 'ok' : 'warn'}"><b>${allGood ? '✅ Upstash подключён' : '⚠️ Upstash подключён, но есть ошибки'}</b>${loadLine}<br>${saveLine}</div>`;
}

async function clearDevLog() {
  if (!window.confirm('Очистить весь журнал действий? Это необратимо.')) return;
  await api.del('/api/devlog');
  renderDevLog();
}

// ---------- Потяни-чтобы-обновить (pull-to-refresh) ----------
// У мобильных браузеров (включая Safari на iPhone) в режиме открытой вкладки
// или установленного PWA нет системного жеста "потянуть экран вниз, чтобы
// обновить" для веб-страниц — это поведение специфично для Chrome/Android.
// Реализуем его сами: тянем вниз от самого верха страницы — при отпускании
// после небольшого порога происходит обычная полная перезагрузка страницы,
// как кнопка "Обновить" в браузере.
(function setupPullToRefresh() {
  const indicator = document.getElementById('pullToRefresh');
  if (!indicator) return;
  const THRESHOLD = 70; // px, дальше которых при отпускании страница обновится
  const MAX_PULL = 110; // px, дальше индикатор не оттягивается — ощущение "предела"
  let startY = null;
  let currentDist = 0;
  let refreshing = false;

  function reset() {
    indicator.classList.remove('visible', 'ready');
    indicator.style.transform = 'translate(-50%, -60px) rotate(0deg)';
    currentDist = 0;
  }

  document.addEventListener('touchstart', (e) => {
    if (refreshing) return;
    // Жест имеет смысл только от самого верха страницы — иначе это обычный
    // скролл контента вниз/вверх, а не потягивание для обновления.
    startY = window.scrollY <= 0 ? e.touches[0].clientY : null;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY == null || refreshing) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) { reset(); startY = null; return; } // потянули вверх — жест отменён
    currentDist = Math.min(delta, MAX_PULL);
    indicator.classList.add('visible');
    indicator.classList.toggle('ready', currentDist >= THRESHOLD);
    indicator.style.transform = `translate(-50%, ${currentDist - 60}px) rotate(${currentDist * 2.4}deg)`;
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (startY == null || refreshing) return;
    startY = null;
    if (currentDist >= THRESHOLD) {
      refreshing = true;
      indicator.classList.add('spinning');
      indicator.style.transform = 'translate(-50%, 16px) rotate(0deg)';
      logAction('Обновление страницы жестом pull-to-refresh');
      setTimeout(() => window.location.reload(), 250);
    } else {
      reset();
    }
  });
})();

// ---------- PWA: регистрация service worker (кэш оболочки приложения) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* офлайн-кэш необязателен, приложение и без него работает */ });
  });
}
