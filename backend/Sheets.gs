/**
 * ============================================================================
 * Модуль: Sheets
 * Ответственность: низкоуровневый доступ к Google Таблице — открытие файла,
 *                  чтение и запись строк, работа с блоками листов объектов.
 *                  Не знает о предметной области (объекты, прайс и т. п.).
 * Зависимости: Config, Utils
 * ============================================================================
 */

// Кэш в пределах одного выполнения — таблица открывается один раз на запрос.
let SS_CACHE_ = null;

/* --------------------------------------------------------------------------
 * Открытие и служебные операции
 * ------------------------------------------------------------------------ */

/**
 * Рабочая таблица (БД приложения).
 * @return {Spreadsheet}
 */
function ss_() {
  if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return SS_CACHE_;
}

/**
 * Лист по имени.
 * @param {string} name
 * @return {Sheet|null}
 */
function sheetByName_(name) {
  return ss_().getSheetByName(name) || null;
}

/**
 * Лист по имени или понятная ошибка.
 * @param {string} name
 * @return {Sheet}
 */
function requireSheet_(name) {
  const sh = sheetByName_(name);
  assert_(sh, 'Лист «' + name + '» не найден. Запустите инициализацию таблицы.', 'NOT_FOUND');
  return sh;
}

/**
 * Создать лист, если его нет; при создании записать строку заголовков.
 * @param {string} name
 * @param {Array<string>} header
 * @return {Sheet}
 */
function ensureSheet_(name, header) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (header && header.length) {
      sh.getRange(1, 1, 1, header.length).setValues([header]);
      sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef2f7');
      sh.setFrozenRows(1);
    }
    return sh;
  }
  // Лист есть, но пустой — допишем заголовок.
  if (header && header.length && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef2f7');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Удалить лист, если он существует и не последний.
 * @param {string} name
 * @return {boolean}
 */
function dropSheet_(name) {
  const ss = ss_();
  const sh = ss.getSheetByName(name);
  if (!sh) return false;
  if (ss.getSheets().length <= 1) return false;
  ss.deleteSheet(sh);
  return true;
}

/* --------------------------------------------------------------------------
 * Чтение реестров (таблиц «заголовок + строки»)
 * ------------------------------------------------------------------------ */

/**
 * Чтение листа-реестра в виде массива объектов.
 * Каждый объект дополнительно содержит служебное поле `_row` — номер строки
 * в таблице (для последующего обновления или удаления).
 * @param {string} name — имя листа
 * @return {{header: Array<string>, rows: Array<Object>}}
 */
function readTable_(name) {
  const sh = sheetByName_(name);
  if (!sh) return { header: [], rows: [] };
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { header: [], rows: [] };

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const header = values[0].map(function (h) { return str_(h); });
  const rows = [];

  for (let r = 1; r < values.length; r++) {
    const line = values[r];
    // Полностью пустые строки пропускаем.
    const isEmpty = line.every(function (c) { return str_(c) === ''; });
    if (isEmpty) continue;
    const obj = { _row: r + 1 };
    for (let c = 0; c < header.length; c++) {
      if (header[c]) obj[header[c]] = line[c];
    }
    rows.push(obj);
  }
  return { header: header, rows: rows };
}

/**
 * Только строки реестра (без заголовка).
 * @param {string} name
 * @return {Array<Object>}
 */
function readRows_(name) {
  return readTable_(name).rows;
}

/**
 * Поиск строк реестра по условию.
 * @param {string} name
 * @param {Function} predicate — (obj) => boolean
 * @return {Array<Object>}
 */
function findRows_(name, predicate) {
  return readRows_(name).filter(predicate);
}

/**
 * Первая подходящая строка реестра.
 * @param {string} name
 * @param {Function} predicate
 * @return {Object|null}
 */
function findRow_(name, predicate) {
  const rows = readRows_(name);
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) return rows[i];
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Запись в реестры
 * ------------------------------------------------------------------------ */

/**
 * Преобразование объекта в массив значений по заголовку листа.
 * @param {Array<string>} header
 * @param {Object} obj
 * @return {Array<*>}
 */
function toRowValues_(header, obj) {
  return header.map(function (key) {
    const v = obj ? obj[key] : '';
    return v === undefined || v === null ? '' : v;
  });
}

/**
 * Добавление строки в реестр. Лист создаётся при необходимости.
 * @param {string} name
 * @param {Object} obj
 * @return {number} номер добавленной строки
 */
function appendRowSafe_(name, obj) {
  const header = SCHEMA[name];
  const sh = ensureSheet_(name, header);
  const cols = Math.max(sh.getLastColumn(), (header || []).length, 1);
  const keys = header && header.length ? header : sh.getRange(1, 1, 1, cols).getValues()[0].map(str_);
  sh.appendRow(toRowValues_(keys, obj));
  return sh.getLastRow();
}

/**
 * Добавление нескольких строк одной операцией (быстрее, чем по одной).
 * @param {string} name
 * @param {Array<Object>} objs
 * @return {number} сколько строк добавлено
 */
function appendRows_(name, objs) {
  const list = objs || [];
  if (!list.length) return 0;
  const header = SCHEMA[name];
  const sh = ensureSheet_(name, header);
  const keys = header && header.length ? header : sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(str_);
  const values = list.map(function (o) { return toRowValues_(keys, o); });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, keys.length).setValues(values);
  return values.length;
}

