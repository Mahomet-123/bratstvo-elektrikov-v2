/**
 * ============================================================================
 * Модуль: Seed
 * Ответственность: первичная инициализация таблицы — создание листов-реестров,
 *                  51 профиля бригады и 204 позиций прайса. Операция безопасна
 *                  для повторного запуска: уже созданное не перезаписывается.
 * Зависимости: Config, Utils, Sheets, Users, Sessions, SeedData
 * ============================================================================
 */

// Сколько мастеров создаётся при инициализации (мастера 1…50).
const SEED_MASTERS_ = 50;

/**
 * Что уже создано и что ещё нужно создать.
 * @return {Object}
 */
function setupStatus_() {
  const ss = ss_();
  const present = {};
  ss.getSheets().forEach(function (sh) { present[sh.getName()] = sh.getLastRow(); });

  const required = [
    CONFIG.SHEETS.PRICES,
    CONFIG.SHEETS.USERS,
    CONFIG.SHEETS.CODES,
    CONFIG.SHEETS.OBJECTS,
    CONFIG.SHEETS.VISITS,
    CONFIG.SHEETS.STATUSES
  ];

  const users = present[CONFIG.SHEETS.USERS] ? readRows_(CONFIG.SHEETS.USERS).length : 0;
  const prices = present[CONFIG.SHEETS.PRICES] ? readRows_(CONFIG.SHEETS.PRICES).length : 0;

  return {
    spreadsheet: ss.getName(),
    sheetsPresent: Object.keys(present),
    sheetsMissing: required.filter(function (n) { return !(n in present); }),
    users: users,
    prices: prices,
    usersExpected: SEED_MASTERS_ + 1,
    pricesExpected: (PRICE_SEED_.items || []).length,
    initialized: required.every(function (n) { return n in present; }) && users > 0 && prices > 0,
    bootstrapAllowed: users === 0
  };
}

/**
 * Инициализация таблицы. Можно запускать повторно — данные не дублируются.
 * @return {Object} отчёт
 */
function setupInit_() {
  return withLock_(function () {
    const report = { steps: [], time: nowIso_() };

    // 1. Листы-реестры по схеме из Config.
    const created = [];
    const updated = [];
    const extended = [];
    Object.keys(SCHEMA).forEach(function (name) {
      const existed = !!sheetByName_(name);
      const result = ensureSchema_(name);
      if (!existed && result === 'создан') created.push(name);
      if (result === 'обновлена') updated.push(name);
      if (result === 'дополнена') extended.push(name);
    });
    report.steps.push({
      'листы созданы': created,
      'шапки обновлены': updated,
      'шапки дополнены новыми колонками': extended,
      'всего листов в схеме': Object.keys(SCHEMA).length
    });

    // 2. Текстовый формат для колонок с кодами и телефонами —
    //    иначе Google Таблицы превратят «0000» в число 0.
    applyTextFormat_(CONFIG.SHEETS.USERS, ['код', 'телефон']);
    applyTextFormat_(CONFIG.SHEETS.CODES, ['код']);

    // 3. Профили бригады.
    const usersBefore = readRows_(CONFIG.SHEETS.USERS).length;
    let usersAdded = 0;
    if (usersBefore === 0) {
      usersAdded = seedUsers_();
    }
    report.steps.push({ 'профилей добавлено': usersAdded, 'профилей всего': readRows_(CONFIG.SHEETS.USERS).length });

    // 4. Прайс.
    const pricesBefore = readRows_(CONFIG.SHEETS.PRICES).length;
    let pricesAdded = 0;
    if (pricesBefore === 0) {
      pricesAdded = seedPrices_();
    }
    report.steps.push({ 'позиций прайса добавлено': pricesAdded, 'позиций всего': readRows_(CONFIG.SHEETS.PRICES).length });

    // 5. Лист с кодами доступа для руководителя.
    const codes = syncCodesSheet_();
    report.steps.push({ 'лист «Коды доступа»': codes + ' записей' });

    // 6. Пустой служебный «Лист1» превращаем в инструкцию, а не удаляем.
    report.steps.push({ 'лист-инструкция': writeInstructionSheet_() });

    // 7. Уборка просроченных сессий.
    report.steps.push({ 'просроченных сессий удалено': cleanupSessions_() });

    report.итог = 'таблица готова к работе';
    return report;
  });
}

/**
 * Профили: руководитель и мастера 1…50 с уникальными кодами.
 * @return {number} сколько профилей создано
 */
