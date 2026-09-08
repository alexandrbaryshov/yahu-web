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
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = process.env.UPSTASH_REDIS_KEY || 'yahu-app-state';

async function redisCommand(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstash ответил ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`Upstash: ${data.error}`);
  return data.result;
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
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.log('UPSTASH_REDIS_REST_URL/REST_TOKEN не заданы — прогресс хранится только в локальном файле data/db.json. На хостинге с "засыпающим" эфемерным диском это будет означать, что прогресс сбрасывается при пробуждении контейнера — см. раздел README про Upstash.');
    return;
  }

  try {
    const raw = await redisCommand(['GET', REDIS_KEY]);
    if (raw) {
      const remoteState = JSON.parse(raw);
      // Заменяем СОДЕРЖИМОЕ существующего объекта состояния, а не саму
      // ссылку — она уже "расшарена" по всем обработчикам запросов сервера.
      Object.keys(store.state).forEach((k) => { delete store.state[k]; });
      Object.assign(store.state, remoteState);
      console.log(`Состояние восстановлено из Upstash Redis (ключ "${REDIS_KEY}") — прогресс не потерян после пробуждения контейнера.`);
    } else {
      console.log(`В Upstash Redis пока нет сохранённого состояния под ключом "${REDIS_KEY}" — начинаем с локального/дефолтного и сохраним его туда при первом же изменении.`);
    }
  } catch (err) {
    console.error('Не удалось загрузить состояние из Upstash Redis, используем локальный файл как есть:', err.message);
  }

  const originalSave = store.save.bind(store);
  store.save = function saveWithRemoteSync() {
    originalSave(); // сначала быстро и синхронно пишем в локальный файл, как раньше
    // Синхронизация в Upstash — в фоне, не блокируя ответ пользователю.
    // Ошибку логируем, но не даём ей уронить запрос (и не даём непойманному
    // отказу промиса завершить процесс).
    redisCommand(['SET', REDIS_KEY, JSON.stringify(store.state)]).catch((err) => {
      console.error('Не удалось сохранить состояние в Upstash Redis:', err.message);
    });
  };
}

module.exports = { syncStoreWithUpstash };
