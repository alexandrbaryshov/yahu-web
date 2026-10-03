// Тесты HTTP-сервера: поднимается в тесте на свободном порту, с временным
// DATA_FILE и без Upstash (загрузка состояния подменяется функцией loadRemote).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { createApp } = require('../server');
const { sumTodayMulti, sumToday } = require('../lib/store');

// Крошечный PNG 1×1 — настоящая картинка, чтобы проверить отдачу байтов.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yahu-test-'));
}

function seedState(overrides = {}) {
  const nowIso = new Date().toISOString();
  return {
    foods: [
      { id: 'f1', name: 'Каша', calories: 350, protein: 12.34, fat: 5.55, carbs: 60.07, grams: 200, date: nowIso },
      { id: 'f2', name: 'Суп', calories: 200, protein: 8.01, fat: 4.04, carbs: 20.02, grams: 300, date: nowIso },
      { id: 'f0', name: 'Старое', calories: 900, protein: 50, fat: 50, carbs: 50, grams: 300, date: '2020-01-01T10:00:00Z' },
    ],
    weights: [{ id: 'w1', kilograms: 66.6, date: '2020-01-01T10:00:00Z' }],
    water: [{ id: 'a1', amount: 300, date: nowIso, source: 'quick' }],
    dailyTarget: 1800, goalWeight: 54, startWeight: 70,
    profile: { firstName: 'Тест', lastName: '', age: null, gender: '', birthYear: null, targetWeight: null, photoDataUrl: null },
    reminders: { water: { enabled: false, intervalMinutes: 120 }, stretch: { enabled: false, intervalMinutes: 60 } },
    achievements: { daily: { calories: 0, water: 0, weight: 0 }, weekly: { calories: 0, water: 0 }, lastProcessedDate: null, lastProcessedWeek: null, goalReached: false },
    devLog: [],
    ...overrides,
  };
}

async function startApp(t, { state, loadRemote } = {}) {
  const dir = tmpDir();
  const dataFile = path.join(dir, 'db.json');
  if (state) fs.writeFileSync(dataFile, JSON.stringify(state));
  const app = createApp({
    dataFile,
    dishesFile: path.join(dir, 'dishes.xlsx'),
    defaultDishesFile: path.join(dir, 'нет-такого.xlsx'),
    versionFile: path.join(dir, 'dishes.default_hash'),
    loadRemote: loadRemote || (async () => {}),
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => new Promise((resolve) => { app.server.closeAllConnections?.(); app.server.close(resolve); }));
  return { app, base, dataFile };
}

async function getJSON(url, init) {
  const res = await fetch(url, init);
  return { res, body: await res.json() };
}

test('/api/state: без photoDataUrl, с photoVersion и serverDayKey', async (t) => {
  const { base } = await startApp(t, { state: seedState({ profile: { ...seedState().profile, photoDataUrl: PNG_DATA_URL } }) });
  const { res, body } = await getJSON(`${base}/api/state`);
  assert.strictEqual(res.status, 200);
  assert.ok(!('photoDataUrl' in body.profile), 'photoDataUrl не должен уходить клиенту');
  const expectedVersion = crypto.createHash('sha1').update(PNG_DATA_URL).digest('hex').slice(0, 12);
  assert.strictEqual(body.profile.photoVersion, expectedVersion);
  assert.strictEqual(body.profile.firstName, 'Тест');
  // Сегодняшний ключ МСК считаем независимо: сдвиг на +3 ч и дата по UTC.
  assert.strictEqual(body.serverDayKey, new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10));
});

test('/api/state: поля «сегодня» совпадают с прежней серверной формулой', async (t) => {
  const state = seedState();
  const { base } = await startApp(t, { state });
  const { body } = await getJSON(`${base}/api/state`);
  const old = sumTodayMulti(state.foods, ['calories', 'protein', 'fat', 'carbs']);
  const oldWater = sumToday(state.water, 'amount');
  assert.strictEqual(body.todayCalories, old.calories);
  assert.strictEqual(body.todayProtein, Math.round(old.protein * 10) / 10);
  assert.strictEqual(body.todayFat, Math.round(old.fat * 10) / 10);
  assert.strictEqual(body.todayCarbs, Math.round(old.carbs * 10) / 10);
  assert.strictEqual(body.todayWater, oldWater);
  assert.strictEqual(body.waterRemaining, 1500 - oldWater);
  assert.strictEqual(body.isOverBudget, false);
  assert.strictEqual(body.lastWeight, 66.6);
  // и с ручным расчётом: 350+200 ккал, белок 12.34+8.01=20.35→20.4 (до 0,1)
  assert.strictEqual(body.todayCalories, 550);
  assert.strictEqual(body.todayWater, 300);
  assert.strictEqual(typeof body.motivationalPhrase, 'string');
});

