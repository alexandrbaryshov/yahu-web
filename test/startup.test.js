// Тесты чистых решений старта клиента (public/startup.js): пересчёт снимка
// на сегодня, когда скрывать заставку, хранение снимка v2 и миграция с v1.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STARTUP_FILE = path.join(__dirname, '..', 'public', 'startup.js');
const TODAY_FILE = path.join(__dirname, '..', 'public', 'today.js');
const startup = require(STARTUP_FILE);
const today = require(TODAY_FILE);

// Хранилище с интерфейсом localStorage/sessionStorage.
function fakeStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}

// Снимок «вчерашнего» ответа сервера. Сегодня — 3 октября по МСК.
// 2026-10-02T22:30Z = 3 октября 01:30 МСК (уже сегодня), 2026-10-02T20:00Z = 2 октября 23:00 МСК.
function yesterdaySnapshot() {
  return {
    foods: [
      { id: 'a', calories: 500, protein: 20.04, fat: 10, carbs: 50, date: '2026-10-02T20:00:00.000Z' },
      { id: 'b', calories: 300, protein: 12.26, fat: 7.31, carbs: 40.06, date: '2026-10-02T22:30:00.000Z' },
    ],
    water: [
      { amount: 750, date: '2026-10-02T15:00:00.000Z' },
      { amount: 250, date: '2026-10-03T06:00:00.000Z' },
    ],
    weights: [{ kilograms: 80, date: '2026-09-30T06:00:00.000Z' }, { kilograms: 79.4, date: '2026-10-02T06:00:00.000Z' }],
    dailyTarget: 1800, waterTarget: 1500, startWeight: 85, goalWeight: 70,
    proteinTarget: 90, fatTarget: 60, carbsTarget: 220,
    todayCalories: 1200, todayProtein: 40, todayFat: 30, todayCarbs: 100, todayWater: 750,
    waterRemaining: 750, isOverBudget: false, lastWeight: 79.4,
    motivationalPhrase: 'вчерашняя фраза',
    macroTip: { metLabel: 'белкам', needLabel: 'углеводами', suggestions: [{ name: 'Гречка' }] },
    serverDayKey: '2026-10-02',
    profile: { firstName: 'А', photoVersion: 'abc123abc123' },
  };
}

const NOW = new Date('2026-10-03T09:00:00.000Z'); // 12:00 МСК 3 октября

test('startup.js грузится и в браузере (window.YahuStartup)', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(TODAY_FILE, 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(STARTUP_FILE, 'utf8'), sandbox);
  assert.strictEqual(typeof sandbox.window.YahuStartup.applyLocalToday, 'function');
  const r = sandbox.window.YahuStartup.applyLocalToday(yesterdaySnapshot(), NOW);
  assert.strictEqual(r.todayCalories, 300);
});

test('applyLocalToday: вчерашний снимок → цифры за сегодняшние сутки МСК, фраза дня, без macroTip', () => {
  const snap = yesterdaySnapshot();
  const r = startup.applyLocalToday(snap, NOW);
  assert.strictEqual(r.todayCalories, 300);
  assert.strictEqual(r.todayProtein, 12.3);
  assert.strictEqual(r.todayFat, 7.3);
  assert.strictEqual(r.todayCarbs, 40.1);
  assert.strictEqual(r.todayWater, 250);
  assert.strictEqual(r.waterRemaining, 1250);
  assert.strictEqual(r.isOverBudget, false);
  assert.strictEqual(r.lastWeight, 79.4);
  assert.strictEqual(r.motivationalPhrase, today.getMotivationalPhrase(NOW));
  assert.notStrictEqual(r.motivationalPhrase, 'вчерашняя фраза');
  assert.strictEqual(r.macroTip, null);
  // Остальное не тронуто, исходный снимок не изменён.
  assert.strictEqual(r.goalWeight, 70);
  assert.deepStrictEqual(r.profile, snap.profile);
  assert.strictEqual(snap.todayCalories, 1200);
  assert.ok(snap.macroTip);
});

test('applyLocalToday: без сегодняшних записей — нули; снимок сегодняшний — macroTip остаётся', () => {
  const snap = yesterdaySnapshot();
  const empty = startup.applyLocalToday(snap, new Date('2026-10-05T09:00:00.000Z'));
  assert.strictEqual(empty.todayCalories, 0);
  assert.strictEqual(empty.todayProtein, 0);
  assert.strictEqual(empty.todayWater, 0);
  assert.strictEqual(empty.waterRemaining, 1500);
  snap.serverDayKey = '2026-10-03';
  const sameDay = startup.applyLocalToday(snap, NOW);
  assert.deepStrictEqual(sameDay.macroTip, snap.macroTip);
});

test('applyLocalToday: снимок без serverDayKey (старый v1) — macroTip скрыт', () => {
  const snap = yesterdaySnapshot();
  delete snap.serverDayKey;
  snap.serverDayKey = undefined;
  assert.strictEqual(startup.applyLocalToday(snap, NOW).macroTip, null);
});

test('splashDecision: свежий ответ — не раньше 3,5 с', () => {
  const d = (ms) => startup.splashDecision({ elapsedMs: ms, hasSnapshot: true, hasFresh: true, failed: false, repeatVisit: false });
  assert.strictEqual(d(1000).hide, false);
  assert.strictEqual(d(3499).hide, false);
  assert.strictEqual(d(3500).hide, true);
});

