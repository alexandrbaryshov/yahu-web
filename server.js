// ЯХУ — веб-сервер (без внешних npm-зависимостей и без обращений в интернет:
// только встроенные модули Node.js + собственная база блюд dishes.xlsx).
//
// Файл — тонкий HTTP-роутер; вся логика вынесена в модули:
//   lib/http-utils.js  — JSON-ответы, чтение тела запроса, отдача статики
//   public/today.js     — фраза дня и суммы «сегодня» (общий с браузером файл)
//   lib/dishes.js       — база блюд: загрузка/поиск/точное совпадение по имени
//   lib/store.js        — состояние приложения (JSON-файл) + дефолты/валидация
//   lib/remote-sync.js  — опциональная синхронизация состояния с Upstash Redis
//                         (нужна на "засыпающем" бесплатном хостинге, где
//                         локальный диск не переживает пробуждение контейнера)
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const { sendJSON, readBody, serveStatic } = require('./lib/http-utils');
const { getMotivationalPhrase, computeToday, moscowDayKey } = require('./public/today');
const { createDishesRepository } = require('./lib/dishes');
const { createStore, normalizeReminder, isSameDay, DAILY_TARGETS, DEV_LOG_LIMIT } = require('./lib/store');
const { processAchievements, getAchievementsView } = require('./lib/achievements');
const { buildMacroTip } = require('./lib/macro-tip');
const { syncStoreWithUpstash, getStatus: getUpstashStatus } = require('./lib/remote-sync');

// Пароль от раздела "Инструмент разработчика" (журнал действий пользователя).
// Хранится только на сервере — в отличие от проверки на клиенте, его нельзя
// подсмотреть, просто прочитав исходный код страницы в браузере.
const DEV_TOOL_PASSWORD = process.env.DEV_TOOL_PASSWORD || 'B201190aU';

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const DISHES_FILE = process.env.DISHES_FILE || path.join(__dirname, 'data', 'dishes.xlsx');
const DEFAULT_DISHES_FILE = process.env.DEFAULT_DISHES_FILE || path.join(__dirname, 'default-dishes.xlsx');
// Хранит хэш той версии эталонной базы, которая последний раз была скопирована в volume.
const DISHES_VERSION_FILE = process.env.DISHES_VERSION_FILE || path.join(__dirname, 'data', 'dishes.default_hash');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Версия фото — короткий хэш самого data URL: меняется при каждой замене
// фото, поэтому клиент может кэшировать /api/profile/photo?v=<версия> навсегда.
// Хэш от ~7 МБ строки считать на каждый ответ незачем — запоминаем последний.
let lastPhoto = { dataUrl: null, version: null };
function photoVersionOf(dataUrl) {
  if (!dataUrl) return null;
  if (lastPhoto.dataUrl !== dataUrl) {
    lastPhoto = { dataUrl, version: crypto.createHash('sha1').update(dataUrl).digest('hex').slice(0, 12) };
  }
  return lastPhoto.version;
}

/**
 * Собирает приложение: хранилище, базу блюд и HTTP-сервер (ещё не слушающий
 * порт). Вынесено в функцию, чтобы тесты могли поднять сервер с временным
 * DATA_FILE и подменённой загрузкой из Upstash (loadRemote).
 * @param {{dataFile:string, dishesFile:string, defaultDishesFile:string, versionFile:string,
 *          publicDir?:string, loadRemote?:(store:object)=>Promise<void>}} config
 * @returns {{server: import('http').Server, store: object, ready: Promise<void>}}
 */
