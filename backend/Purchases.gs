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
  return { purchases: items, total: items.length, sum: sum };
}

/**
 * Добавление закупки.
 * @param {string} token
 * @param {string} id — объект
 * @param {Object} purchase — { date, material, qty, unit, price, comment, photo, photoId }
 * @return {Object} { ok, purchase }
 */
function addPurchase_(token, id, purchase) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  const p = purchase || {};
  const material = truncate_(p.material, 200);
  const qty = num_(p.qty, 0);
  const price = round2_(num_(p.price, 0));

  assert_(material, 'Укажите материал или товар.', 'VALIDATION');
  assert_(qty > 0, 'Количество должно быть больше нуля.', 'VALIDATION');
  assert_(price >= 0, 'Цена не может быть отрицательной.', 'VALIDATION');

  const date = isoDate_(p.date) || todayIso_();
  const sum = round2_(qty * price);

  return withLock_(function () {
    const record = {
      'id': uid_('B'),
      'дата': date,
      'материал': material,
      'количество': qty,
      'единица': truncate_(p.unit, 20),
      'цена': price,
      'сумма': sum,
      'комментарий': truncate_(p.comment, 500),
      'фото': truncate_(p.photo, 500),
      'фото id': truncate_(p.photoId, 200),
      'создано': nowIso_()
    };

    withObjectSheet_(object, function () {
      appendBlockRow_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE, OBJECT_HEADERS[CONFIG.OBJECT_BLOCKS.PURCHASE], record);
    });
    recalcPurchases_(object);

    logVisit_(session.name, session.role,
      'закупка по объекту ' + objectView_(object).title + ': ' + material, {});

    return { ok: true, purchase: purchaseView_(record) };
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
