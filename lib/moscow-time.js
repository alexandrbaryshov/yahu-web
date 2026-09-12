// Все "календарные сутки/неделя" в приложении считаются по МОСКОВСКОМУ
// времени — независимо от того, в каком часовом поясе физически выполняется
// сервер (на бесплатном хостинге это может быть что угодно, и не факт что
// UTC). Раньше день считался по локальному времени процесса Node.js
// (`new Date().getHours()` и т.п.), из-за чего "сегодня" на дашборде могло
// не совпадать с тем, что пользователь считает сегодняшним днём по своим
// часам — например, дашборд не обнулялся вовремя утром по МСК.
//
// Россия отменила переход на летнее время в 2014 году, поэтому у
// Europe/Moscow фиксированное смещение UTC+3 круглый год — это отдельно
// упрощает расчёт (не нужно учитывать переходы туда-обратно).
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Сдвигает момент так, что вызовы getUTC*() на результате возвращают ровно
// те значения, которые в этот момент показывали бы часы в Москве — приём
// работает для любого часового пояса, в котором физически выполняется код.
function shiftToMoscow(date) {
  return new Date(date.getTime() + MOSCOW_OFFSET_MS);
}

function isSameDayMoscow(a, b) {
  const sa = shiftToMoscow(new Date(a));
  const sb = shiftToMoscow(new Date(b));
  return sa.getUTCFullYear() === sb.getUTCFullYear() && sa.getUTCMonth() === sb.getUTCMonth() && sa.getUTCDate() === sb.getUTCDate();
}

// Начало календарных суток по московскому времени, к которым относится
// date — результат это обычный Date (корректный момент в UTC), просто сама
// граница дня вычислена именно по МСК.
function startOfDayMoscow(date) {
  const s = shiftToMoscow(new Date(date));
  const moscowMidnightAsUTC = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return new Date(moscowMidnightAsUTC - MOSCOW_OFFSET_MS);
}

function endOfDayMoscow(date) {
  return new Date(startOfDayMoscow(date).getTime() + MS_PER_DAY - 1);
}

// День недели по московскому времени: Пн=0 ... Вс=6.
function weekdayMoscow(date) {
  return (shiftToMoscow(new Date(date)).getUTCDay() + 6) % 7;
}

function startOfWeekMoscow(date) {
  const start = startOfDayMoscow(date);
  const dow = weekdayMoscow(date);
  return new Date(start.getTime() - dow * MS_PER_DAY);
}

function endOfWeekMoscow(date) {
  return new Date(startOfWeekMoscow(date).getTime() + 7 * MS_PER_DAY - 1);
}

// "YYYY-MM-DD" по московскому календарю — специально НЕ через
// date.toISOString().slice(0,10): та дала бы дату по UTC, а полночь по Москве
// технически ещё "вчера" по UTC (Москва на 3 часа впереди UTC), так что
// простой toISOString() тут дал бы неверный (предыдущий) день.
function dateKeyMoscow(date) {
  const s = shiftToMoscow(new Date(date));
  const y = s.getUTCFullYear();
  const m = String(s.getUTCMonth() + 1).padStart(2, '0');
  const d = String(s.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  MS_PER_DAY,
  isSameDayMoscow,
  startOfDayMoscow,
  endOfDayMoscow,
  weekdayMoscow,
  startOfWeekMoscow,
  endOfWeekMoscow,
  dateKeyMoscow,
};