test('splashDecision: есть снимок, нет ответа — ждём до 6 с', () => {
  const d = (ms, failed) => startup.splashDecision({ elapsedMs: ms, hasSnapshot: true, hasFresh: false, failed: !!failed, repeatVisit: false });
  assert.strictEqual(d(3500).hide, false);
  assert.strictEqual(d(5999).hide, false);
  assert.strictEqual(d(6000).hide, true);
  // Запрос уже упал — ждать больше нечего, но минимум 3,5 с держим.
  assert.strictEqual(d(2000, true).hide, false);
  assert.strictEqual(d(3500, true).hide, true);
});

test('splashDecision: без снимка — до ответа сервера, подсказка после 6 с, ошибка при неудаче', () => {
  const d = (ms, failed) => startup.splashDecision({ elapsedMs: ms, hasSnapshot: false, hasFresh: false, failed: !!failed, repeatVisit: false });
  assert.deepStrictEqual(d(5999), { hide: false, slowHint: false, showError: false });
  assert.deepStrictEqual(d(6000), { hide: false, slowHint: true, showError: false });
  assert.deepStrictEqual(d(59000), { hide: false, slowHint: true, showError: false });
  assert.strictEqual(d(60000, true).hide, false);
  assert.strictEqual(d(60000, true).showError, true);
  const fresh = startup.splashDecision({ elapsedMs: 20000, hasSnapshot: false, hasFresh: true, failed: false, repeatVisit: false });
  assert.strictEqual(fresh.hide, true);
});

test('splashDecision: повторная загрузка в той же вкладке — сразу, если есть что показать', () => {
  assert.strictEqual(startup.splashDecision({ elapsedMs: 0, hasSnapshot: true, hasFresh: false, failed: false, repeatVisit: true }).hide, true);
  assert.strictEqual(startup.splashDecision({ elapsedMs: 0, hasSnapshot: false, hasFresh: false, failed: false, repeatVisit: true }).hide, false);
});

test('shouldSkipSplash: только при отметке сессии и наличии снимка', () => {
  const marked = () => fakeStorage({ 'yahu:splashShown': '1' });
  assert.strictEqual(startup.shouldSkipSplash(fakeStorage(), fakeStorage({ 'yahu:lastState:v2': '{}' })), false);
  assert.strictEqual(startup.shouldSkipSplash(marked(), fakeStorage()), false);
  assert.strictEqual(startup.shouldSkipSplash(marked(), fakeStorage({ 'yahu:lastState:v2': '{}' })), true);
  assert.strictEqual(startup.shouldSkipSplash(marked(), fakeStorage({ 'yahu:lastState:v1': '{}' })), true);
});

test('canDismissSplash: тап закрывает, только если есть что показать', () => {
  assert.strictEqual(startup.canDismissSplash({ hasSnapshot: false, hasFresh: false }), false);
  assert.strictEqual(startup.canDismissSplash({ hasSnapshot: true, hasFresh: false }), true);
  assert.strictEqual(startup.canDismissSplash({ hasSnapshot: false, hasFresh: true }), true);
});

test('снимок v2: пишется с временем сохранения и без фото, читается обратно', () => {
  const ls = fakeStorage();
  const state = yesterdaySnapshot();
  state.profile.photoDataUrl = 'data:image/png;base64,AAAA';
  startup.writeSnapshot(ls, state, NOW);
  const raw = JSON.parse(ls.getItem('yahu:lastState:v2'));
  assert.strictEqual(raw.savedAt, '2026-10-03T09:00:00.000Z');
  assert.strictEqual(raw.state.todayCalories, 1200);
  assert.ok(!('photoDataUrl' in raw.state.profile));
  const back = startup.readSnapshot(ls);
  assert.strictEqual(back.savedAt, '2026-10-03T09:00:00.000Z');
  assert.strictEqual(back.state.serverDayKey, '2026-10-02');
});

test('снимок: v1 подхватывается один раз и удаляется', () => {
  const v1 = yesterdaySnapshot();
  const ls = fakeStorage({ 'yahu:lastState:v1': JSON.stringify(v1) });
  const snap = startup.readSnapshot(ls);
  assert.strictEqual(snap.state.todayCalories, 1200);
  assert.strictEqual(snap.savedAt, null);
  assert.strictEqual(ls.getItem('yahu:lastState:v1'), null);
  assert.ok(ls.getItem('yahu:lastState:v2'), 'перенесён в v2');
  assert.strictEqual(startup.readSnapshot(ls).state.todayCalories, 1200);
  // Есть оба — берём v2, v1 удаляем.
  const both = fakeStorage({ 'yahu:lastState:v1': JSON.stringify({ todayCalories: 1 }), 'yahu:lastState:v2': JSON.stringify({ savedAt: 'x', state: { todayCalories: 2 } }) });
  assert.strictEqual(startup.readSnapshot(both).state.todayCalories, 2);
  assert.strictEqual(both.getItem('yahu:lastState:v1'), null);
  // Пусто или мусор — null без исключения.
  assert.strictEqual(startup.readSnapshot(fakeStorage()), null);
  assert.strictEqual(startup.readSnapshot(fakeStorage({ 'yahu:lastState:v2': '{oops' })), null);
});

test('shouldRefreshOnVisible: больше 60 с с прошлой успешной загрузки', () => {
  assert.strictEqual(startup.shouldRefreshOnVisible(100000, 40000), false);
  assert.strictEqual(startup.shouldRefreshOnVisible(100001, 40000), true);
});

test('offlineLabel: время снимка по МСК', () => {
  assert.strictEqual(startup.offlineLabel('2026-10-03T09:05:00.000Z'), 'Нет связи · данные на 12:05');
  assert.strictEqual(startup.offlineLabel('2026-10-02T21:07:00.000Z'), 'Нет связи · данные на 00:07');
  assert.strictEqual(startup.offlineLabel(null), 'Нет связи · данные из прошлого сеанса');
});
