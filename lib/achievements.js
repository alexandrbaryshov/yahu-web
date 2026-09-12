// Награды: ежедневные задания, еженедельные награды и главная цель.
//
// Хранится только компактный прогресс в state.achievements — не «журнал»
// каждого дня, а:
//   daily / weekly — сколько раз всего было выполнено каждое задание
//                    (коллекция; растёт на 1 при каждом выполнении);
//   creditedDates  — за какую дату уже засчитан мгновенный зачёт воды/веса
//                    (чтобы не начислить дважды за один и тот же день);
//   lastProcessedDate / lastProcessedWeek — до какого дня/недели уже
//                    подведены итоги калорий и еженедельных наград;
//   goalReached — разово наступивший факт достижения желаемого веса
//                (не снимается, если вес потом немного вырастет).
//
// Правило по заданию: «Выпита норма воды» и «Записан вес» засчитываются
// СРАЗУ, как только условие выполнено в течение дня (не нужно ждать
// полуночи) — уже выпитую воду или уже сделанную запись веса задним числом
// отменить нельзя. А вот «Не превышено калорий» можно узнать только
// постфактум, в конце дня: иначе пользователь мог бы, например, один раз
// перебрать по калориям в 23:59 и всё равно получить награду раньше, чем
// это стало окончательно известно.
const { DAILY_TARGETS } = require('./store');
const {
  MS_PER_DAY, startOfDayMoscow, endOfDayMoscow, startOfWeekMoscow, dateKeyMoscow,
} = require('./moscow-time');

// Тонкие обёртки — сохраняют прежние имена, которыми пользуется весь
// остальной файл, но теперь считают по московскому времени (см.
// lib/moscow-time.js), а не по часовому поясу процесса сервера.
function startOfDay(d) { return startOfDayMoscow(d); }
function endOfDay(d) { return endOfDayMoscow(d); }
// Чистая миллисекундная арифметика (не через setDate/getDate — те завязаны
// на локальный часовой пояс процесса и могли бы съехать на переходах
// летнего/зимнего времени В ЭТОМ часовом поясе, даже если у Москвы такого
// перехода нет).
function addDays(d, n) { return new Date(d.getTime() + n * MS_PER_DAY); }
function startOfWeek(d) { return startOfWeekMoscow(d); }
function dateKey(d) {
  return dateKeyMoscow(d); // YYYY-MM-DD по московскому календарю
}
function sumInRange(entries, field, start, end) {
  return entries.filter((e) => { const d = new Date(e.date); return d >= start && d <= end; })
    .reduce((s, e) => s + (e[field] || 0), 0);
}
function hasEntryOnDay(entries, day) {
  const end = endOfDay(day);
  return entries.some((e) => { const d = new Date(e.date); return d >= day && d <= end; });
}

// Самая ранняя дата среди всех записей — не подводим итоги за дни до того,
// как пользователь вообще начал пользоваться приложением.
function earliestActivityDay(state) {
  const dates = [...state.foods, ...state.weights, ...state.water].map((e) => new Date(e.date));
  if (!dates.length) return null;
  return startOfDay(dates.reduce((min, d) => (d < min ? d : min), dates[0]));
}

const EMPTY_ACHIEVEMENTS = {
  daily: { calories: 0, water: 0, weight: 0 },
  weekly: { calories: 0, water: 0 },
  creditedDates: { water: null, weight: null },
  lastProcessedDate: null,
  lastProcessedWeek: null,
  goalReached: false,
};

function ensureAchievementsState(state) {
  if (!state.achievements || typeof state.achievements !== 'object') {
    state.achievements = {
      ...EMPTY_ACHIEVEMENTS,
      daily: { ...EMPTY_ACHIEVEMENTS.daily },
      weekly: { ...EMPTY_ACHIEVEMENTS.weekly },
      creditedDates: { ...EMPTY_ACHIEVEMENTS.creditedDates },
    };
    return;
  }
  const a = state.achievements;
  a.daily = { calories: 0, water: 0, weight: 0, ...a.daily };
  a.weekly = { calories: 0, water: 0, ...a.weekly };
  a.creditedDates = { water: null, weight: null, ...a.creditedDates };
  if (typeof a.lastProcessedDate !== 'string') a.lastProcessedDate = null;
  if (typeof a.lastProcessedWeek !== 'string') a.lastProcessedWeek = null;
  a.goalReached = !!a.goalReached;
}

// «Не превышено калорий» и «Выпита норма воды» требуют, чтобы за день
// реально что-то было записано — иначе пустой (неиспользованный) день
// засчитывался бы как выполненный автоматически.
function isCaloriesDayOk(state, day) {
  const sum = sumInRange(state.foods, 'calories', day, endOfDay(day));
  return sum > 0 && sum <= state.dailyTarget;
}
function isWaterDayOk(state, day) {
  const sum = sumInRange(state.water, 'amount', day, endOfDay(day));
  return sum >= DAILY_TARGETS.water;
}
function isWeightDayOk(state, day) {
  return hasEntryOnDay(state.weights, day);
}

