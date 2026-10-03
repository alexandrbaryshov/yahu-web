# Интерфейсы и правила проекта

Читать первым. Подробности о существующем коде — `notes.md`.

## Правила проекта
- Никаких npm-зависимостей, никакого package.json. Только встроенные модули Node.js 20 и чистый браузерный JS.
- Комментарии в коде — по-русски, в стиле существующих (объясняют «почему»).
- День — всегда по МСК (UTC+3, фиксированно).
- Тесты: `node --test` (из корня; на Node 22+ `node --test test/` не работает) — файлы `test/*.test.js`, встроенные `node:test` и `node:assert`. Проверка проекта целиком — эта же команда; один файл — `node --test test/<file>.test.js`. Локально стоит Node 24, в Docker — Node 20.
- Новые файлы для клиента — в `public/`; при изменении любого файла из `SHELL_FILES` или добавлении нового — поднять `CACHE_NAME` в `public/sw.js` и дописать файл в `SHELL_FILES`.
- Существующие функции (дневник, прогресс, награды, профиль, напоминания, инструмент разработчика, оптимистичные обновления) не ломать; формат `db.json` и данных в Upstash не менять.

## Границы, решённые в спецификации

### 1. `public/today.js` — общий для браузера и сервера расчёт «сегодня» и фразы дня
Владеет: списком мотивационных фраз, выбором фразы на день, подсчётом сегодняшних сумм.
Один файл, работает в обоих окружениях: в браузере кладёт объект в `window.YahuToday`, в Node — `module.exports` (тот же объект). Без зависимостей.

```js
YahuToday = {
  MOTIVATIONAL_PHRASES: string[],          // перенесён из lib/motivational.js без изменений текста
  moscowDayKey(date: Date|string|number): string,   // 'YYYY-MM-DD' по МСК
  getMotivationalPhrase(now?: Date): string,         // одна фраза на МОСКОВСКИЕ сутки, одинаковая на всех устройствах
  computeToday(input, now?: Date): {
    todayCalories: number, todayProtein: number, todayFat: number, todayCarbs: number, // Б/Ж/У округлены до 0,1
    todayWater: number, waterRemaining: number, isOverBudget: boolean, lastWeight: number,
  },
}
// input = { foods: [{calories,protein,fat,carbs,date}], water: [{amount,date}],
//           weights: [{kilograms,date}], dailyTarget: number, waterTarget: number, startWeight: number }
```
Выбор фразы: индекс = (число московских суток от эпохи) % длина списка.
`lib/motivational.js` остаётся и реэкспортирует `getMotivationalPhrase`, `MOTIVATIONAL_PHRASES` из `../public/today.js`.
`server.js` `computeDerived()` берёт эти поля из `computeToday(...)` — одна формула на сервере и в браузере.

### 2. Сервер: лёгкий `/api/state`, фото отдельно, быстрый старт
- **Ответ `computeDerived()`** (`/api/state` и все мутации): `profile` без `photoDataUrl`; вместо него `profile.photoVersion: string|null` — короткий хэш (первые 12 hex sha1) от data URL, `null`, если фото нет. Остальные поля ответа — как были. Дополнительно поле `serverDayKey: string` (`moscowDayKey(now)`).
- **`GET /api/profile/photo`** — бинарное изображение из `state.profile.photoDataUrl`: `Content-Type` из data URL, `Cache-Control: private, max-age=31536000, immutable` (клиент всегда ходит с `?v=<photoVersion>`). Нет фото → 404 JSON `{error}`. POST/DELETE `/api/profile/photo` — как были.
- **Старт:** `server.listen` сразу; загрузка из Upstash идёт параллельно, её промис — `ready`. Все запросы `/api/*`, кроме `/api/health`, сначала `await ready`. Статика и `/api/health` отвечают сразу. `/api/health` добавляет поле `ready: boolean`.
- `state` в памяти, `db.json` и Upstash по-прежнему хранят `photoDataUrl` — меняется только то, что уходит клиенту.

