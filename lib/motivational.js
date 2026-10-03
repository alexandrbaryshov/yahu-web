// Мотивационные фразы дня. Сам список и выбор фразы теперь живут в
// public/today.js — общем для браузера и сервера файле, чтобы заставка в
// браузере и ответ сервера показывали одну и ту же фразу (по МОСКОВСКИМ
// суткам). Модуль оставлен как реэкспорт для обратной совместимости.
const { getMotivationalPhrase, MOTIVATIONAL_PHRASES } = require('../public/today');

module.exports = { getMotivationalPhrase, MOTIVATIONAL_PHRASES };