// Итог прошедшего дня: калории подводятся ТОЛЬКО здесь (постфактум, когда
// день гарантированно завершился). Вода и вес к этому моменту почти всегда
// уже зачтены мгновенно (см. creditInstantToday) — здесь лишь подстраховка
// на случай, если сервер был выключен именно в момент выполнения условия;
// creditedDates не даёт засчитать один и тот же день дважды.
function evaluateCompletedDay(state, day) {
  const a = state.achievements;
  const key = dateKey(day);
  if (isCaloriesDayOk(state, day)) a.daily.calories += 1;
  if (a.creditedDates.water !== key && isWaterDayOk(state, day)) {
    a.daily.water += 1;
    a.creditedDates.water = key;
  }
  if (a.creditedDates.weight !== key && isWeightDayOk(state, day)) {
    a.daily.weight += 1;
    a.creditedDates.weight = key;
  }
}

// Мгновенный зачёт «Выпита норма воды» и «Записан вес» — засчитывается
// сразу в момент выполнения условия сегодня, не дожидаясь конца дня.
// creditedDates защищает от повторного начисления при следующих вызовах
// в течение того же дня (например, если пользователь выпьет ещё воды сверх
// нормы или отметит вес повторно).
function creditInstantToday(state) {
  const a = state.achievements;
  const today = startOfDay(new Date());
  const todayKey = dateKey(today);
  if (a.creditedDates.water !== todayKey && isWaterDayOk(state, today)) {
    a.daily.water += 1;
    a.creditedDates.water = todayKey;
  }
  if (a.creditedDates.weight !== todayKey && isWeightDayOk(state, today)) {
    a.daily.weight += 1;
    a.creditedDates.weight = todayKey;
  }
}

function evaluateCompletedWeek(state, weekStart) {
  const a = state.achievements;
  let caloriesAllDays = true;
  let waterAllDays = true;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(weekStart, i);
    if (!isCaloriesDayOk(state, day)) caloriesAllDays = false;
    if (!isWaterDayOk(state, day)) waterAllDays = false;
  }
  if (caloriesAllDays) a.weekly.calories += 1;
  if (waterAllDays) a.weekly.water += 1;
}

function lastWeightOf(state) {
  if (!state.weights.length) return state.startWeight;
  const sorted = [...state.weights].sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted[0].kilograms;
}

// Подводит итоги по всем дням/неделям, полностью завершившимся к текущему
// моменту, но ещё не учтённым — идемпотентно: можно вызывать на каждый
// запрос, лишняя работа не выполняется благодаря lastProcessedDate/Week.
function processAchievements(state) {
  ensureAchievementsState(state);
  const a = state.achievements;
  const today = startOfDay(new Date());
  const earliest = earliestActivityDay(state);

  let dayCursor = a.lastProcessedDate ? addDays(new Date(a.lastProcessedDate), 1) : (earliest || today);
  while (dayCursor < today) {
    evaluateCompletedDay(state, dayCursor);
    a.lastProcessedDate = dateKey(dayCursor);
    dayCursor = addDays(dayCursor, 1);
  }

  const currentWeekStart = startOfWeek(today);
  let weekCursor = a.lastProcessedWeek ? addDays(new Date(a.lastProcessedWeek), 7) : (earliest ? startOfWeek(earliest) : currentWeekStart);
  while (weekCursor < currentWeekStart) {
    evaluateCompletedWeek(state, weekCursor);
    a.lastProcessedWeek = dateKey(weekCursor);
    weekCursor = addDays(weekCursor, 7);
  }

  if (!a.goalReached && lastWeightOf(state) <= state.goalWeight) {
    a.goalReached = true;
  }

  // Мгновенный зачёт воды/веса за сегодня — делаем последним, после
  // подведения итогов прошлых дней (порядок не принципиален, но так нагляднее).
  creditInstantToday(state);
}

// Собирает данные для экрана «Награды»: статус на сегодня/эту неделю +
// накопленную коллекцию по каждому заданию. Для воды и веса «collected» уже
// включает сегодняшний мгновенный зачёт (см. creditInstantToday); для
// калорий и еженедельных наград — только полностью подведённые итоги.
function getAchievementsView(state) {
  const a = state.achievements;
  const today = startOfDay(new Date());
  const todayCalories = sumInRange(state.foods, 'calories', today, endOfDay(today));
  const todayWater = sumInRange(state.water, 'amount', today, endOfDay(today));
  const weightLoggedToday = hasEntryOnDay(state.weights, today);

  const weekStart = startOfWeek(today);
  const daysElapsed = Math.floor((today - weekStart) / MS_PER_DAY) + 1; // включая сегодня
  let caloriesGoodDays = 0;
  let waterGoodDays = 0;
  for (let i = 0; i < daysElapsed; i += 1) {
    const day = addDays(weekStart, i);
    if (isCaloriesDayOk(state, day)) caloriesGoodDays += 1;
    if (isWaterDayOk(state, day)) waterGoodDays += 1;
  }

  return {
    daily: {
      calories: { done: todayCalories > 0 && todayCalories <= state.dailyTarget, collected: a.daily.calories },
      water: { done: todayWater >= DAILY_TARGETS.water, collected: a.daily.water },
      weight: { done: weightLoggedToday, collected: a.daily.weight },
    },
    weekly: {
      calories: { progress: caloriesGoodDays, total: 7, collected: a.weekly.calories },
      water: { progress: waterGoodDays, total: 7, collected: a.weekly.water },
    },
    mainGoal: { done: a.goalReached, goalWeight: state.goalWeight },
  };
}

module.exports = { processAchievements, getAchievementsView, ensureAchievementsState };