### 3. Клиент: старт приложения
- **Заставка** — разметка `#splash` в `public/index.html` сразу после `<body>`, видна по умолчанию, поверх всего; слоган дня ставится маленьким inline-скриптом сразу после разметки через `window.YahuToday.getMotivationalPhrase()` (`today.js` подключён в `<head>` обычным `<script>`, до него).
- **Снимок в localStorage**: ключ `'yahu:lastState:v2'`, значение `{ savedAt: ISO, state: <ответ сервера без фото> }`. Старый ключ v1 читается один раз как запасной вариант и удаляется.
- **`applyLocalToday(state, now)`** в `app.js` — возвращает копию снимка, где поля «сегодня» пересчитаны `YahuToday.computeToday`, `motivationalPhrase` = фраза дня, а `macroTip` обнулён, если `state.serverDayKey` ≠ сегодняшний `moscowDayKey`.
- **Индикатор свежести** `#syncStatus` рядом с `#todayDateLabel`: состояния `syncing` («Обновляю…»), `fresh` (скрыт), `offline` («Нет связи · данные на HH:MM»). Заменяет нынешний toast при неудаче загрузки.
- Фото: `background-image: url('/api/profile/photo?v=<photoVersion>')`, если `photoVersion` не null.

## Построено в тасках

### T01
- `public/today.js` → `window.YahuToday` / `module.exports` = `{ MOTIVATIONAL_PHRASES, moscowDayKey(date), getMotivationalPhrase(now?), computeToday(input, now?) }` — как в §1. `lib/motivational.js` реэкспортирует его.
- `server.js` экспортирует `createApp({ dataFile, dishesFile, defaultDishesFile, versionFile, publicDir?, loadRemote? = syncStoreWithUpstash }) → { server, store, ready }`; при `require` порт не слушает, сам стартует только при `node server.js`. Тесты сервера — `test/server.test.js` (поднимают `createApp` на свободном порту).
- Ответ `computeDerived`: `profile` без `photoDataUrl` + `profile.photoVersion` (12 hex sha1 | null), `serverDayKey`. `GET /api/profile/photo` → байты, `Content-Type` из data URL, `private, max-age=31536000, immutable`; без фото → 404 `{error}`. `/api/health` → `+ready: boolean`.
- Если загрузка из Upstash упала, `ready` всё равно разрешается, и `/api/*` работают на локальном файле.
### T02
- `public/startup.js` → `window.YahuStartup` / `module.exports` = `{ SPLASH_MIN_MS=3500, SPLASH_MAX_WITH_SNAPSHOT_MS=6000, SLOW_HINT_MS=6000, FETCH_TIMEOUT_MS=60000, REVISIT_REFRESH_MS=60000, applyLocalToday(state, now), splashDecision({elapsedMs, hasSnapshot, hasFresh, failed, repeatVisit}) → {hide, slowHint, showError}, canDismissSplash({hasSnapshot, hasFresh}), shouldSkipSplash(session, local), markSplashShown(session), writeSnapshot(storage, state, now), readSnapshot(storage) → {savedAt, state}|null, shouldRefreshOnVisible(nowMs, lastSuccessMs), offlineLabel(savedAt) }`. Тесты — `test/startup.test.js`.
- `app.js`: `applyLocalToday` (обёртка), `loadState()` → Promise (один запрос в полёте, таймаут 60 с), `setSyncStatus('syncing'|'fresh'|'offline')`, `startApp()`, `dismissSplash()`, `retryInitialLoad()`; `sessionStorage['yahu:splashShown']`; `#screen-home.stale` — приглушение.
- `index.html`: в `<head>` `/today.js`, `/startup.js`; `#splash` (`#splashPhrase`, `#splashHint`, `#splashError` + «Повторить») сразу после `<body>`; `#syncStatus` у `#todayDateLabel`. `sw.js`: `yahu-shell-v3`, в `SHELL_FILES` `/today.js`, `/startup.js`.
- Снимок пишется только в статусе `fresh`; снимок v1 мигрирует с `savedAt=null` → «Нет связи · данные из прошлого сеанса».
### F1
- `YahuStartup.stateResponseAction({requestSeq, currentSeq, status})` → `'apply'|'drop'|'refetch'`; `YahuStartup.mutationFailureAction({startSeq, currentSeq})` → `{restore, status:'syncing'}`.
- `app.js`: `serverSeq` (+1 на каждый применённый ответ сервера), `applyServerState(result)`, `applyMutationResponse(result)`, `handleMutationFailure(prevState, startSeq)`; `window.yahuSplashControlled = true` — последней строкой `startApp()`.
- `index.html`: страховка заставки — скрывается через 7000 мс без `yahuSplashControlled`; `window.yahuSplashTap()`. `sw.js`: `yahu-shell-v4`.