test('мутации: фото не уходит в ответе, photoVersion меняется; db.json хранит фото', async (t) => {
  const { base, dataFile } = await startApp(t, { state: seedState() });
  const first = await getJSON(`${base}/api/state`);
  assert.strictEqual(first.body.profile.photoVersion, null);

  const up = await getJSON(`${base}/api/profile/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: PNG_DATA_URL }) });
  assert.strictEqual(up.res.status, 200);
  assert.ok(!JSON.stringify(up.body).includes('base64'), 'в ответе мутации нет data URL');
  const v1 = up.body.profile.photoVersion;
  assert.match(v1, /^[0-9a-f]{12}$/);
  assert.strictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).profile.photoDataUrl, PNG_DATA_URL);

  const up2 = await getJSON(`${base}/api/profile/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: JPEG_DATA_URL }) });
  assert.notStrictEqual(up2.body.profile.photoVersion, v1);

  const water = await getJSON(`${base}/api/water`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 250 }) });
  assert.ok(!('photoDataUrl' in water.body.profile));
  assert.strictEqual(water.body.profile.photoVersion, up2.body.profile.photoVersion);

  const del = await getJSON(`${base}/api/profile/photo`, { method: 'DELETE' });
  assert.strictEqual(del.body.profile.photoVersion, null);
  assert.strictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).profile.photoDataUrl, null);
});

test('GET /api/profile/photo: бинарная картинка с годовым кэшем; без фото — 404', async (t) => {
  const { base } = await startApp(t, { state: seedState() });
  const none = await fetch(`${base}/api/profile/photo?v=x`);
  assert.strictEqual(none.status, 404);
  assert.ok((await none.json()).error);

  await fetch(`${base}/api/profile/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: PNG_DATA_URL }) });
  const res = await fetch(`${base}/api/profile/photo?v=abc`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(res.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepStrictEqual(bytes, Buffer.from(PNG_BASE64, 'base64'));
});

test('медленная загрузка из Upstash: статика и /api/health сразу, /api/state ждёт восстановления', async (t) => {
  let finishLoad;
  const gate = new Promise((resolve) => { finishLoad = resolve; });
  // Подменённая «загрузка из Upstash»: ждёт сигнала теста, затем заменяет
  // содержимое state восстановленным (как делает lib/remote-sync.js).
  const loadRemote = async (store) => {
    await gate;
    const restored = seedState({ foods: [{ id: 'r1', name: 'Из Upstash', calories: 777, protein: 1, fat: 1, carbs: 1, grams: 100, date: new Date().toISOString() }] });
    Object.keys(store.state).forEach((k) => { delete store.state[k]; });
    Object.assign(store.state, restored);
  };
  const { base } = await startApp(t, { loadRemote }); // локального db.json нет — пустое состояние

  const health = await getJSON(`${base}/api/health`);
  assert.strictEqual(health.res.status, 200);
  assert.strictEqual(health.body.ready, false);

  const page = await fetch(`${base}/`);
  assert.strictEqual(page.status, 200);
  await page.text();

  let stateSettled = false;
  const statePromise = getJSON(`${base}/api/state`).then((r) => { stateSettled = true; return r; });
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(stateSettled, false, '/api/state не должен отвечать до восстановления');

  finishLoad();
  const { body } = await statePromise;
  assert.strictEqual(body.todayCalories, 777);
  assert.strictEqual(body.foods[0].name, 'Из Upstash');

  const health2 = await getJSON(`${base}/api/health`);
  assert.strictEqual(health2.body.ready, true);
});

test('упавшая загрузка из Upstash не вешает /api/*', async (t) => {
  const { base } = await startApp(t, { state: seedState(), loadRemote: async () => { throw new Error('сбой'); } });
  const { res, body } = await getJSON(`${base}/api/state`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.todayCalories, 550);
});
