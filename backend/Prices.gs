/**
 * ============================================================================
 * Модуль: Prices
 * Ответственность: прайс работ — чтение, группировка по разделам, поиск,
 *                  правка цены руководителем.
 * Зависимости: Config, Utils, Sheets, Sessions
 * ============================================================================
 */

// Разделы прайса — ровно те, что размечены в исходном PDF (①…⑧), всего 8.
const PRICE_SECTIONS_ = [
  'Монтажные работы',
  'Черновые работы',
  'Установка щитов',
  'Чистовая установка',
  'Дополнительные работы',
  'Умный дом и IoT',
  'Коэффициенты и особые условия',
  'Примечания'
];

/**
 * Раздел позиции — берётся из колонки «раздел» как есть.
 * @param {Object} row — строка листа «Прайс»
 * @return {string}
 */
function uiSectionOf_(row) {
  return str_(row['раздел']) || 'Прочее';
}

/**
 * Признак служебной позиции: коэффициенты, проценты и примечания не являются
 * работами — их нельзя добавить в расчёт как обычную строку.
 * @param {Object} item
 * @return {boolean}
 */
function isServiceItem_(item) {
  return item.kind !== 'work';
}

/**
 * Тип позиции прайса.
 * @param {Object} row
 * @return {string} work | coeff | percent | note
 */
function kindOf_(row) {
  const unit = str_(row['единица']).toLowerCase();
  const section = str_(row['раздел']);
  if (unit.indexOf('коэф') === 0) return 'coeff';
  if (unit === '%') return 'percent';
  if (section === 'Примечания' || !unit) return 'note';
  return 'work';
}

/**
 * Позиция прайса в представлении клиента.
 * @param {Object} row
 * @return {Object}
 */
function priceView_(row) {
  const n = int_(row['номер'], 0);
  return {
    id: 'P' + n,
    section: uiSectionOf_(row),
    rawSection: str_(row['раздел']),
    n: n,
    name: str_(row['наименование']),
    unit: str_(row['единица']),
    price: round2_(num_(row['цена'], 0)),
    from: bool_(row['от']),
    coeff: num_(row['коэф'], 0) || null,
    kind: kindOf_(row),
    updated: str_(row['обновлено'])
  };
}

/**
 * Полный прайс, сгруппированный по разделам в фиксированном порядке.
 * @return {Object} { sections: [{ name, items, count }], total, updated }
 */
function listPrices_() {
  const rows = readRows_(CONFIG.SHEETS.PRICES);
  const items = rows.map(priceView_);

  const groups = {};
  items.forEach(function (item) {
    const key = item.section;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  // Сортировка позиций внутри раздела — по номеру.
  Object.keys(groups).forEach(function (k) {
    groups[k].sort(function (a, b) { return a.n - b.n; });
  });

  const known = PRICE_SECTIONS_.filter(function (name) { return groups[name]; });
  const extra = Object.keys(groups).filter(function (name) {
    return PRICE_SECTIONS_.indexOf(name) === -1;
  }).sort();

  const sections = known.concat(extra).map(function (name) {
    return { name: name, items: groups[name], count: groups[name].length };
  });

  return {
    sections: sections,
    total: items.length,
    works: items.filter(function (i) { return i.kind === 'work'; }).length,
    coefficients: items.filter(function (i) { return i.kind === 'coeff'; }).map(function (i) {
      return { id: i.id, name: i.name, value: i.price, section: i.section };
    }),
    percents: items.filter(function (i) { return i.kind === 'percent'; }).map(function (i) {
      return { id: i.id, name: i.name, value: i.price, section: i.section };
    }),
    notes: items.filter(function (i) { return i.kind === 'note'; }).map(function (i) {
      return { id: i.id, text: i.name, section: i.section };
    }),
    rules: {
      supplyPercent: CONFIG.CALC.SUPPLY_PERCENT,
      supplyMin: CONFIG.CALC.SUPPLY_MIN,
      commissioningPercent: CONFIG.CALC.COMMISSIONING_PERCENT,
      maxDiscountPercent: CONFIG.CALC.MAX_DISCOUNT_PERCENT
    }
  };
}

/**
 * Поиск позиций прайса по подстроке в наименовании.
 * @param {string} query
 * @param {number=} limit
 * @return {Array<Object>}
 */
function searchPrices_(query, limit) {
  const needle = str_(query).toLowerCase();
  if (needle.length < 2) return [];
  const max = Math.min(int_(limit, 40), 200);
  const found = [];
  const rows = readRows_(CONFIG.SHEETS.PRICES);
  for (let i = 0; i < rows.length && found.length < max; i++) {
    const item = priceView_(rows[i]);
    if (item.name.toLowerCase().indexOf(needle) !== -1) found.push(item);
  }
  return found;
}

/**
 * Одна позиция прайса по идентификатору вида «P123».
 * @param {string} id
 * @return {Object|null}
 */
function getPrice_(id) {
  const n = int_(str_(id).replace(/\D/g, ''), 0);
  if (!n) return null;
  const row = findRow_(CONFIG.SHEETS.PRICES, function (r) { return int_(r['номер'], 0) === n; });
  return row ? priceView_(row) : null;
}

/**
 * Правка цены позиции — только руководитель.
 * @param {string} token
 * @param {string} id — «P123»
 * @param {number} price
 * @return {Object}
 */
function updatePrice_(token, id, price) {
  const leader = requireLeader_(token);
  const n = int_(str_(id).replace(/\D/g, ''), 0);
  assert_(n, 'Не указан номер позиции прайса.', 'VALIDATION');
  const value = num_(price, -1);
  assert_(value >= 0, 'Цена не может быть отрицательной.', 'VALIDATION');

  const row = findRow_(CONFIG.SHEETS.PRICES, function (r) { return int_(r['номер'], 0) === n; });
  assert_(row, 'Позиция прайса не найдена.', 'NOT_FOUND');

  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.PRICES, row._row, {
      'цена': value,
      'обновлено': nowIso_()
    });
    logVisit_(leader.name, leader.role, 'изменил цену позиции ' + n + ' → ' + value, {});
    return { ok: true, id: 'P' + n, price: value };
  });
}