function createApp({ dataFile, dishesFile, defaultDishesFile, versionFile, publicDir = PUBLIC_DIR, loadRemote = syncStoreWithUpstash }) {
  const dishes = createDishesRepository({ dishesFile, defaultDishesFile, versionFile });
  const store = createStore(dataFile);

  // Восстановление состояния из Upstash идёт ПАРАЛЛЕЛЬНО со стартом сервера:
  // раньше server.listen ждал его (до 8 с) и на холодном старте не отдавалась
  // даже страница. Теперь статика и /api/health отвечают сразу, а остальные
  // /api/* сначала ждут ready — так ни один ответ не отдаёт (и ни одна
  // мутация не меняет) состояние, которое через мгновение перезапишется
  // восстановленным. Ошибка загрузки не должна вешать запросы навсегда —
  // тогда работаем с локальным файлом, как и раньше.
  let isReady = false;
  const ready = Promise.resolve()
    .then(() => loadRemote(store))
    .catch((err) => { console.error('Не удалось восстановить состояние при старте:', err && err.message); })
    .then(() => { isReady = true; });

  // Полные списки еды/веса/воды отдаются клиенту целиком (это простое личное
  // приложение, объём данных небольшой) — это позволяет считать графики
  // «за неделю» и «за месяц» на клиенте без отдельных серверных эндпоинтов.
  function computeDerived() {
    const state = store.state;

    // Подводим итоги по завершённым дням/неделям (ежедневные задания,
    // еженедельные награды, главная цель) перед каждым ответом клиенту.
    // Идемпотентно — лишний вызов ничего не пересчитает повторно. Сохраняем
    // на диск/в Upstash ТОЛЬКО если что-то реально изменилось — иначе обычный
    // GET (например, при каждой загрузке страницы) впустую писал бы на диск
    // и слал сетевой запрос в Upstash, хотя данные не поменялись.
    if (processAchievements(state)) store.save();

    // «Сегодня» считается общей с браузером функцией (public/today.js) — чтобы
    // цифры, пересчитанные в браузере из снимка, и серверные не расходились.
    const now = new Date();
    const today = computeToday({
      foods: state.foods,
      water: state.water,
      weights: state.weights,
      dailyTarget: state.dailyTarget,
      waterTarget: DAILY_TARGETS.water,
      startWeight: state.startWeight,
    }, now);

    // Фото (до ~7 МБ текста) клиенту в каждом ответе не отдаём — только его
    // версию; сама картинка грузится один раз по GET /api/profile/photo?v=…
    // и кэшируется браузером. В state/db.json/Upstash фото хранится как было.
    const { photoDataUrl, ...profileWithoutPhoto } = state.profile || {};

    return {
      foods: [...state.foods].sort((a, b) => new Date(b.date) - new Date(a.date)),
      weights: [...state.weights].sort((a, b) => new Date(a.date) - new Date(b.date)),
      water: [...state.water].sort((a, b) => new Date(a.date) - new Date(b.date)),
      dailyTarget: state.dailyTarget,
      proteinTarget: DAILY_TARGETS.protein,
      fatTarget: DAILY_TARGETS.fat,
      carbsTarget: DAILY_TARGETS.carbs,
      goalWeight: state.goalWeight,
      startWeight: state.startWeight,
      todayCalories: today.todayCalories,
      todayProtein: today.todayProtein,
      todayFat: today.todayFat,
      todayCarbs: today.todayCarbs,
      todayWater: today.todayWater,
      waterTarget: DAILY_TARGETS.water,
      waterRemaining: today.waterRemaining,
      isOverBudget: today.isOverBudget,
      lastWeight: today.lastWeight,
      motivationalPhrase: getMotivationalPhrase(now),
      serverDayKey: moscowDayKey(now),
      profile: { ...profileWithoutPhoto, photoVersion: photoVersionOf(photoDataUrl) },
      reminders: state.reminders,
      achievements: getAchievementsView(state),
      macroTip: buildMacroTip(
        { protein: today.todayProtein, fat: today.todayFat, carbs: today.todayCarbs },
        { protein: DAILY_TARGETS.protein, fat: DAILY_TARGETS.fat, carbs: DAILY_TARGETS.carbs },
        dishes,
      ),
    };
  }

  // Общая валидация тела запроса для добавления/редактирования еды — раньше
  // была продублирована в POST и PUT целиком.
  function parseFoodInput(body) {
    const name = String(body.name || '').trim();
    const calories = Math.round(Number(body.calories) || 0);
    const protein = Math.max(0, Number(body.protein) || 0);
    const fat = Math.max(0, Number(body.fat) || 0);
    const carbs = Math.max(0, Number(body.carbs) || 0);
    const grams = Math.max(0, Number(body.grams) || 0);
    if (!name || !Number.isFinite(calories) || calories < 0) {
      return { error: 'Нужно указать название и калории' };
    }
    return { name, calories, protein, fat, carbs, grams };
  }

  // Синхронизирует запись в state.water, привязанную к конкретной еде
  // (foodId): убирает старую (если была) и создаёт новую, если блюдо по базе
  // отмечено как вода. Общая логика для добавления, редактирования и удаления
  // еды — раньше была продублирована в каждом из этих трёх мест.
  function syncFoodWater(state, foodId, name, grams, date) {
    state.water = state.water.filter((w) => w.foodId !== foodId);
    const dishInDb = dishes.findByName(name);
    if (dishInDb && dishInDb.isWater && grams > 0) {
      state.water.push({ id: crypto.randomUUID(), amount: Math.round(grams), date, source: 'food', foodId });
    }
  }

  // ---------- Роутер ----------
  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = parsed;
    let state = store.state;

    try {
      // ---- API: статус хранилища (диагностика "засыпающего" хостинга) ----
      // Открыть прямо в браузере — /api/health — чтобы своими глазами
      // увидеть, подключён ли Upstash и когда последний раз успешно
      // синхронизировался, не копаясь в логах хостинга. Отвечает сразу, не
      // дожидаясь восстановления из Upstash: его пингует keep-alive, а поле
      // ready показывает, восстановлено ли уже состояние.
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJSON(req, res, 200, {
          ok: true,
          ready: isReady,
          localRecordsCount: state.foods.length + state.weights.length + state.water.length,
          upstash: getUpstashStatus(),
        });
      }

      // Все остальные /api/* — только после восстановления состояния (см. ready).
      if (pathname.startsWith('/api/')) {
        await ready;
        state = store.state;
      }

      // ---- API: состояние приложения ----
      if (pathname === '/api/state' && req.method === 'GET') {
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: автодополнение по собственной базе блюд (dishes.xlsx) ----
      if (pathname === '/api/dishes/search' && req.method === 'GET') {
        const query = parsed.searchParams.get('query') || '';
        return sendJSON(req, res, 200, { dishes: dishes.search(query) });
      }

      // ---- API: добавить еду ----
      if (pathname === '/api/foods' && req.method === 'POST') {
        const body = await readBody(req);
        const parsed = parseFoodInput(body);
        if (parsed.error) return sendJSON(req, res, 400, { error: parsed.error });
        const { name, calories, protein, fat, carbs, grams } = parsed;

        const now = new Date().toISOString();
        const foodId = crypto.randomUUID();
        state.foods.push({ id: foodId, name, calories, protein, fat, carbs, grams, date: now });

        // Если блюдо помечено в базе как "вода" (сама вода, чай/кофе без сахара и т.п.) —
        // засчитываем выпитый объём (грамм ≈ мл) и в счётчик воды тоже. foodId
        // связывает эту запись воды с едой, чтобы её можно было корректно
        // удалить/пересчитать при последующем редактировании или удалении еды.
        syncFoodWater(state, foodId, name, grams, now);

        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: отредактировать существующую запись еды ----
      // Пересоздаёт калории/БЖУ по новому названию и/или весу порции, не трогая
      // время исходной записи — это именно правка ошибки, а не новая еда.
      // Заодно пересобирает связанную запись воды (если блюдо помечено как вода),
      // чтобы общая сумма воды за день тоже осталась верной.
      if (pathname.startsWith('/api/foods/') && req.method === 'PUT') {
        const id = pathname.split('/').pop();
        const existing = state.foods.find((f) => f.id === id);
        if (!existing) {
          return sendJSON(req, res, 404, { error: 'Запись не найдена' });
        }
        const body = await readBody(req);
        const parsed = parseFoodInput(body);
        if (parsed.error) return sendJSON(req, res, 400, { error: parsed.error });
        Object.assign(existing, parsed); // date и id не трогаем — это правка, а не новая запись

        syncFoodWater(state, id, existing.name, existing.grams, existing.date);

        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: удалить еду ----
      if (pathname.startsWith('/api/foods/') && req.method === 'DELETE') {
        const id = pathname.split('/').pop();
        state.foods = state.foods.filter((f) => f.id !== id);
        // Убираем и связанную запись воды, если это блюдо было отмечено как вода —
        // иначе после удаления еды выпитая вода "оставалась бы" в сумме за день.
        state.water = state.water.filter((w) => w.foodId !== id);
        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: записать вес (одна запись в день, перезаписывает сегодняшнюю) ----
      if (pathname === '/api/weights' && req.method === 'POST') {
        const body = await readBody(req);
        const kilograms = Number(body.kilograms);
        if (!Number.isFinite(kilograms) || kilograms <= 0) {
          return sendJSON(req, res, 400, { error: 'Некорректный вес' });
        }
        const today = new Date().toISOString();
        state.weights = state.weights.filter((w) => !isSameDay(w.date, today));
        state.weights.push({ id: crypto.randomUUID(), kilograms, date: today });
        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: добавить воду напрямую (кнопка «Стакан воды», по умолчанию 250 мл) ----
      if (pathname === '/api/water' && req.method === 'POST') {
        const body = await readBody(req);
        const amount = Math.round(Number(body.amount) || 250);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 2000) {
          return sendJSON(req, res, 400, { error: 'Некорректный объём воды' });
        }
        state.water.push({ id: crypto.randomUUID(), amount, date: new Date().toISOString(), source: 'quick' });
        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: отменить последнюю сегодняшнюю запись воды (на случай случайного нажатия) ----
      if (pathname === '/api/water/last' && req.method === 'DELETE') {
        const today = new Date().toISOString();
        const todayEntries = state.water.filter((w) => isSameDay(w.date, today));
        if (todayEntries.length) {
          const last = todayEntries[todayEntries.length - 1];
          state.water = state.water.filter((w) => w.id !== last.id);
        }
        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: сохранить текстовые поля профиля ----
      if (pathname === '/api/profile' && req.method === 'POST') {
        const body = await readBody(req);
        const firstName = String(body.firstName || '').trim().slice(0, 100);
        const lastName = String(body.lastName || '').trim().slice(0, 100);
        const gender = ['муж', 'жен', ''].includes(body.gender) ? body.gender : '';
        const age = body.age !== '' && body.age != null ? Math.max(0, Math.min(150, Math.round(Number(body.age)))) : null;
        const birthYear = body.birthYear !== '' && body.birthYear != null
          ? Math.max(1900, Math.min(new Date().getFullYear(), Math.round(Number(body.birthYear)))) : null;
        const targetWeight = body.targetWeight !== '' && body.targetWeight != null
          ? Math.max(20, Math.min(400, Number(body.targetWeight))) : null;

        state.profile = { ...state.profile, firstName, lastName, gender, age, birthYear, targetWeight };
        // Желаемый конечный вес из профиля — это и есть цель, которая используется
        // в карточке «Цель на год» на главном экране и в главной цели «Пушинка!»
        // в разделе «Награды».
        if (targetWeight != null) state.goalWeight = targetWeight;

        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: само фото профиля бинарником (клиент ходит с ?v=<photoVersion>) ----
      // Версия в URL меняется вместе с фото, поэтому кэш — на год и immutable:
      // браузер скачивает каждую версию фото ровно один раз.
      if (pathname === '/api/profile/photo' && req.method === 'GET') {
        const dataUrl = state.profile && state.profile.photoDataUrl;
        const match = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
        if (!match) return sendJSON(req, res, 404, { error: 'Фото не загружено' });
        const bytes = Buffer.from(match[2], 'base64');
        res.writeHead(200, {
          'Content-Type': match[1],
          'Content-Length': bytes.length,
          'Cache-Control': 'private, max-age=31536000, immutable',
        });
        return res.end(bytes);
      }

      // ---- API: загрузить/заменить фото профиля (jpeg/png, ≤5 МБ, приходит как data URL) ----
      if (pathname === '/api/profile/photo' && req.method === 'POST') {
        const body = await readBody(req);
        const dataUrl = String(body.dataUrl || '');
        const match = dataUrl.match(/^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) {
          return sendJSON(req, res, 400, { error: 'Допустимы только файлы JPEG или PNG' });
        }
        const base64 = match[2];
        const approxBytes = Math.floor(base64.length * 3 / 4);
        if (approxBytes > 5 * 1024 * 1024) {
          return sendJSON(req, res, 400, { error: 'Файл больше 5 МБ' });
        }
        state.profile = { ...state.profile, photoDataUrl: dataUrl };
        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: удалить фото профиля ----
      if (pathname === '/api/profile/photo' && req.method === 'DELETE') {
        state.profile = { ...state.profile, photoDataUrl: null };
        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- API: сохранить настройки напоминаний (вода / разминка, независимо друг от друга) ----
      if (pathname === '/api/reminders' && req.method === 'POST') {
        const body = await readBody(req);
        state.reminders = {
          water: normalizeReminder(body.water, state.reminders.water),
          stretch: normalizeReminder(body.stretch, state.reminders.stretch),
        };
        store.save();
        return sendJSON(req, res, 200, computeDerived());
      }

      // ---- Инструмент разработчика: журнал действий пользователя ----
      // Запись в журнал (POST) не требует пароля — логируется прозрачно, что бы
      // ни делал пользователь. Пароль нужен только для входа в САМ раздел на
      // клиенте (см. openDevToolsAuth() в app.js); проверяется здесь, на
      // сервере, чтобы правильный пароль нельзя было подсмотреть, просто
      // открыв исходный код страницы в браузере.
      if (pathname === '/api/devtools/auth' && req.method === 'POST') {
        const body = await readBody(req);
        const ok = String(body.password || '') === DEV_TOOL_PASSWORD;
        state.devLog.push({ id: crypto.randomUUID(), ts: new Date().toISOString(), action: ok ? 'Вход в инструмент разработчика' : 'Неудачная попытка входа в инструмент разработчика', details: '' });
        if (state.devLog.length > DEV_LOG_LIMIT) state.devLog = state.devLog.slice(-DEV_LOG_LIMIT);
        store.save();
        return sendJSON(req, res, ok ? 200 : 401, { ok });
      }

      if (pathname === '/api/devlog' && req.method === 'GET') {
        return sendJSON(req, res, 200, { entries: [...state.devLog].reverse() }); // новые сверху
      }

      if (pathname === '/api/devlog' && req.method === 'POST') {
        const body = await readBody(req);
        const action = String(body.action || '').trim().slice(0, 200);
        if (!action) return sendJSON(req, res, 400, { error: 'Не указано действие' });
        const details = String(body.details || '').trim().slice(0, 500);
        state.devLog.push({ id: crypto.randomUUID(), ts: new Date().toISOString(), action, details });
        if (state.devLog.length > DEV_LOG_LIMIT) state.devLog = state.devLog.slice(-DEV_LOG_LIMIT);
        store.save();
        return sendJSON(req, res, 200, { ok: true });
      }

      if (pathname === '/api/devlog' && req.method === 'DELETE') {
        state.devLog = [];
        store.save();
        return sendJSON(req, res, 200, { ok: true });
      }

      // ---- Статика ----
      if (req.method === 'GET') return serveStatic(publicDir, req, res, pathname);

      res.writeHead(405); return res.end('Method not allowed');
    } catch (err) {
      console.error(err);
      return sendJSON(req, res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  });

  return { server, store, ready };
}

// Порт слушаем сразу; восстановление из Upstash идёт параллельно (см. ready
// в createApp). При require() из тестов сервер сам не стартует.
if (require.main === module) {
  const { server } = createApp({
    dataFile: DATA_FILE,
    dishesFile: DISHES_FILE,
    defaultDishesFile: DEFAULT_DISHES_FILE,
    versionFile: DISHES_VERSION_FILE,
  });
  server.listen(PORT, () => {
    console.log(`ЯХУ запущен: http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
