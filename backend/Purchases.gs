/**
 * ============================================================================
 * Модуль: Purchases
 * Ответственность: закупки объекта — материал, количество, цена, комментарий
 *                  и фото накладной. Сумма строки считается на сервере.
 * Зависимости: Config, Utils, Sheets, Objects, Sessions
 * ============================================================================
 */

/**
 * Список закупок объекта.
 * @param {string} token
 * @param {string} id
 * @return {Object} { purchases, total, sum }
 */
function purchasesList_(token, id) {
  requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  const items = sheetName
    ? withObjectSheet_(object, function () {
      return readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE);
    }).map(purchaseView_)
    : [];

  // Свежие записи — сверху.
  items.sort(function (a, b) {
    if (a.date === b.date) return String(a.created) < String(b.created) ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });

  const sum = round2_(items.reduce(function (acc, item) { return acc + num_(item.sum, 0); }, 0));

  // Наценка на материал — свойство объекта, но экрану закупок она нужна
  // вместе со списком, чтобы не делать второй запрос.
  const markupSum = markupSumOf_(object);
  return {
    purchases: items,
    total: items.length,
    sum: sum,
    markup: bool_(object['наценка']),
    markupSum: markupSum,
    withMarkup: round2_(sum + markupSum)
  };
}

/**
 * Разбор фотографий накладной из запроса.
 *
 * Поддерживаем и список (`photos`), и одиночное фото (`photo`) — так старые
 * записи из очереди на телефоне отправляются без ошибок.
 *
 * @param {Object} p — полезная нагрузка закупки
 * @return {{links: Array<string>, ids: Array<string>}}
 */
function purchasePhotos_(p) {
  const list = Array.isArray(p.photos) && p.photos.length ? p.photos : null;
  const links = [];
  const ids = [];

  if (list) {
    list.forEach(function (item) {
      const link = str_(typeof item === 'string' ? item : item && item.link);
      if (!link) return;
      links.push(link);
      ids.push(str_(typeof item === 'string' ? '' : item && item.id));
    });
  } else if (str_(p.photo)) {
    links.push(str_(p.photo));
    ids.push(str_(p.photoId));
  }

  return { links: links, ids: ids };
}

/**
 * Добавление закупки.
 * @param {string} token
 * @param {string} id — объект
 * @param {Object} purchase — { date, material, qty, unit, price, comment,
 *                              photos: [{link, id}] | photo, photoId }
 * @return {Object} { ok, purchase }
 */
function addPurchase_(token, id, purchase) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  const p = purchase || {};
  const record = purchaseRecord_(p);

  return withLock_(function () {
    withObjectSheet_(object, function () {
      appendBlockRow_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE, OBJECT_HEADERS[CONFIG.OBJECT_BLOCKS.PURCHASE], record);
    });
    recalcPurchases_(object);
    applyMarkup_(object, p.markup);

    logVisit_(session.name, session.role,
      'закупка по объекту ' + objectView_(object).title + ': ' + record['материал'], {});

    return { ok: true, purchase: purchaseView_(record) };
  });
}

/**
 * Добавление сразу нескольких закупок одной операцией.
 *
 * За один заход в магазин человек вносит несколько наименований. Отправлять
 * их по одной — это столько же запросов и столько же пересчётов листа,
 * поэтому здесь всё идёт под одним замком: быстрее и без «половины» записи.
 *
 * @param {string} token
 * @param {string} id — объект
 * @param {Array<Object>} items — [{ purchase }]
 * @param {boolean=} markup — включить наценку на материал
 * @return {Object} { ok, purchases }
 */
function addPurchasesBatch_(token, id, items, markup) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  const list = Array.isArray(items) ? items : [];
  assert_(list.length, 'Нет ни одной закупки для записи.', 'VALIDATION');

  // Сначала проверяем всё: если хоть одна строка с ошибкой, не пишем ничего.
  const records = list.map(function (item) {
    return purchaseRecord_((item && item.purchase) || item || {});
  });

  return withLock_(function () {
    withObjectSheet_(object, function () {
      records.forEach(function (record) {
        appendBlockRow_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE, OBJECT_HEADERS[CONFIG.OBJECT_BLOCKS.PURCHASE], record);
      });
    });
    recalcPurchases_(object);
    applyMarkup_(object, markup);

    logVisit_(session.name, session.role,
      'закупки по объекту ' + objectView_(object).title + ': ' + records.length + ' шт.', {});

    return {
      ok: true,
      purchases: records.map(purchaseView_)
    };
  });
}

/**
 * Запись закупки из полезной нагрузки: проверка и сборка строки.
 * @param {Object} p
 * @return {Object} строка для листа
 */
function purchaseRecord_(p) {
  const material = truncate_(p.material, 200);
  const qty = num_(p.qty, 0);
  const price = round2_(num_(p.price, 0));

  assert_(material, 'Укажите материал или товар.', 'VALIDATION');
  assert_(qty > 0, 'Количество должно быть больше нуля.', 'VALIDATION');
  assert_(price >= 0, 'Цена не может быть отрицательной.', 'VALIDATION');

  const photos = purchasePhotos_(p);

  return {
    'id': uid_('B'),
    'дата': isoDate_(p.date) || todayIso_(),
    'материал': material,
    'количество': qty,
    'единица': truncate_(p.unit, 20),
    'цена': price,
    'сумма': round2_(qty * price),
    'комментарий': truncate_(p.comment, 500),
    // Несколько накладных помещаются в одну ячейку списком ссылок.
    'фото': truncate_(joinCellList_(photos.links), 2000),
    'фото id': truncate_(joinCellList_(photos.ids), 2000),
    'создано': nowIso_()
  };
}

/**
 * Наценка на материал по объекту: включить или обнулить.
 * Если в запросе флага нет — ничего не меняем.
 * @param {Object} object
 * @param {boolean|undefined} markup
 */
function applyMarkup_(object, markup) {
  if (markup === undefined || markup === null) return;
  updateRow_(CONFIG.SHEETS.OBJECTS, object._row, {
    'наценка': markup ? 'да' : ''
  });
}

/**
 * Удаление закупки.
 * Фото при этом не удаляем: файл остаётся на Диске, чтобы случайно
 * не потерять накладную. Запись уходит из листа, файл — нет.
 * @param {string} token
 * @param {string} id
 * @param {string} rowId
 * @return {Object}
 */
function removePurchase_(token, id, rowId) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  const key = str_(rowId);
  assert_(key, 'Не указана закупка.', 'VALIDATION');

  return withLock_(function () {
    const rows = withObjectSheet_(object, function () {
      return readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE);
    });
    const target = rows.filter(function (row) { return str_(row['id']) === key; })[0];
    assert_(target, 'Закупка не найдена.', 'NOT_FOUND');

    withObjectSheet_(object, function () {
      deleteBlockRow_(sheetName, target._row);
    });
    recalcPurchases_(object);

    logVisit_(session.name, session.role, 'удалил закупку по объекту ' + objectView_(object).title, {});
    return { ok: true, photoKept: str_(target['фото id']) !== '' };
  });
}
