// База блюд (dishes.xlsx) — загрузка, поиск, поиск по точному имени.
// Ни одного обращения в интернет: только локальный Excel-файл.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readXlsxAsObjects } = require('../xlsxReader');

function normalizeRu(s) {
  return String(s).toLowerCase().replace(/ё/g, 'е').trim();
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Создаёт репозиторий базы блюд, читающий и кэширующий dishes.xlsx в памяти.
 * @param {{dishesFile:string, defaultDishesFile:string, versionFile:string}} config
 */
function createDishesRepository({ dishesFile, defaultDishesFile, versionFile }) {
  let dishesDB = [];

  function load() {
    try {
      // Автоматическое обновление базы: если версия эталонного файла dishes.xlsx,
      // "зашитого" в образ, изменилась (т.е. вышло обновление приложения с новыми
      // блюдами/столбцами), пересеиваем её в volume заново. Это устраняет старую
      // проблему, когда после docker compose up --build volume молча оставался
      // со старой базой без новых блюд/флагов, и приходилось чистить его вручную.
      if (fs.existsSync(defaultDishesFile)) {
        const defaultHash = fileHash(defaultDishesFile);
        let storedHash = null;
        try { storedHash = fs.readFileSync(versionFile, 'utf8').trim(); } catch { /* нет маркера — первый запуск с этой логикой */ }
        if (!fs.existsSync(dishesFile) || storedHash !== defaultHash) {
          fs.mkdirSync(path.dirname(dishesFile), { recursive: true });
          fs.copyFileSync(defaultDishesFile, dishesFile);
          fs.writeFileSync(versionFile, defaultHash);
          console.log('База блюд обновлена до актуальной версии из образа (dishes.xlsx пересеян).');
        }
      }
      const rows = readXlsxAsObjects(dishesFile);
      dishesDB = rows
        .map((r) => ({
          name: String(r['Название блюда'] || '').trim(),
          category: String(r['Категория'] || '').trim(),
          keywords: String(r['Ключевые слова (для поиска)'] || '').toLowerCase(),
          kcal100: Number(r['Калории, ккал/100 г']) || 0,
          protein100: Number(r['Белки, г/100 г']) || 0,
          fat100: Number(r['Жиры, г/100 г']) || 0,
          carbs100: Number(r['Углеводы, г/100 г']) || 0,
          portion: Number(r['Типичная порция, г']) || 150,
          // Блюда с пометкой "да" (вода, чай/кофе без сахара) засчитываются в счётчик воды.
          isWater: normalizeRu(r['Считается как вода (да/нет)'] || '') === 'да',
        }))
        .filter((d) => d.name && (d.kcal100 > 0 || d.isWater));
      console.log(`База блюд загружена: ${dishesDB.length} записей из ${dishesFile}`);
    } catch (err) {
      console.error('Не удалось загрузить базу блюд (dishes.xlsx):', err.message);
      dishesDB = [];
    }
  }

  // Простой типизированный поиск: точное совпадение начала слова весит
  // больше, чем совпадение где-то в середине названия/ключевых слов.
  function search(query, limit = 8) {
    const q = normalizeRu(query);
    if (q.length < 1) return [];
    const scored = [];
    for (const dish of dishesDB) {
      const name = normalizeRu(dish.name);
      const keywords = normalizeRu(dish.keywords);
      let score = -1;
      if (name.startsWith(q)) score = 100;
      else if (keywords.split(',').some((k) => k.trim().startsWith(q))) score = 80;
      else if (name.includes(q)) score = 50;
      else if (keywords.includes(q)) score = 30;
      if (score >= 0) scored.push({ dish, score });
    }
    scored.sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name, 'ru'));
    return scored.slice(0, limit).map((s) => s.dish);
  }

  function findByName(name) {
    const n = normalizeRu(name);
    return dishesDB.find((d) => normalizeRu(d.name) === n);
  }

  // Подбор блюд для «добора» одного макроса (needKey), когда другой (avoidKey)
  // уже выполнен за день. Сортируем по содержанию нужного макроса на 100 г,
  // слегка штрафуя содержание того макроса, который добирать уже не нужно —
  // чтобы не предлагать, например, "добор белка" блюдом, которое одновременно
  // рекордно жирное или углеводное.
  function recommendForMacro(needKey, avoidKey, limit = 6) {
    const field = needKey + '100';
    const avoidField = avoidKey + '100';
    const candidates = dishesDB.filter((d) => !d.isWater && d[field] > 0);
    const scored = candidates.map((dish) => ({ dish, score: dish[field] - 0.5 * (dish[avoidField] || 0) }));
    scored.sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name, 'ru'));
    return scored.slice(0, limit).map((s) => s.dish);
  }

  load();

  return {
    search,
    findByName,
    recommendForMacro,
    reload: load,
    get count() { return dishesDB.length; },
  };
}

module.exports = { createDishesRepository, normalizeRu };
