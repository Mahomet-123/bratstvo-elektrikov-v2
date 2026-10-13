/**
 * ============================================================================
 * Модуль: Objects
 * Ответственность: объекты бригады — создание карточки и личного листа объекта
 *                  с блоками РАСЧЁТ / ДЕНЬ / ЗАКУПКА, смена статуса, список,
 *                  пересчёт итогов, архивация по годам.
 * Зависимости: Config, Utils, Sheets, Sessions, DriveFiles, Calc
 * ============================================================================
 */

// Порядок блоков при создании листа объекта.
const OBJECT_BLOCK_ORDER_ = [
  CONFIG.OBJECT_BLOCKS.CALC,
  CONFIG.OBJECT_BLOCKS.DAY,
  CONFIG.OBJECT_BLOCKS.PURCHASE
];

/* --------------------------------------------------------------------------
 * Поиск и представление
 * ------------------------------------------------------------------------ */

/**
 * Следующий свободный номер объекта.
 * @return {number}
 */
function nextObjectNumber_() {
  const rows = readRows_(CONFIG.SHEETS.OBJECTS);
  let max = 0;
  rows.forEach(function (row) {
    const n = int_(row['номер'], 0);
    if (n > max) max = n;
  });
  return max + 1;
}

/**
 * Имя листа объекта: «005_Коттедж в Магасе».
 * @param {number} number
 * @param {string} title
 * @return {string}
 */
function objectSheetName_(number, title) {
  const safeTitle = sheetSafeName_(title) || 'Объект';
  return pad_(number, 3) + '_' + truncate_(safeTitle, CONFIG.OBJECT_TAB_NAME_MAX);
}

/**
 * Создание листа объекта с тремя пустыми блоками.
 * @param {string} sheetName
 * @return {Sheet}
 */
function createObjectSheet_(sheetName) {
  const ss = ss_();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  OBJECT_BLOCK_ORDER_.forEach(function (block) {
    ensureBlock_(sheetName, block, OBJECT_HEADERS[block]);
  });

  sh.setColumnWidth(1, 110);
  sh.setColumnWidth(2, 150);
  sh.setColumnWidth(4, 320);
  return sh;
}

/**
 * Объект по идентификатору или понятная ошибка.
 * @param {string} id
 * @return {Object} строка листа «Объекты»
 */
function requireObject_(id) {
  const key = str_(id);
  assert_(key, 'Не указан объект.', 'VALIDATION');
  const object = findRow_(CONFIG.SHEETS.OBJECTS, function (row) {
    return str_(row['id']) === key;
  });
  assert_(object, 'Объект не найден.', 'NOT_FOUND');
  return object;
}

/**
 * Объект по номеру.
 * @param {number} number
 * @return {Object|null}
 */
function findObjectByNumber_(number) {
  return findRow_(CONFIG.SHEETS.OBJECTS, function (row) {
    return int_(row['номер'], 0) === int_(number, 0);
  });
}

/**
 * Представление объекта для клиента.
 * @param {Object} object — строка листа «Объекты»
 * @param {boolean=} withTotals — добавить пересчитанные итоги
 * @return {Object}
 */
