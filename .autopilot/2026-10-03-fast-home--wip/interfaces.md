# Интерфейсы и правила проекта

Читать первым. Подробности о существующем коде — `notes.md`.

## Правила проекта
- Никаких npm-зависимостей, никакого package.json. Только встроенные модули Node.js 20 и чистый браузерный JS.
- Комментарии в коде — по-русски, в стиле существующих (объясняют «почему»).
- День — всегда по МСК (UTC+3, фиксированно).
- Тесты: `node --test test/` — файлы `test/*.test.js`, встроенные `node:test` и `node:assert`. Проверка проекта целиком — эта же команда.
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
