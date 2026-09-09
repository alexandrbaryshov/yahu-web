// Проблема, которую решает этот модуль: на многих бесплатных хостингах
// (Render, Railway, Fly.io, Cyclic и т.п.) контейнер "засыпает" при
// бездействии, а когда снова просыпается — это часто НЕ тот же самый
// контейнер, а свежесозданный из образа, с чистой файловой системой. Любые
// файлы, записанные на диск во время работы (наш data/db.json), при этом
// бесследно исчезают — именно поэтому прогресс сбрасывается "в ноль".
//
// Обычный локальный диск для таких хостингов принципиально не подходит для
// хранения данных, которые должны переживать перезапуск контейнера. Чтобы
// это исправить, не покупая платный тариф, состояние приложения ДОПОЛНИТЕЛЬНО
// синхронизируется с бесплатным внешним хранилищем — Upstash Redis
// (бесплатный тариф: 256 МБ и 500 000 команд в месяц, без банковской карты,
// https://upstash.com). Доступ — обычный HTTPS REST-запрос, поэтому новых
// npm-зависимостей не требуется (используется встроенный в Node.js fetch).
//
// Если переменные окружения не заданы — модуль ничего не делает, и сервер
// работает как раньше, только с локальным файлом (это нормально для
// запуска на своём компьютере/VPS с настоящим постоянным диском).
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const REDIS_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const REDIS_KEY = process.env.UPSTASH_REDIS_KEY || 'yahu-app-state';

// Если сеть/Upstash подвиснет без тайм-аута, сервер может НИКОГДА не дойти
// до server.listen() (мы дожидаемся синхронизации до старта) — на Render и
// подобных хостингах это выглядит как "не запускается"/бесконечные попытки
// перезапуска, а НЕ как ошибка синхронизации. Поэтому у каждого запроса к
// Upstash есть жёсткий тайм-аут: при старте — не более 8 секунд, само
// сохранение при этом никогда не блокирует ответ пользователю (см. ниже).
const STARTUP_TIMEOUT_MS = 8000;
const SAVE_TIMEOUT_MS = 10000;

// Статус синхронизации — используется /api/health и разделом "Инструмент
// разработчика", чтобы можно было СВОИМИ ГЛАЗАМИ увидеть в приложении,
// подключён ли Upstash и работает ли он, а не гадать по логам хостинга
// (на многих бесплатных хостингах логи не всегда легко посмотреть).
const status = {
  configured: !!(REDIS_URL && REDIS_TOKEN),
  configError: null,
  lastLoadOk: null,
  lastLoadError: null,
  lastSaveOk: null,
  lastSaveError: null,
  lastSaveAt: null,
};

if (status.configured && !/^https:\/\//.test(REDIS_URL)) {
  // Частая ошибка настройки: вставили строку подключения для redis-cli
  // (redis://default:...@...:6379) вместо REST-адреса (https://....upstash.io).
  status.configError = `UPSTASH_REDIS_REST_URL должен начинаться с https:// (сейчас: "${REDIS_URL.slice(0, 20)}…"). Похоже, вместо REST-адреса указана строка подключения для redis-cli — на странице базы в Upstash нужен именно раздел "REST API".`;
  status.configured = false;
}

function getStatus() {
  return { ...status };
}

async function redisCommand(command, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upstash ответил ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(`Upstash: ${data.error}`);
    return data.result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Превышено время ожидания ответа от Upstash (${timeoutMs / 1000} сек)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Подключает к уже созданному store синхронизацию с Upstash Redis (если
 * настроена переменными окружения): один раз при старте подтягивает
 * последнее сохранённое состояние (оно "главнее" локального файла — именно
 * оно переживает пересборку контейнера), а затем на каждый store.save()
 * дополнительно отправляет свежее состояние в Upstash в фоне.
 * @param {{state: object, save: Function}} store
 */
async function syncStoreWithUpstash(store) {
  if (status.configError) {
    console.error(`[Upstash] ${status.configError}`);
    return;
  }
  if (!status.configured) {
    console.log('UPSTASH_REDIS_REST_URL/REST_TOKEN не заданы — прогресс хранится только в локальном файле data/db.json. На хостинге с "засыпающим" эфемерным диском это будет означать, что прогресс сбрасывается при пробуждении контейнера — см. раздел README про Upstash.');
    return;
  }

  try {
    const raw = await redisCommand(['GET', REDIS_KEY], STARTUP_TIMEOUT_MS);
    status.lastLoadOk = true;
    status.lastLoadError = null;
    if (raw) {
      const remoteState = JSON.parse(raw);
      // Заменяем СОДЕРЖИМОЕ существующего объекта состояния, а не саму
      // ссылку — она уже "расшарена" по всем обработчикам запросов сервера.
      Object.keys(store.state).forEach((k) => { delete store.state[k]; });
      Object.assign(store.state, remoteState);
      console.log(`[Upstash] Состояние восстановлено (ключ "${REDIS_KEY}") — прогресс не потерян после пробуждения контейнера.`);
    } else {
      console.log(`[Upstash] Под ключом "${REDIS_KEY}" пока ничего не сохранено — начинаем с локального/дефолтного состояния и сохраним его туда при первом же изменении.`);
    }
  } catch (err) {
    status.lastLoadOk = false;
    status.lastLoadError = err.message;
    console.error('[Upstash] Не удалось загрузить состояние, используем локальный файл как есть:', err.message);
  }

  const originalSave = store.save.bind(store);
  store.save = function saveWithRemoteSync() {
    originalSave(); // сначала быстро и синхронно пишем в локальный файл, как раньше
    // Синхронизация в Upstash — в фоне, не блокируя ответ пользователю.
    // Ошибку логируем и запоминаем в status (виден в /api/health и в
    // "Инструменте разработчика"), но не даём ей уронить запрос.
    redisCommand(['SET', REDIS_KEY, JSON.stringify(store.state)], SAVE_TIMEOUT_MS)
      .then(() => {
        status.lastSaveOk = true;
        status.lastSaveError = null;
        status.lastSaveAt = new Date().toISOString();
      })
      .catch((err) => {
        status.lastSaveOk = false;
        status.lastSaveError = err.message;
        status.lastSaveAt = new Date().toISOString();
        console.error('[Upstash] Не удалось сохранить состояние:', err.message);
      });
  };
}

module.exports = { syncStoreWithUpstash, getStatus };
