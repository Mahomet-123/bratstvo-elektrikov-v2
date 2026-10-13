/**
 * ============================================================================
 * Модуль: Analytics
 * Ответственность: сводки для руководителя — суммы по дням, прогресс по объектам
 *                  и общий итог. Считает по реестру объектов и листам объектов.
 *                  Доступно только руководителю.
 * Зависимости: Config, Utils, Sheets, Objects, Sessions
 * ============================================================================
 */

/**
 * Сводка по объектам: смета, закупки, часы, позиции и остаток.
 * @param {string} token
 * @param {Object=} options — { includeClosed }
 * @return {Object}
 */
function analyticsSummary_(token, options) {
  requireLeader_(token);
  const o = options || {};
  const includeClosed = o.includeClosed === undefined ? true : bool_(o.includeClosed);

  const rows = readRows_(CONFIG.SHEETS.OBJECTS);
  const objects = [];
  const totals = {
    objects: 0,
    open: 0,
    closed: 0,
    estimate: 0,
    purchases: 0,
    hours: 0,
    positions: 0,
    // Сколько сметы ещё не закрыто закупками — «остаток работ».
    remaining: 0
  };

  rows.forEach(function (row) {
    const view = objectView_(row);
    if (!includeClosed && view.status === CONFIG.STATUS_CLOSED) return;

    // Итоги берём из реестра: он обновляется при каждой правке расчёта,
    // закупки и дней. Лишние обращения к листам объектов не нужны.
    const estimate = num_(view.totals.estimate, 0);
    const purchases = num_(view.totals.purchases, 0);
    const hours = num_(view.totals.hours, 0);
    const positions = int_(row['позиции'], 0);

    objects.push({
      id: view.id,
      numberLabel: view.numberLabel,
      title: view.title,
      client: view.client,
      status: view.status,
      estimate: round2_(estimate),
      purchases: round2_(purchases),
      hours: round2_(hours),
      remaining: round2_(Math.max(0, estimate - purchases)),
      created: view.created,
      closed: view.closed
    });

    totals.objects++;
    if (view.status === CONFIG.STATUS_CLOSED) totals.closed++;
    else totals.open++;
    totals.estimate = round2_(totals.estimate + estimate);
    totals.purchases = round2_(totals.purchases + purchases);
    totals.hours = round2_(totals.hours + hours);
    totals.positions += positions;
    totals.remaining = round2_(totals.remaining + Math.max(0, estimate - purchases));
  });

  // Дорогие объекты — наверх: руководителю важно видеть крупные работы.
  objects.sort(function (a, b) { return b.estimate - a.estimate; });

  return { objects: objects, totals: totals };
}

/**
 * Сводка по дням: сколько часов и записей за каждый день периода.
 * @param {string} token
 * @param {Object=} options — { from, to, limit }
 * @return {Object}
 */
function analyticsDays_(token, options) {
  requireLeader_(token);
  const o = options || {};
  const limit = Math.min(Math.max(int_(o.limit, 30), 1), 180);

  const to = isoDate_(o.to) || todayIso_();
  const from = isoDate_(o.from) || isoDate_(addDays_(to, -(limit - 1)));

  const byDate = {};
  const executors = {};

  readRows_(CONFIG.SHEETS.OBJECTS).forEach(function (object) {
    const sheetName = str_(object['лист']);
    if (!sheetName) return;
    const title = str_(object['название']);
    const numberLabel = pad_(int_(object['номер'], 0), 3);

    const days = withObjectSheet_(object, function () {
      return readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY);
    });

    days.forEach(function (row) {
      const day = dayView_(row);
      if (!day.date) return;
      if (day.date < from || day.date > to) return;

      if (!byDate[day.date]) {
        byDate[day.date] = { date: day.date, hours: 0, records: 0, objects: [], duplicates: 0 };
      }
      const bucket = byDate[day.date];
      bucket.hours = round2_(bucket.hours + day.hours);
      bucket.records++;
      if (day.duplicate) bucket.duplicates++;
      if (bucket.objects.indexOf(numberLabel + ' ' + title) === -1) {
        bucket.objects.push(numberLabel + ' ' + title);
      }
      if (day.executor) executors[day.executor] = round2_((executors[day.executor] || 0) + day.hours);
    });
  });

  const days = Object.keys(byDate).sort().reverse().map(function (key) {
    return byDate[key];
  });

  const hours = round2_(days.reduce(function (acc, d) { return acc + d.hours; }, 0));
  const records = days.reduce(function (acc, d) { return acc + d.records; }, 0);

  const byExecutor = Object.keys(executors).map(function (name) {
    return { name: name, hours: executors[name] };
  }).sort(function (a, b) { return b.hours - a.hours; });

  return {
    from: from,
    to: to,
    days: days,
    byExecutor: byExecutor,
    totals: {
      hours: hours,
      records: records,
      workDays: days.length,
      average: days.length ? round2_(hours / days.length) : 0
    }
  };
}