function seedUsers_() {
  const rows = [];
  const stamp = nowIso_();
  const used = {};

  // Руководитель — код 0000, требуется сменить при первом входе.
  used[normCode_(CONFIG.LEADER_DEFAULT_CODE)] = true;
  rows.push({
    'id': 'U-LEADER',
    'имя': CONFIG.LEADER_NAME,
    'код': normCode_(CONFIG.LEADER_DEFAULT_CODE),
    'роль': CONFIG.ROLE_LEADER,
    'активен': 'да',
    'телефон': '',
    'создан': stamp,
    'изменён': stamp
  });

  // Мастера 1…50 — каждому свой случайный код.
  for (let i = 1; i <= SEED_MASTERS_; i++) {
    let code = '';
    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidate = randomDigits_(CONFIG.CODE_LENGTH);
      if (!used[candidate]) { code = candidate; break; }
    }
    if (!code) code = pad_(i, CONFIG.CODE_LENGTH); // крайне маловероятный запасной путь
    used[code] = true;

    rows.push({
      'id': 'U-' + pad_(i, 2),
      'имя': CONFIG.MASTER_NAME_PREFIX + i,
      'код': code,
      'роль': CONFIG.ROLE_MASTER,
      'активен': 'да',
      'телефон': '',
      'создан': stamp,
      'изменён': stamp
    });
  }

  appendRows_(CONFIG.SHEETS.USERS, rows);
  return rows.length;
}

/**
 * Позиции прайса из сгенерированного модуля SeedData.
 * @return {number} сколько позиций записано
 */
function seedPrices_() {
  const items = PRICE_SEED_.items || [];
  if (!items.length) {
    logError_('Seed.seedPrices_', 'Пустой прайс в SeedData', {});
    return 0;
  }
  const stamp = nowIso_();
  const rows = items.map(function (item) {
    return {
      'раздел': item.section,
      'номер': item.n,
      'наименование': item.name,
      'единица': item.unit,
      'цена': item.price,
      'от': item.from ? 'да' : '',
      'коэф': '',
      'обновлено': stamp
    };
  });
  appendRows_(CONFIG.SHEETS.PRICES, rows);
  return rows.length;
}

/**
 * Установка текстового формата для указанных колонок листа.
 * @param {string} sheetName
 * @param {Array<string>} columns
 */
function applyTextFormat_(sheetName, columns) {
  const sh = sheetByName_(sheetName);
  if (!sh) return;
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return;
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  columns.forEach(function (name) {
    const idx = header.indexOf(name);
    if (idx === -1) return;
    sh.getRange(2, idx + 1, rows, 1).setNumberFormat('@');
  });
}

/**
 * Пустой «Лист1» из новой таблицы превращаем в короткую инструкцию.
 * Ничего не удаляем — переиспользуем существующий лист.
 * @return {string} результат
 */
function writeInstructionSheet_() {
  const ss = ss_();
  const first = ss.getSheets()[0];
  if (!first) return 'нет листа';
  if (first.getLastRow() > 0) return 'служебный лист уже заполнен';
  if (Object.keys(SCHEMA).indexOf(first.getName()) !== -1) return 'служебный лист занят данными';

  first.setName('Инструкция');
  const text = [
    ['Братство Электриков — база данных приложения', ''],
    ['', ''],
    ['Лист', 'Назначение'],
    ['Прайс', 'Все 204 позиции: 194 работы, 6 коэффициентов, 2 наценки, 2 примечания'],
    ['Пользователи', 'Руководитель и мастера 1…50. Вход в приложение — имя + код'],
    ['Коды доступа', 'Служебный лист для руководителя: кто есть кто и с каким кодом'],
    ['Объекты', 'Реестр объектов: клиент, адрес, статус, токен кабинета клиента'],
    ['Посещения', 'Журнал входов и действий — заполняется приложением автоматически'],
    ['Статусы', 'Состояние очереди отправки у каждого мастера'],
    ['Журнал ошибок', 'Сбои бэкенда — заполняется приложением автоматически'],
    ['NNN_Имя объекта', 'Личный лист объекта с блоками РАСЧЁТ / ДЕНЬ / ЗАКУПКА'],
    ['', ''],
    ['Важно', 'Руководитель входит под кодом 0000 — смените его в приложении сразу после первого входа'],
    ['Важно', 'Коды мастеров выдаёт руководитель в разделе «Бригада»'],
    ['Важно', 'Этот лист создан приложением и не используется в работе — можно переименовать']
  ];
  first.getRange(1, 1, text.length, 2).setValues(text);
  first.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  first.getRange(3, 1, 1, 2).setFontWeight('bold').setBackground('#eef2f7');
  first.setColumnWidth(1, 220);
  first.setColumnWidth(2, 520);
  return 'лист «Инструкция» создан';
}
