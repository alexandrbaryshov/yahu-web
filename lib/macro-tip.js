// Подсказка на главном экране: если один из макросов (Б/Ж/У) уже набран на
// сегодня, а другой ещё не дотягивает до нормы, предлагаем блюда, которые
// помогут добрать недостающий макрос, не разгоняя дальше тот, что уже в норме.
const MACRO_LABELS = {
  protein: { short: 'Белки', dative: 'белкам', instrumental: 'белками' },
  fat: { short: 'Жиры', dative: 'жирам', instrumental: 'жирами' },
  carbs: { short: 'Углеводы', dative: 'углеводам', instrumental: 'углеводами' },
};

/**
 * @param {{protein:number, fat:number, carbs:number}} today  сколько уже съедено сегодня
 * @param {{protein:number, fat:number, carbs:number}} targets дневные нормы
 * @param {{recommendForMacro: Function}} dishesRepo
 */
function buildMacroTip(today, targets, dishesRepo) {
  const macros = [
    { key: 'protein', today: today.protein, target: targets.protein },
    { key: 'fat', today: today.fat, target: targets.fat },
    { key: 'carbs', today: today.carbs, target: targets.carbs },
  ].filter((m) => m.target > 0);

  const met = macros.filter((m) => m.today >= m.target);
  const short = macros.filter((m) => m.today < m.target);
  // Подсказка имеет смысл, только если есть и «уже набрано», и «ещё не хватает» —
  // если превышено всё сразу или не превышено ничего, предлагать нечего.
  if (!met.length || !short.length) return null;

  // Показываем самый значительно превышенный макрос...
  met.sort((a, b) => (b.today / b.target) - (a.today / a.target));
  const metMacro = met[0];
  // ...и подбираем блюда под тот из недобранных, где остался наибольший разрыв в граммах.
  short.sort((a, b) => (b.target - b.today) - (a.target - a.today));
  const needMacro = short[0];

  const suggestions = dishesRepo.recommendForMacro(needMacro.key, metMacro.key, 6)
    .map((d) => ({ name: d.name, kcal100: d.kcal100, protein100: d.protein100, fat100: d.fat100, carbs100: d.carbs100, portion: d.portion }));
  if (!suggestions.length) return null;

  return {
    metMacro: metMacro.key,
    metLabel: MACRO_LABELS[metMacro.key].dative,
    needMacro: needMacro.key,
    needLabel: MACRO_LABELS[needMacro.key].instrumental,
    suggestions,
  };
}

module.exports = { buildMacroTip };
