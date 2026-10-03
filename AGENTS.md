<!-- autopilot:start -->
# yahu-web — трекер питания (PWA), чистый Node.js без npm, прод на Render

## Команды

```
node --test
node --test test/server.test.js
$env:PORT='3917'; $env:DEFAULT_DISHES_FILE='seed/dishes.xlsx'; node server.js
```

- `node --test` — все 31 тест из корня (на Node 22+ `node --test test/` падает: «Cannot find module»).
- package.json нет, `npm install` не нужен; локально Node 24, в Docker (`Dockerfile`) Node 20.
- Без `UPSTASH_*` данные пишутся в `data/db.json`.

## Где что

- `server.js` — HTTP-сервер и API; `createApp({...})` возвращает `{ server, store, ready }`, при `require` порт не слушает.
- `lib/` — серверная логика: `store.js`, `remote-sync.js` (Upstash), `dishes.js` + `xlsxReader.js` (база блюд), `achievements.js`, `macro-tip.js`.
- `public/app.js` — весь клиент (дневник, профиль, оптимистичные обновления); `public/index.html` — разметка и заставка `#splash`.
- `public/today.js` и `public/startup.js` — общие для браузера и Node (`window.YahuToday` / `module.exports`), тесты — `test/today.test.js`, `test/startup.test.js`.
- `public/sw.js` — service worker, список оболочки `SHELL_FILES`.
- `seed/dishes.xlsx` — эталон базы блюд; `data/` — рантайм-данные, в git не попадают.
- `docs/keep-alive.md`, `.github/workflows/keep-alive.yml` — внешний пингер против засыпания хостинга.

## Подводные камни

- Менял файл из `SHELL_FILES` или добавил новый — подними `CACHE_NAME` в `public/sw.js` (сейчас `yahu-shell-v4`) и допиши файл в список.
- День везде по МСК (UTC+3 фиксированно): `moscowDayKey` из `public/today.js`, не `new Date()` с локальной зоной.
- Фото профиля не входит в `/api/state`: клиент берёт `GET /api/profile/photo?v=<profile.photoVersion>`; в `db.json` и Upstash `photoDataUrl` хранится как раньше.
- `/api/*` кроме `/api/health` ждут `ready` (загрузка из Upstash идёт после `listen`); статика и health отвечают сразу.
- Локально `DEFAULT_DISHES_FILE` по умолчанию указывает на несуществующий `./default-dishes.xlsx` (он есть только в Docker), поэтому `data/dishes.xlsx` не сеется и старт пишет «Не удалось загрузить базу блюд (dishes.xlsx): ENOENT» — база блюд пуста. Лечится переменной `DEFAULT_DISHES_FILE=seed/dishes.xlsx` (она в команде запуска выше).
- Формат `db.json` и данных в Upstash менять нельзя; комментарии в коде пишутся по-русски.

## Окружение

- `PORT` — порт сервера (по умолчанию 3000).
- `DATA_FILE` — путь к `db.json`.
- `DISHES_FILE`, `DEFAULT_DISHES_FILE`, `DISHES_VERSION_FILE` — рабочая база блюд, эталон для пересева и файл с его хэшем.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — постоянное хранилище на хостинге с эфемерным диском; без них — только локальный файл.
- `UPSTASH_REDIS_KEY` — ключ состояния в Upstash, если один аккаунт на несколько сред.
- `DEV_TOOL_PASSWORD` — пароль инструмента разработчика в профиле; у него есть дефолт в `server.js`. Шаблон — `.env.example`.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять
только пользователь. Прерванную сборку продолжает «продолжи автопилот».
<!-- autopilot:end -->
