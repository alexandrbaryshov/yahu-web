// Общий для браузера и сервера расчёт «сегодня» и фразы дня.
//
// Зачем один файл на двоих: главная в браузере пересчитывает цифры «сегодня»
// из снимка, пока сервер просыпается, а потом подменяет их серверными. Если
// формулы разойдутся, на экране мелькнут два разных числа. Поэтому и сервер
// (server.js → computeDerived), и браузер считают ровно этой функцией.
//
// Без зависимостей и без модулей: в браузере подключается обычным <script>
// и кладёт объект в window.YahuToday, в Node отдаётся через module.exports.
(function (root) {
  // День — всегда по МСК. Россия не переводит часы с 2014 года, поэтому
  // смещение фиксированное UTC+3 (см. также lib/moscow-time.js).
  var MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Мотивационные фразы дня (перенесены из lib/motivational.js без изменений).
  var MOTIVATIONAL_PHRASES = [
    'Каждый маленький шаг сегодня — это забота о себе завтра.',
    'Вы не опаздываете и не отстаёте — вы идёте своим темпом, и этого достаточно.',
    'Один осознанный выбор за раз — вот и весь секрет.',
    'Тело слышит всё, что вы ему говорите. Сегодня скажите что-то доброе.',
    'Прогресс редко бывает прямой линией — и это нормально.',
    'Вы уже сделали самое сложное — начали. Остальное — по чуть-чуть.',
    'Не нужно быть идеальным сегодня. Нужно просто быть немного добрее к себе.',
    'Маленькая победа — тоже победа. Отмечайте их.',
    'Ваше тело — не проект, который нужно доделать, а дом, в котором стоит жить с уважением.',
    'Хороший день начинается не с идеального плана, а с одного доброго решения.',
    'Вы заслуживаете терпения — особенно от самих себя.',
    'Не сравнивайте свой путь с чужим — сравнивайте с собой вчерашним.',
    'Забота о себе — это не эгоизм, а необходимость.',
    'Сегодняшний выбор не обязан быть безупречным, он просто должен быть вашим.',
    'Стабильность важнее скорости. Вы двигаетесь — и этого достаточно.',
    'Тело меняется медленнее, чем хочется, но оно меняется — доверьтесь процессу.',
    'Отдых — тоже часть пути, а не отступление от него.',
    'Вы не должны заслуживать заботу о себе — она у вас уже есть.',
    'Один хороший день не решает всё, но и один трудный день не перечёркивает всё.',
    'Слушайте своё тело сегодня чуть внимательнее, чем вчера.',
    'Маленькие привычки складываются в большие перемены — незаметно, но верно.',
    'Вы уже не тот человек, что начинал этот путь. Гордитесь этим.',
    'Не гонитесь за совершенством — стремитесь к постоянству.',
    'Каждый стакан воды, каждый спокойный приём пищи — это забота, а не обязанность.',
    'Сегодня хороший день, чтобы быть немного добрее к себе, чем вчера.',
    'Ваш темп — единственно правильный темп для вас.',
    'Путь к цели складывается из обычных дней, а не из подвигов.',
    'Позвольте себе двигаться вперёд без чувства вины за паузы.',
    'То, что вы делаете сегодня, не должно быть грандиозным — оно должно быть вашим.',
    'Забота о себе сегодня — это подарок себе завтрашнему.',
  ];

  // Номер московских суток от эпохи. Раньше фраза бралась по UTC-суткам и
  // менялась в 03:00 МСК — а не в полночь, как всё остальное в приложении.
  function moscowDayNumber(date) {
    return Math.floor((new Date(date).getTime() + MOSCOW_OFFSET_MS) / MS_PER_DAY);
  }

  // 'YYYY-MM-DD' по московскому календарю (не toISOString — тот дал бы дату по UTC).
  function moscowDayKey(date) {
    var s = new Date(new Date(date).getTime() + MOSCOW_OFFSET_MS);
    var m = String(s.getUTCMonth() + 1);
    var d = String(s.getUTCDate());
    return s.getUTCFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (d.length < 2 ? '0' + d : d);
  }

  // Одна фраза на московские сутки — одинаковая на всех устройствах и на сервере.
  function getMotivationalPhrase(now) {
    var day = moscowDayNumber(now || new Date());
    return MOTIVATIONAL_PHRASES[day % MOTIVATIONAL_PHRASES.length];
  }

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  // Сегодняшние суммы по записям, чья дата — сегодня по МСК. Та же формула,
  // что была на сервере: Б/Ж/У до 0,1; калории и вода — как есть.
  function computeToday(input, now) {
    var today = moscowDayNumber(now || new Date());
    var foods = input.foods || [];
    var water = input.water || [];
    var weights = input.weights || [];
    var cal = 0, protein = 0, fat = 0, carbs = 0, todayWater = 0;
    var i, e;
    for (i = 0; i < foods.length; i++) {
      e = foods[i];
      if (moscowDayNumber(e.date) !== today) continue;
      cal += e.calories || 0;
      protein += e.protein || 0;
      fat += e.fat || 0;
      carbs += e.carbs || 0;
    }
    for (i = 0; i < water.length; i++) {
      e = water[i];
      if (moscowDayNumber(e.date) === today) todayWater += e.amount || 0;
    }
    // Самый свежий вес по дате, иначе стартовый.
    var latest = null;
    for (i = 0; i < weights.length; i++) {
      if (!latest || new Date(weights[i].date) > new Date(latest.date)) latest = weights[i];
    }
    var lastWeight = latest && latest.kilograms != null ? latest.kilograms : input.startWeight;
    return {
      todayCalories: cal,
      todayProtein: round1(protein),
      todayFat: round1(fat),
      todayCarbs: round1(carbs),
      todayWater: todayWater,
      waterRemaining: Math.max(0, input.waterTarget - todayWater),
      isOverBudget: cal > input.dailyTarget,
      lastWeight: lastWeight,
    };
  }

  var api = {
    MOTIVATIONAL_PHRASES: MOTIVATIONAL_PHRASES,
    moscowDayKey: moscowDayKey,
    getMotivationalPhrase: getMotivationalPhrase,
    computeToday: computeToday,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.YahuToday = api;
})(typeof window !== 'undefined' ? window : null);