/**
 * Обновление строки реестра по номеру строки.
 * @param {string} name
 * @param {number} rowNumber
 * @param {Object} patch — поля для замены
 * @return {boolean}
 */
function updateRow_(name, rowNumber, patch) {
  const sh = requireSheet_(name);
  const cols = sh.getLastColumn();
  const keys = sh.getRange(1, 1, 1, cols).getValues()[0].map(str_);
  const current = sh.getRange(rowNumber, 1, 1, cols).getValues()[0];
  const next = keys.map(function (key, i) {
    return Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : current[i];
  });
  sh.getRange(rowNumber, 1, 1, cols).setValues([next]);
  return true;
}

/**
 * Удаление строки реестра.
 * @param {string} name
 * @param {number} rowNumber
 * @return {boolean}
 */
function deleteRow_(name, rowNumber) {
  const sh = sheetByName_(name);
  if (!sh) return false;
  sh.deleteRow(rowNumber);
  return true;
}

/**
 * Полная замена содержимого реестра (заголовок + строки).
 * Используется инициализацией и восстановлением из архива.
 * @param {string} name
 * @param {Array<string>} header
 * @param {Array<Array<*>>} rows — массивы значений
 */
function replaceTable_(name, header, rows) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  const data = [header].concat(rows || []);
  sh.getRange(1, 1, data.length, header.length).setValues(data);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef2f7');
  sh.setFrozenRows(1);
}

/* --------------------------------------------------------------------------
 * Блоки внутри листа объекта («РАСЧЁТ» / «ДЕНЬ» / «ЗАКУПКА»)
 * ------------------------------------------------------------------------ */

/**
 * Разбор листа объекта: находит строки-маркеры блоков и заголовки внутри них.
 * Структура листа:
 *   [маркер блока]  [заголовок блока]  [данные…]  (пустая строка)  [следующий блок]
 * @param {string} sheetName
 * @return {Object} карта: имя блока → {markerRow, headerRow, header, firstRow, lastRow}
 */
function parseBlocks_(sheetName) {
  const sh = sheetByName_(sheetName);
  if (!sh) return {};
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), 1);
  if (lastRow < 1) return {};

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const known = Object.keys(CONFIG.OBJECT_BLOCKS).map(function (k) {
    return CONFIG.OBJECT_BLOCKS[k];
  });

  const marks = [];
  for (let r = 0; r < values.length; r++) {
    const first = str_(values[r][0]).toUpperCase();
    if (known.indexOf(first) !== -1) {
      marks.push({ name: first, markerRow: r + 1, index: r });
    }
  }

  const blocks = {};
  marks.forEach(function (mark, i) {
    const next = marks[i + 1];
    const stopIndex = next ? next.index : values.length;
    const headerIndex = mark.index + 1;
    if (headerIndex >= stopIndex) {
      blocks[mark.name] = { markerRow: mark.markerRow, headerRow: 0, header: [], firstRow: 0, lastRow: 0 };
      return;
    }
    const header = values[headerIndex].map(str_);
    // Данные идут до первой полностью пустой строки или до следующего блока.
    let endIndex = headerIndex;
    for (let r = headerIndex + 1; r < stopIndex; r++) {
      const isEmpty = values[r].every(function (c) { return str_(c) === ''; });
      if (isEmpty) break;
      endIndex = r;
    }
    blocks[mark.name] = {
      markerRow: mark.markerRow,
      headerRow: headerIndex + 1,
      header: header,
      firstRow: headerIndex + 2,
      lastRow: endIndex + 1
    };
  });
  return blocks;
}

/**
 * Чтение блока листа объекта как массива объектов (со служебным `_row`).
 * @param {string} sheetName
 * @param {string} blockName — CONFIG.OBJECT_BLOCKS.*
 * @return {Array<Object>}
 */
function readBlock_(sheetName, blockName) {
  const sh = sheetByName_(sheetName);
  if (!sh) return [];
  const block = parseBlocks_(sheetName)[blockName];
  if (!block || !block.headerRow || block.lastRow < block.firstRow) return [];

  const numRows = block.lastRow - block.firstRow + 1;
  const values = sh.getRange(block.firstRow, 1, numRows, block.header.length).getValues();
  return values.map(function (line, i) {
    const obj = { _row: block.firstRow + i };
    block.header.forEach(function (key, c) {
      if (key) obj[key] = line[c];
    });
    return obj;
  }).filter(function (o) {
    return block.header.some(function (k) { return k && str_(o[k]) !== ''; });
  });
}

