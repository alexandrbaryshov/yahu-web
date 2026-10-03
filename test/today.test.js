// Тесты общего для браузера и сервера расчёта «сегодня» (public/today.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TODAY_FILE = path.join(__dirname, '..', 'public', 'today.js');
const today = require(TODAY_FILE);

// Ожидаемый индекс фразы считаем независимо от кода: номер московских суток
// от эпохи = Date.UTC(московская дата) / сутки.
function expectedPhrase(y, m, d) {
  const days = Date.UTC(y, m - 1, d) / 86400000;
  return today.MOTIVATIONAL_PHRASES[days % today.MOTIVATIONAL_PHRASES.length];
}

test('today.js грузится в Node и в браузерном окружении (window.YahuToday)', () => {
  assert.strictEqual(typeof today.computeToday, 'function');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(TODAY_FILE, 'utf8'), sandbox);
  assert.ok(sandbox.window.YahuToday, 'window.YahuToday не выставлен');
  assert.strictEqual(typeof sandbox.window.YahuToday.getMotivationalPhrase, 'function');
  assert.strictEqual(sandbox.window.YahuToday.MOTIVATIONAL_PHRASES.length, 30);
});

test('фразы — те же 30, что были в lib/motivational.js', () => {
  assert.strictEqual(today.MOTIVATIONAL_PHRASES.length, 30);
  assert.strictEqual(today.MOTIVATIONAL_PHRASES[0], 'Каждый маленький шаг сегодня — это забота о себе завтра.');
  assert.strictEqual(today.MOTIVATIONAL_PHRASES[29], 'Забота о себе сегодня — это подарок себе завтрашнему.');
  const legacy = require('../lib/motivational');
  assert.strictEqual(legacy.MOTIVATIONAL_PHRASES, today.MOTIVATIONAL_PHRASES);
  assert.strictEqual(legacy.getMotivationalPhrase, today.getMotivationalPhrase);
});

test('moscowDayKey — дата по МСК', () => {
  assert.strictEqual(today.moscowDayKey('2026-10-02T20:59:59Z'), '2026-10-02');
  assert.strictEqual(today.moscowDayKey('2026-10-02T21:00:00Z'), '2026-10-03');
  assert.strictEqual(today.moscowDayKey(new Date('2026-12-31T21:00:00Z')), '2027-01-01');
});

test('фраза дня меняется ровно в 00:00 МСК, а не в 03:00', () => {
  // 23:59:59 МСК 2 октября = 20:59:59Z; 00:00:00 МСК 3 октября = 21:00:00Z
  const before = today.getMotivationalPhrase(new Date('2026-10-02T20:59:59Z'));
  const after = today.getMotivationalPhrase(new Date('2026-10-02T21:00:00Z'));
  assert.strictEqual(before, expectedPhrase(2026, 10, 2));
  assert.strictEqual(after, expectedPhrase(2026, 10, 3));
  assert.notStrictEqual(before, after);
  // 02:59 и 03:01 МСК одних суток — одна фраза
  assert.strictEqual(
    today.getMotivationalPhrase(new Date('2026-10-02T23:59:00Z')),
    today.getMotivationalPhrase(new Date('2026-10-03T00:01:00Z')),
  );
});

test('computeToday считает только записи сегодняшних суток МСК и округляет Б/Ж/У', () => {
  const now = new Date('2026-10-03T12:00:00Z'); // 15:00 МСК 3 октября
  const input = {
    foods: [
      { calories: 500, protein: 10.04, fat: 3.33, carbs: 50.06, date: '2026-10-02T21:30:00Z' }, // 00:30 МСК — сегодня
      { calories: 300, protein: 5.03, fat: 1.01, carbs: 20, date: '2026-10-03T11:00:00Z' },     // сегодня
      { calories: 999, protein: 99, fat: 99, carbs: 99, date: '2026-10-02T20:59:00Z' },         // 23:59 МСК вчера
    ],
    water: [
      { amount: 250, date: '2026-10-03T06:00:00Z' },
      { amount: 400, date: '2026-10-02T10:00:00Z' }, // вчера
    ],
    weights: [
      { kilograms: 68.5, date: '2026-10-01T06:00:00Z' },
      { kilograms: 67.9, date: '2026-10-02T06:00:00Z' },
      { kilograms: 69.0, date: '2026-09-30T06:00:00Z' },
    ],
    dailyTarget: 700, waterTarget: 1500, startWeight: 70,
  };
  assert.deepStrictEqual(today.computeToday(input, now), {
    todayCalories: 800, todayProtein: 15.1, todayFat: 4.3, todayCarbs: 70.1,
    todayWater: 250, waterRemaining: 1250, isOverBudget: true, lastWeight: 67.9,
  });
});

test('computeToday: пустые данные — нули, вес из startWeight, вода не уходит в минус', () => {
  const r = today.computeToday({ foods: [], water: [{ amount: 2000, date: '2026-10-03T06:00:00Z' }], weights: [], dailyTarget: 1800, waterTarget: 1500, startWeight: 70 }, new Date('2026-10-03T12:00:00Z'));
  assert.strictEqual(r.todayCalories, 0);
  assert.strictEqual(r.todayProtein, 0);
  assert.strictEqual(r.isOverBudget, false);
  assert.strictEqual(r.lastWeight, 70);
  assert.strictEqual(r.todayWater, 2000);
  assert.strictEqual(r.waterRemaining, 0);
});