function objectView_(object, withTotals) {
  const number = int_(object['номер'], 0);
  const view = {
    id: str_(object['id']),
    number: number,
    numberLabel: pad_(number, 3),
    title: str_(object['название']),
    client: str_(object['клиент']),
    address: str_(object['адрес']),
    phone: str_(object['телефон']),
    status: str_(object['статус']) || CONFIG.STATUS_CALC,
    sheet: str_(object['лист']),
    hasCabinet: bool_(object['кабинет']),
    created: str_(object['создан']),
    updated: str_(object['обновлён']),
    closed: str_(object['закрыт']),
    archived: str_(object['архив']),
    totals: {
      subtotal: round2_(num_(object['подытог'], 0)),
      supply: round2_(num_(object['снабжение'], 0)),
      commissioning: round2_(num_(object['пусконаладка'], 0)),
      discount: round2_(num_(object['скидка'], 0)),
      discountType: str_(object['тип скидки']) || 'sum',
      materialCost: round2_(num_(object['материал'], 0)),
      equipmentCost: round2_(num_(object['оборудование'], 0)),
      estimate: round2_(num_(object['итог расчёта'], 0)),
      purchases: round2_(num_(object['итог закупок'], 0)),
      hours: num_(object['часы'], 0)
    }
  };

  if (withTotals) {
    const fresh = objectTotalsOf_(object);
    view.totals.subtotal = fresh.subtotal;
    view.totals.supply = fresh.supply;
    view.totals.commissioning = fresh.commissioning;
    view.totals.discount = fresh.discount;
    view.totals.estimate = fresh.estimateTotal;
    view.totals.purchases = fresh.purchases;
    view.totals.positions = fresh.positions;
  }

  return view;
}

/* --------------------------------------------------------------------------
 * Список объектов
 * ------------------------------------------------------------------------ */

/**
 * Список объектов.
 * @param {string} token
 * @param {Object=} options — { status, search, includeClosed, limit }
 * @return {Object}
 */
function listObjects_(token, options) {
  requireSession_(token);
  const o = options || {};
  const search = str_(o.search).toLowerCase();
  const status = str_(o.status);
  const includeClosed = o.includeClosed === undefined ? true : bool_(o.includeClosed);

  let list = readRows_(CONFIG.SHEETS.OBJECTS).map(function (row) {
    return objectView_(row, false);
  });

  if (!includeClosed) {
    list = list.filter(function (item) { return item.status !== CONFIG.STATUS_CLOSED; });
  }
  if (status) {
    list = list.filter(function (item) { return item.status === status; });
  }
  if (search) {
    list = list.filter(function (item) {
      return (item.title + ' ' + item.client + ' ' + item.address + ' ' + item.numberLabel)
        .toLowerCase()
        .indexOf(search) !== -1;
    });
  }

  // Порядок: сначала активные (расчёт, в работе), затем закрытые; внутри — по номеру.
  const order = {};
  order[CONFIG.STATUS_WORK] = 0;
  order[CONFIG.STATUS_CALC] = 1;
  order[CONFIG.STATUS_CLOSED] = 2;

  list.sort(function (a, b) {
    const oa = order[a.status] === undefined ? 3 : order[a.status];
    const ob = order[b.status] === undefined ? 3 : order[b.status];
    if (oa !== ob) return oa - ob;
    return b.number - a.number;
  });

  const limit = int_(o.limit, 0);
  const total = list.length;
  if (limit > 0) list = list.slice(0, limit);

  const counts = { calc: 0, work: 0, closed: 0 };
  list.forEach(function (item) {
    if (item.status === CONFIG.STATUS_WORK) counts.work++;
    else if (item.status === CONFIG.STATUS_CLOSED) counts.closed++;
    else counts.calc++;
  });

  return { objects: list, total: total, counts: counts };
}

/* --------------------------------------------------------------------------
 * Карточка объекта
 * ------------------------------------------------------------------------ */

/**
 * Полная карточка объекта: реквизиты, итоги, расчёт, дни, закупки.
 * @param {string} token
 * @param {string} id
 * @return {Object}
 */