/**
 * Строка занята маркером какого-нибудь блока листа объекта?
 * Признак «слипшейся» разметки: у пустого блока нет собственных строк данных,
 * и запись без проверки попадает прямо в маркер следующего блока.
 * @param {Sheet} sh
 * @param {number} row
 * @return {boolean}
 */
function isMarkerRow_(sh, row) {
  if (!sh || !row || row < 1) return false;
  const value = str_(sh.getRange(row, 1).getValue()).toUpperCase();
  if (!value) return false;
  return Object.keys(CONFIG.OBJECT_BLOCKS).some(function (key) {
    return CONFIG.OBJECT_BLOCKS[key] === value;
  });
}

/**
 * Создание блока в листе объекта, если его ещё нет.
 * Новый блок всегда отделяется пустой строкой: иначе следующий блок
 * «прилипает» к данным предыдущего и разбор структуры листа путается.
 * @param {string} sheetName
 * @param {string} blockName
 * @param {Array<string>} header
 * @return {Object} описание блока
 */
function ensureBlock_(sheetName, blockName, header) {
  const ss = ss_();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  const blocks = parseBlocks_(sheetName);
  if (blocks[blockName]) return blocks[blockName];

  const lastRow = sh.getLastRow();
  const startRow = lastRow === 0 ? 1 : lastRow + 2;

  sh.getRange(startRow, 1).setValue(blockName).setFontWeight('bold').setBackground('#dfe7f1');
  sh.getRange(startRow + 1, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#eef2f7');
  return parseBlocks_(sheetName)[blockName];
}

/**
 * Добавление строки в блок листа объекта.
 * @param {string} sheetName
 * @param {string} blockName
 * @param {Array<string>} header
 * @param {Object} obj
 * @return {number} номер строки
 */
function appendBlockRow_(sheetName, blockName, header, obj) {
  const sh = sheetByName_(sheetName);
  let block = ensureBlock_(sheetName, blockName, header);
  let target = block.lastRow >= block.firstRow ? block.lastRow + 1 : block.firstRow;

  // Разметка могла слипнуться (лист создан старой версией приложения):
  // вставляем пустую строку и пересчитываем блок, чтобы не затереть чужую шапку.
  if (isMarkerRow_(sh, target)) {
    sh.insertRowBefore(target);
    block = parseBlocks_(sheetName)[blockName];
    target = block.lastRow >= block.firstRow ? block.lastRow + 1 : block.firstRow;
  }

  sh.getRange(target, 1, 1, header.length).setValues([toRowValues_(header, obj)]);
  return target;
}

/**
 * Полная перезапись данных блока (заголовок сохраняется).
 * @param {string} sheetName
 * @param {string} blockName
 * @param {Array<string>} header
 * @param {Array<Object>} objs
 */
function replaceBlock_(sheetName, blockName, header, objs) {
  const sh = sheetByName_(sheetName);
  let block = ensureBlock_(sheetName, blockName, header);
  const values = (objs || []).map(function (o) { return toRowValues_(header, o); });

  if (values.length && isMarkerRow_(sh, block.firstRow)) {
    sh.insertRowBefore(block.firstRow);
    block = parseBlocks_(sheetName)[blockName];
  }

  const oldCount = Math.max(0, block.lastRow - block.firstRow + 1);

  if (values.length) {
    sh.getRange(block.firstRow, 1, values.length, header.length).setValues(values);
  }
  // Остатки прежних данных затираем, чтобы не тянулись «хвосты».
  if (oldCount > values.length) {
    sh.getRange(block.firstRow + values.length, 1, oldCount - values.length, header.length)
      .clearContent();
  }
}

/**
 * Удаление строки блока.
 * @param {string} sheetName
 * @param {number} rowNumber
 * @return {boolean}
 */
function deleteBlockRow_(sheetName, rowNumber) {
  const sh = sheetByName_(sheetName);
  if (!sh || !rowNumber) return false;
  sh.deleteRow(rowNumber);
  return true;
}

/**
 * Приведение шапки листа к актуальной схеме.
 * Если лист пуст — шапка перезаписывается. Если данные есть, лист не трогаем:
 * лучше предупредить, чем потерять чужие записи. Исключение — дополнение
 * шапки новыми колонками справа: это безопасно, старые данные не сдвигаются.
 * @param {string} name — имя листа из SCHEMA
 * @return {string} 'ок' | 'создан' | 'обновлена' | 'дополнена' | 'данные есть, шапка не тронута' | 'нет схемы'
 */
function ensureSchema_(name) {
  const header = SCHEMA[name];
  if (!header || !header.length) return 'нет схемы';

  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    writeHeader_(sh, header);
    return 'создан';
  }

  const lastCol = Math.max(sh.getLastColumn(), 1);
  const current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
  const same = current.length === header.length &&
    header.every(function (key, index) { return current[index] === key; });
  if (same) return 'ок';

  // Дополнение справа: старая шапка — начало новой, добавляются только новые
  // колонки. Данные не сдвигаются, поэтому это безопасно даже при наличии строк.
  const isExtension = current.length < header.length &&
    current.every(function (key, index) { return key === header[index]; });
  if (isExtension) {
    sh.getRange(1, current.length + 1, 1, header.length - current.length)
      .setValues([header.slice(current.length)])
      .setFontWeight('bold').setBackground('#eef2f7');
    return 'дополнена';
  }

  if (sh.getLastRow() > 1) {
    logError_('Sheets.ensureSchema_', 'Шапка листа «' + name + '» отличается от схемы, но в листе есть данные', {
      текущая: current,
      ожидаемая: header
    });
    return 'данные есть, шапка не тронута';
  }

  writeHeader_(sh, header);
  // Лишние колонки старой шапки очищаем, чтобы не путали.
  if (current.length > header.length) {
    sh.getRange(1, header.length + 1, 1, current.length - header.length).clearContent();
  }
  return 'обновлена';
}

