// Хранилище состояния приложения (foods/weights/water/profile/reminders) —
// простой JSON-файл на диске, без базы данных.
const fs = require('fs');
const path = require('path');

// Дневные цели. Калории — из исходного MVP (1800 ккал). Цели по Б/Ж/У —
// примерная раскладка ~20/30/50% от калорийности (не медицинская рекомендация,
// просто ориентир для дашборда). Вода — стандартный ориентир 2500 мл/день.
const DAILY_TARGETS = { calories: 1800, protein: 90, fat: 60, carbs: 220, water: 2500 };

const EMPTY_PROFILE = {
  firstName: '', lastName: '', age: null, gender: '', birthYear: null, targetWeight: null, photoDataUrl: null,
};

const DEFAULT_REMINDERS = {
  water: { enabled: false, intervalMinutes: 120 },
  stretch: { enabled: false, intervalMinutes: 60 },
};
const REMINDER_MIN_INTERVAL = 5;
const REMINDER_MAX_INTERVAL = 240;

function normalizeReminder(input, fallback) {
  const enabled = !!(input && input.enabled);
  let intervalMinutes = Number(input && input.intervalMinutes);
  if (!Number.isFinite(intervalMinutes)) intervalMinutes = fallback.intervalMinutes;
  intervalMinutes = Math.round(intervalMinutes / 5) * 5; // всегда кратно 5 минутам
  intervalMinutes = Math.max(REMINDER_MIN_INTERVAL, Math.min(REMINDER_MAX_INTERVAL, intervalMinutes));
  return { enabled, intervalMinutes };
}

function isSameDay(iso1, iso2) {
  const d1 = new Date(iso1), d2 = new Date(iso2);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function sumToday(entries, field) {
  const today = new Date().toISOString();
  return entries.filter((e) => isSameDay(e.date, today)).reduce((s, e) => s + (e[field] || 0), 0);
}

function defaultState() {
  return {
    foods: [], weights: [], water: [], dailyTarget: DAILY_TARGETS.calories, goalWeight: 54, startWeight: 70,
    profile: { ...EMPTY_PROFILE },
    reminders: { water: { ...DEFAULT_REMINDERS.water }, stretch: { ...DEFAULT_REMINDERS.stretch } },
    achievements: { daily: { calories: 0, water: 0, weight: 0 }, weekly: { calories: 0, water: 0 }, lastProcessedDate: null, lastProcessedWeek: null, goalReached: false },
  };
}

/**
 * Создаёт хранилище, привязанное к конкретному JSON-файлу на диске.
 * @param {string} dataFile
 */
function createStore(dataFile) {
  function load() {
    try {
      const raw = fs.readFileSync(dataFile, 'utf8');
      const parsed = JSON.parse(raw);
      // Совместимость со старыми db.json, где новых полей ещё не было:
      if (!Array.isArray(parsed.water)) parsed.water = [];
      if (!parsed.profile || typeof parsed.profile !== 'object') parsed.profile = { ...EMPTY_PROFILE };
      if (!parsed.reminders || typeof parsed.reminders !== 'object') {
        parsed.reminders = { water: { ...DEFAULT_REMINDERS.water }, stretch: { ...DEFAULT_REMINDERS.stretch } };
      }
      return parsed;
    } catch {
      return defaultState();
    }
  }

  let state = load();

  function save() {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
  }

  return {
    get state() { return state; },
    save,
  };
}

module.exports = {
  createStore,
  normalizeReminder,
  isSameDay,
  sumToday,
  DAILY_TARGETS,
  EMPTY_PROFILE,
  DEFAULT_REMINDERS,
  REMINDER_MIN_INTERVAL,
  REMINDER_MAX_INTERVAL,
};
