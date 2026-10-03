# Заметки по существующему коду

Разведку делал сам оркестратор: нужные файлы уже были прочитаны на брифинге, отдельный субагент не запускался.

## Стек и команды
- Node.js 20 (Dockerfile `node:20-alpine`), **без npm-зависимостей и без package.json**. Только встроенные модули.
- Запуск: `node server.js` (PORT=3000, DATA_FILE=./data/db.json).
- Тестов в проекте нет. Новые тесты — на встроенном раннере: `node --test test/` (файлы `test/*.test.js`).
- Docker копирует только `server.js`, `xlsxReader.js`, `lib/`, `public/`, `seed/dishes.xlsx`. Новый код — только в этих местах.
- Деплой: Render, бесплатный тариф. Хранилище, переживающее перезапуск контейнера: Upstash Redis (`lib/remote-sync.js`), весь state одним JSON под ключом `yahu-app-state`.
- Пинг от засыпания: `.github/workflows/keep-alive.yml`, cron `*/10`, GET `${SITE_URL}/api/health`.

## Сервер
- `server.js` — роутер на `http.createServer`; `computeDerived()` собирает ответ `/api/state`, и его же возвращают **все** мутирующие эндпоинты.
- `computeDerived()` вызывает `processAchievements(state)` (lib/achievements.js) и при изменениях — `store.save()`.
- Сегодняшние суммы: `sumTodayMulti(state.foods, ['calories','protein','fat','carbs'])`, `sumToday(state.water,'amount')` из `lib/store.js`; день считается по МСК (`lib/moscow-time.js`, фиксированный UTC+3).
- Б/Ж/У округляются до 0,1: `Math.round(x*10)/10`. `lastWeight` — самый свежий вес, иначе `startWeight`. `isOverBudget = todayCalories > dailyTarget`. `waterRemaining = max(0, water - todayWater)`.
- Цели: `DAILY_TARGETS = { calories:1800, protein:90, fat:60, carbs:220, water:1500 }` в `lib/store.js`; `state.dailyTarget`, `state.goalWeight`, `state.startWeight` — в state.
- `lib/motivational.js` — `MOTIVATIONAL_PHRASES` (30 фраз), `getMotivationalPhrase()` берёт день как `floor(Date.now()/86400000)`. Это **сутки по UTC**: фраза меняется в 03:00 МСК, а не в полночь.
- Фото профиля: `state.profile.photoDataUrl` — data URL jpeg/png до 5 МБ (≈6,8 МБ текста). Попадает в **каждый** ответ `computeDerived()` и в каждое `SET` в Upstash.
- Старт: `await syncStoreWithUpstash(store)` (таймаут 8 с) **до** `server.listen` — на холодном старте ничего не отвечает, пока Upstash не ответит.
- `lib/http-utils.js`: `sendJSON(req,res,status,data)` (gzip, `no-store`), `serveStatic`, `readBody`. `.js`/`.html` отдаются с `no-cache`.
- `/api/health` — лёгкий, его пингует keep-alive.

## Клиент
- `public/index.html` (стили inline, `<script src="app.js">` в конце body, preload app.js). Мотивационная фраза — `#motivationalPhrase` (по умолчанию «Загрузка…»), дата — `#todayDateLabel`.
- `public/app.js` — один скрипт без модулей, глобальные функции (обработчики `onclick` в HTML).
  - `api.get/post/put/del` — обёртки над fetch.
  - Кэш: `STATE_CACHE_KEY = 'yahu:lastState:v1'`, `cacheState()` (фото вырезается), `readCachedState()`.
  - `loadState()` (стр. 148): показывает кэш как есть, затем `await api.get('/api/state')`; при ошибке — toast. Вызывается при старте (стр. 1336), в полночь по МСК (`scheduleMidnightRefresh`) и при неудачных мутациях.
  - `render()` → `renderHome()` (берёт **серверные** `todayCalories`, `todayProtein`… и `motivationalPhrase` из appState), `renderMacroTip()`, `renderProfile()` (фото из `appState.profile.photoDataUrl`, ставится `background-image` на `[data-profile-btn]` и `#profilePhotoPreview`), `renderReminders()`, ленивые diary/progress/achievements.
  - Оптимистичные обновления в `addWaterQuick`, `saveWeight`, добавлении/удалении еды — сохранить как есть.
  - Свои копии МСК-хелперов: `MOSCOW_OFFSET_MS`, `moscowParts`, `startOfDay`.
- `public/sw.js`: `CACHE_NAME = 'yahu-shell-v2'`, `SHELL_FILES`; stale-while-revalidate для статики, `/api/*` мимо кэша. При изменении файлов оболочки — поднимать версию.

## Почему сейчас долго (вывод)
1. GitHub Actions cron систематически опаздывает → Render засыпает → холодный старт контейнера (десятки секунд, кодом не лечится).
2. После старта ещё до 8 с ожидания Upstash до `listen`.
3. Кэш в браузере показывает **вчерашние** «сегодняшние» цифры и фразу — они посчитаны сервером в прошлый раз; на «актуальность» ждём сервер.
4. Каждый ответ несёт фото до ~7 МБ.