/**
 * Запись строки заголовков с оформлением.
 * @param {Sheet} sh
 * @param {Array<string>} header
 */
function writeHeader_(sh, header) {
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef2f7');
  sh.setFrozenRows(1);
}

/**
 * Перенос листа между таблицами: сначала копия, потом удаление оригинала.
 * Используется для корзины и архива — данные не пропадают, а переезжают.
 *
 * Копия обязательно проверяется: если она не оказалась в целевой таблице,
 * оригинал не удаляем. Потерять лист объекта молча — худшее из возможного.
 *
 * @param {Spreadsheet} sourceSs — откуда
 * @param {Spreadsheet} targetSs — куда
 * @param {string} sheetName
 * @return {string} имя листа в целевой таблице (может отличаться от исходного)
 */
function moveSheetBetween_(sourceSs, targetSs, sheetName) {
  assert_(sourceSs && targetSs, 'Не указана таблица для переноса листа.', 'VALIDATION');

  const sh = sourceSs.getSheetByName(sheetName);
  assert_(sh, 'Лист «' + sheetName + '» не найден.', 'NOT_FOUND');
  assert_(sourceSs.getSheets().length > 1, 'Нельзя перенести единственный лист таблицы.', 'VALIDATION');

  const copy = sh.copyTo(targetSs);
  assert_(copy && copy.getParent() && copy.getParent().getId() === targetSs.getId(),
    'Не удалось перенести лист «' + sheetName + '» в таблицу «' + targetSs.getName() + '».', 'ERROR');

  sourceSs.deleteSheet(sh);
  return copy.getName();
}

/**
 * Перенос листа из основной таблицы в другую (корзина, архив).
 * @param {string} sheetName
 * @param {Spreadsheet} target
 * @return {string} имя листа в целевой таблице
 */
function moveSheetTo_(sheetName, target) {
  return moveSheetBetween_(ss_(), target, sheetName);
}

/**
 * Копирование листа в другую таблицу без удаления оригинала.
 * @param {string} sheetName
 * @param {Spreadsheet} target
 * @return {string}
 */
function copySheetTo_(sheetName, target) {
  const sh = requireSheet_(sheetName);
  return sh.copyTo(target).getName();
}

/* --------------------------------------------------------------------------
 * Работа с листом объекта, который может лежать в архиве
 * ------------------------------------------------------------------------ */

/**
 * Выполнение функции в контексте таблицы, где реально лежит лист объекта.
 *
 * Закрытые объекты уезжают в таблицу-архив за год («Архив 2026»), поэтому
 * обычный `readBlock_` их уже не найдёт: он смотрит в основную таблицу.
 * Здесь мы на время подменяем кэш открытой таблицы, выполняем чтение/запись
 * и возвращаем всё как было — даже если внутри произошла ошибка.
 *
 * @param {Object} object — строка листа «Объекты»
 * @param {Function} fn — что выполнить в контексте листа объекта
 * @return {*} результат fn
 */
function withObjectSheet_(object, fn) {
  const ref = str_(object && object['архив']);
  if (!ref) return fn();

  const archive = openArchiveSpreadsheet_(ref);
  // Архив недоступен (файл переименован/удалён) — работаем с основной таблицей,
  // чтобы чтение не падало целиком.
  if (!archive) return fn();

  const previous = SS_CACHE_;
  try {
    SS_CACHE_ = archive;
    return fn();
  } finally {
    SS_CACHE_ = previous;
  }
}