function getObjectCard_(token, id) {
  requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);

  const estimate = getEstimateOf_(object);
  const days = sheetName ? readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY).map(dayView_) : [];
  const purchases = sheetName ? readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE).map(purchaseView_) : [];

  const hours = round2_(days.reduce(function (acc, day) { return acc + num_(day.hours, 0); }, 0));
  const purchasesSum = round2_(purchases.reduce(function (acc, item) { return acc + num_(item.sum, 0); }, 0));

  // Держим карточку в актуальном состоянии.
  if (round2_(num_(object['часы'], 0)) !== hours || round2_(num_(object['итог закупок'], 0)) !== purchasesSum) {
    updateRow_(CONFIG.SHEETS.OBJECTS, object._row, {
      'часы': hours,
      'итог закупок': purchasesSum
    });
  }

  const view = objectView_(object, false);
  view.totals.hours = hours;
  view.totals.purchases = purchasesSum;

  return {
    object: view,
    estimate: estimate,
    days: days,
    purchases: purchases,
    progress: {
      estimate: estimate.total,
      purchases: purchasesSum,
      hours: hours,
      materialShare: estimate.total > 0
        ? Math.round((purchasesSum / estimate.total) * 1000) / 10
        : 0
    }
  };
}

/**
 * Представление записи журнала дней.
 * @param {Object} row
 * @return {Object}
 */
function dayView_(row) {
  return {
    id: str_(row['id']),
    date: isoDate_(row['дата']) || str_(row['дата']),
    executor: str_(row['исполнитель']),
    hours: num_(row['часы'], 0),
    work: str_(row['что сделано']),
    duplicate: bool_(row['дубль']),
    created: str_(row['создано'])
  };
}

/**
 * Представление записи закупки.
 * @param {Object} row
 * @return {Object}
 */
function purchaseView_(row) {
  return {
    id: str_(row['id']),
    date: isoDate_(row['дата']) || str_(row['дата']),
    material: str_(row['материал']),
    qty: num_(row['количество'], 0),
    unit: str_(row['единица']),
    price: round2_(num_(row['цена'], 0)),
    sum: round2_(num_(row['сумма'], 0)),
    comment: str_(row['комментарий']),
    photo: str_(row['фото']),
    photoId: str_(row['фото id']),
    created: str_(row['создано'])
  };
}

/* --------------------------------------------------------------------------
 * Изменение объектов
 * ------------------------------------------------------------------------ */

/**
 * Создание объекта.
 * @param {string} token
 * @param {Object} data — { title, client, address, phone, status }
 * @return {Object}
 */
function createObject_(token, data) {
  const session = requireSession_(token);
  const d = data || {};

  const title = truncate_(d.title, 120);
  assert_(title, 'Укажите название объекта.', 'VALIDATION');

  return withLock_(function () {
    const number = nextObjectNumber_();
    const sheetName = objectSheetName_(number, title);
    const id = uid_('O');
    const stamp = nowIso_();
    const status = [CONFIG.STATUS_CALC, CONFIG.STATUS_WORK].indexOf(str_(d.status)) !== -1
      ? str_(d.status)
      : CONFIG.STATUS_CALC;

    const row = {
      'id': id,
      'номер': number,
      'название': title,
      'клиент': truncate_(d.client, 120),
      'адрес': truncate_(d.address, 200),
      'телефон': truncate_(d.phone, 40),
      'статус': status,
      'лист': sheetName,
      'токен': randomToken_(CONFIG.TOKEN_LENGTH),
      'кабинет': 'да',
      'коэф общий': 1,
      'материал': 0,
      'оборудование': 0,
      'скидка': 0,
      'тип скидки': 'sum',
      'подытог': 0,
      'снабжение': 0,
      'пусконаладка': 0,
      'итог расчёта': 0,
      'итог закупок': 0,
      'часы': 0,
      'создан': stamp,
      'обновлён': stamp,
      'закрыт': '',
      'архив': ''
    };

    appendRowSafe_(CONFIG.SHEETS.OBJECTS, row);
    createObjectSheet_(sheetName);

    logVisit_(session.name, session.role, 'создал объект ' + sheetName, {});

    const created = findObjectByNumber_(number);
    return { ok: true, object: objectView_(created, true) };
  });
}

/**
 * Изменение реквизитов объекта.
 * @param {string} token
 * @param {string} id
 * @param {Object} data
 * @return {Object}
 */
