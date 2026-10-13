/**
 * ============================================================================
 * Модуль: Records
 * Ответственность: журнал дней — исполнитель, дата, часы, что сделано.
 *                  Дубли не блокируются: повторная запись сохраняется,
 *                  но помечается, чтобы руководитель видел её отдельно.
 * Зависимости: Config, Utils, Sheets, Objects, Sessions
 * ============================================================================
 */

/**
 * Список записей журнала дней объекта.
 * @param {string} token
 * @param {string} id
 * @return {Object}
 */
function daysList_(token, id) {
  requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  const days = sheetName
    ? readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY).map(dayView_)
    : [];

  days.sort(function (a, b) {
    if (a.date === b.date) return String(a.created) < String(b.created) ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });

  const hours = round2_(days.reduce(function (acc, day) { return acc + day.hours; }, 0));
  return { days: days, hours: hours, count: days.length };
}

/**
 * Добавление записи в журнал дней.
 * @param {string} token
 * @param {string} id
 * @param {Object} day — { date, hours, work, executor }
 * @return {Object} { day, duplicate }
 */
function addDay_(token, id, day) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  const d = day || {};
  const date = isoDate_(d.date) || todayIso_();
  const hours = num_(d.hours, 0);
  const work = truncate_(d.work, 1000);
  const executor = truncate_(d.executor, 80) || session.name;

  assert_(hours > 0, 'Укажите количество часов больше нуля.', 'VALIDATION');
  assert_(hours <= 24, 'За день не может быть больше 24 часов.', 'VALIDATION');
  assert_(work, 'Опишите, что сделано за день.', 'VALIDATION');

  return withLock_(function () {
    // Поиск возможного дубля: та же дата и тот же исполнитель.
    const existing = readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY);
    const duplicate = existing.some(function (row) {
      return isoDate_(row['дата']) === date &&
        str_(row['исполнитель']).toLowerCase() === executor.toLowerCase();
    });

    const record = {
      'id': uid_('D'),
      'дата': date,
      'исполнитель': executor,
      'часы': round2_(hours),
      'что сделано': work,
      'дубль': duplicate ? 'да' : '',
      'создано': nowIso_()
    };

    appendBlockRow_(sheetName, CONFIG.OBJECT_BLOCKS.DAY, OBJECT_HEADERS[CONFIG.OBJECT_BLOCKS.DAY], record);
    recalcHours_(object);

    logVisit_(session.name, session.role,
      'записал день по объекту ' + objectView_(object).title + (duplicate ? ' (повтор)' : ''), {});

    return {
      ok: true,
      day: dayView_(record),
      duplicate: duplicate,
      message: duplicate
        ? 'Запись сохранена и помечена как повторная: за эту дату у этого исполнителя уже есть часы.'
        : 'Запись добавлена.'
    };
  });
}

/**
 * Удаление записи журнала дней.
 * @param {string} token
 * @param {string} id
 * @param {string} rowId
 * @return {Object}
 */
function daysRemove_(token, id, rowId) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  const key = str_(rowId);
  assert_(key, 'Не указана запись.', 'VALIDATION');

  return withLock_(function () {
    const rows = readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY);
    const target = rows.filter(function (row) { return str_(row['id']) === key; })[0];
    assert_(target, 'Запись не найдена.', 'NOT_FOUND');

    deleteBlockRow_(sheetName, target._row);
    recalcHours_(object);

    logVisit_(session.name, session.role, 'удалил запись дня по объекту ' + objectView_(object).title, {});
    return { ok: true };
  });
}

/**
 * Записи за сегодня по всем объектам — для панели руководителя.
 * @param {string} token
 * @param {string=} date
 * @return {Object}
 */
function todayRecords_(token, date) {
  requireLeader_(token);
  const target = isoDate_(date) || todayIso_();
  const objects = readRows_(CONFIG.SHEETS.OBJECTS);
  const records = [];

  objects.forEach(function (object) {
    const sheetName = str_(object['лист']);
    if (!sheetName) return;
    readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY).forEach(function (row) {
      const day = dayView_(row);
      if (day.date !== target) return;
      records.push({
        objectId: str_(object['id']),
        objectTitle: str_(object['название']),
        objectNumber: pad_(int_(object['номер'], 0), 3),
        executor: day.executor,
        hours: day.hours,
        work: day.work,
        duplicate: day.duplicate
      });
    });
  });

  records.sort(function (a, b) {
    return String(a.executor).localeCompare(String(b.executor), 'ru');
  });

  const hours = round2_(records.reduce(function (acc, r) { return acc + r.hours; }, 0));
  const executors = {};
  records.forEach(function (r) { executors[r.executor] = true; });

  return {
    date: target,
    records: records,
    hours: hours,
    executors: Object.keys(executors).length,
    objectsTouched: records.reduce(function (acc, r) {
      if (acc.indexOf(r.objectId) === -1) acc.push(r.objectId);
      return acc;
    }, []).length
  };
}