function updateObject_(token, id, data) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const d = data || {};

  const patch = { 'обновлён': nowIso_() };
  if (d.title !== undefined) {
    const title = truncate_(d.title, 120);
    assert_(title, 'Название объекта не может быть пустым.', 'VALIDATION');
    patch['название'] = title;
  }
  if (d.client !== undefined) patch['клиент'] = truncate_(d.client, 120);
  if (d.address !== undefined) patch['адрес'] = truncate_(d.address, 200);
  if (d.phone !== undefined) patch['телефон'] = truncate_(d.phone, 40);

  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.OBJECTS, object._row, patch);
    logVisit_(session.name, session.role, 'изменил объект ' + objectView_(object).title, {});
    return { ok: true, object: objectView_(requireObject_(id), true) };
  });
}

/**
 * Смена статуса объекта: расчёт → в работе → закрыт.
 * @param {string} token
 * @param {string} id
 * @param {string} status
 * @return {Object}
 */
function setObjectStatus_(token, id, status) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const next = str_(status);
  const allowed = [CONFIG.STATUS_CALC, CONFIG.STATUS_WORK, CONFIG.STATUS_CLOSED];
  assert_(allowed.indexOf(next) !== -1, 'Неизвестный статус объекта.', 'VALIDATION');

  const current = str_(object['статус']);
  assert_(current !== next, 'Объект уже в этом статусе.', 'VALIDATION');

  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.OBJECTS, object._row, {
      'статус': next,
      'обновлён': nowIso_()
    });
    logVisit_(session.name, session.role, 'статус объекта «' + objectView_(object).title + '» → ' + next, {});
    return { ok: true, object: objectView_(requireObject_(id), true) };
  });
}

/* --------------------------------------------------------------------------
 * Итоги
 * ------------------------------------------------------------------------ */

/**
 * Пересчёт часов по журналу дней и запись в карточку.
 * @param {Object} object
 * @return {number} сумма часов
 */
function recalcHours_(object) {
  const sheetName = str_(object['лист']);
  if (!sheetName) return 0;
  const days = readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY);
  const hours = round2_(days.reduce(function (acc, row) {
    return acc + num_(row['часы'], 0);
  }, 0));
  updateRow_(CONFIG.SHEETS.OBJECTS, object._row, { 'часы': hours });
  return hours;
}

/**
 * Пересчёт суммы закупок и запись в карточку.
 * @param {Object} object
 * @return {number} сумма закупок
 */
function recalcPurchases_(object) {
  const sheetName = str_(object['лист']);
  if (!sheetName) return 0;
  const items = readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE);
  const sum = round2_(items.reduce(function (acc, row) {
    return acc + num_(row['сумма'], 0);
  }, 0));
  updateRow_(CONFIG.SHEETS.OBJECTS, object._row, { 'итог закупок': sum });
  return sum;
}

/**
 * Удаление ошибочно созданного объекта.
 * Ничего не пропадает: лист объекта переезжает в таблицу-корзину на Диске,
 * и только после этого объект убирается из реестра. Доступно только
 * руководителю и только для объекта в статусе «расчёт».
 * @param {string} token
 * @param {string} id
 * @return {Object}
 */
function removeObject_(token, id) {
  const leader = requireLeader_(token);
  const object = requireObject_(id);
  const view = objectView_(object);

  assert_(view.status === CONFIG.STATUS_CALC,
    'Убрать можно только объект в статусе «расчёт». Сначала закройте работы.', 'VALIDATION');

  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  return withLock_(function () {
    const trash = trashSpreadsheet_();
    const movedTo = moveSheetTo_(sheetName, trash);
    deleteRow_(CONFIG.SHEETS.OBJECTS, object._row);

    logVisit_(leader.name, leader.role, 'убрал объект ' + view.title + ' (лист в корзине)', {});

    return {
      ok: true,
      movedTo: movedTo,
      trash: trash.getName(),
      message: 'Объект убран из приложения. Его лист сохранён в таблице «' + trash.getName() + '» на Диске.'
    };
  });
}
