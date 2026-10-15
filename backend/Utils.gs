/**
 * ============================================================================
 * Модуль: Utils
 * Ответственность: общие утилиты — ответы API, работа с датами, числами,
 *                  строками, идентификаторами, блокировки и журнал ошибок.
 *                  Не знает ничего о предметной области.
 * Зависимости: Config (для журнала ошибок)
 * ============================================================================
 */

/* --------------------------------------------------------------------------
 * Ответы API
 * ------------------------------------------------------------------------ */

/**
 * Успешный ответ API.
 * @param {*} data — полезная нагрузка
 * @param {Object=} extra — дополнительные поля верхнего уровня
 * @return {TextOutput}
 */
function ok_(data, extra) {
  const body = { ok: true, data: data === undefined ? null : data, время: nowIso_() };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return jsonOut_(body);
}

/**
 * Ответ с ошибкой. Код ошибки не раскрывает внутренности, но помогает клиенту.
 * @param {string} message — текст для человека
 * @param {string=} code — машинный код (AUTH, NOT_FOUND, VALIDATION…)
 * @param {Object=} extra
 * @return {TextOutput}
 */
function fail_(message, code, extra) {
  const body = {
    ok: false,
    error: String(message || 'Неизвестная ошибка'),
    code: code || 'ERROR',
    время: nowIso_()
  };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return jsonOut_(body);
}

/**
 * Сериализация ответа. MimeType.JSON отдаёт корректный JSON,
 * при этом фронтенд читает ответ как текст и парсит сам (обход CORS-редиректов).
 * @param {Object} obj
 * @return {TextOutput}
 */
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ответ для HTML-страниц (кабинет клиента, PDF-предпросмотр).
 * @param {string} html
 * @param {Object=} params
 * @return {HtmlOutput}
 */
function htmlOut_(html, params) {
  const out = HtmlService.createHtmlOutput(html);
  out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  if (params && params.title) out.setTitle(params.title);
  return out;
}

/* --------------------------------------------------------------------------
 * Даты и время
 * ------------------------------------------------------------------------ */

/** @return {Date} текущий момент */
function now_() {
  return new Date();
}

/** @return {string} ISO-строка текущего момента (UTC) */
function nowIso_() {
  return new Date().toISOString();
}

/** @return {string} сегодняшняя дата в формате ГГГГ-ММ-ДД */
function todayIso_() {
  return isoDate_(new Date());
}

/**
 * Дата → ГГГГ-ММ-ДД (без времени).
 * @param {Date|string} value
 * @return {string}
 */
function isoDate_(value) {
  const d = toDate_(value);
  if (!d) return '';
  return d.getFullYear() + '-' + pad_(d.getMonth() + 1, 2) + '-' + pad_(d.getDate(), 2);
}

/**
 * Дата → ЧЧ:ММ.
 * @param {Date|string} value
 * @return {string}
 */
function isoTime_(value) {
  const d = toDate_(value);
  if (!d) return '';
  return pad_(d.getHours(), 2) + ':' + pad_(d.getMinutes(), 2);
}

/**
 * Аккуратный разбор даты из таблицы: Date, ISO-строка, ГГГГ-ММ-ДД, ДД.ММ.ГГГГ.
 * @param {*} value
 * @return {Date|null}
 */
function toDate_(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;

  // ГГГГ-ММ-ДД
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // ДД.ММ.ГГГГ
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Сдвиг даты на N дней.
 * @param {Date|string} value
 * @param {number} days
 * @return {Date|null}
 */
function addDays_(value, days) {
  const d = toDate_(value);
  if (!d) return null;
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + Number(days || 0));
  return out;
}

/** @return {number} год текущего момента */
function currentYear_() {
  return new Date().getFullYear();
}

/* --------------------------------------------------------------------------
 * Числа и строки
 * ------------------------------------------------------------------------ */

/**
 * Безопасное приведение к строке с обрезкой пробелов.
 * @param {*} v
 * @return {string}
 */
function str_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Безопасное приведение к числу.
 * @param {*} v
 * @param {number=} def — значение по умолчанию
 * @return {number}
 */
function num_(v, def) {
  if (v === '' || v === null || v === undefined) return def === undefined ? 0 : def;
  if (typeof v === 'number') return isNaN(v) ? (def === undefined ? 0 : def) : v;
  // «1 234,56 ₽» → 1234.56
  const s = String(v).replace(/\s|₽|руб\.?/gi, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? (def === undefined ? 0 : def) : n;
}

/**
 * Безопасное приведение к целому.
 * @param {*} v
 * @param {number=} def
 * @return {number}
 */
function int_(v, def) {
  const n = num_(v, def);
  return Math.round(n);
}

/**
 * Приведение к логическому: «да», «истина», 1, true, «+».
 * @param {*} v
 * @return {boolean}
 */
function bool_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'да' || s === 'истина' || s === 'true' || s === '1' || s === '+' || s === 'yes';
}

/**
 * Округление до копеек.
 * @param {number} n
 * @return {number}
 */
function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Дополнение числа нулями слева: 7 → «007».
 * @param {number} n
 * @param {number} len
 * @return {string}
 */
function pad_(n, len) {
  let s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

/**
 * Обрезка строки по длине.
 * @param {string} s
 * @param {number} max
 * @return {string}
 */
function truncate_(s, max) {
  const v = str_(s);
  return v.length <= max ? v : v.slice(0, max).trim();
}

/**
 * Имя, безопасное для листа Google Таблиц (≤100 символов, без \ / ? * [ ] :).
 * @param {string} s
 * @return {string}
 */
function sheetSafeName_(s) {
  return truncate_(str_(s).replace(CONFIG.SHEET_NAME_BAD_CHARS, ' ').replace(/\s+/g, ' '), 90);
}

/**
 * Разбор JSON с запасным значением — таблица может содержать что угодно.
 * @param {*} text
 * @param {*} def
 * @return {*}
 */
function jsonParse_(text, def) {
  if (text === null || text === undefined || text === '') return def;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(String(text));
  } catch (e) {
    return def;
  }
}

/* --------------------------------------------------------------------------
 * Идентификаторы и токены
 * ------------------------------------------------------------------------ */

/**
 * Уникальный идентификатор: префикс + время + случайный хвост.
 * @param {string=} prefix
 * @return {string}
 */
function uid_(prefix) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return (prefix ? str_(prefix) + '-' : '') + stamp + rnd;
}

/**
 * Случайное число из n цифр (первая цифра не ноль).
 * @param {number} len
 * @return {string}
 */
function randomDigits_(len) {
  const n = Math.max(1, int_(len, 4));
  let out = String(1 + Math.floor(Math.random() * 9));
  for (let i = 1; i < n; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

/**
 * Случайный токен из букв и цифр — для ссылки кабинета клиента.
 * @param {number} len
 * @return {string}
 */
function randomToken_(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов I/O/0/1
  const n = Math.max(4, int_(len, 10));
  let out = '';
  for (let i = 0; i < n; i++) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

/**
 * SHA-256 в hex — для хеширования токенов в таблице.
 * @param {string} s
 * @return {string}
 */
function sha256_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Прочее
 * ------------------------------------------------------------------------ */

/**
 * Проверка условия: бросает понятную ошибку, если не выполнено.
 * @param {*} condition
 * @param {string} message
 * @param {string=} code
 */
function assert_(condition, message, code) {
  if (!condition) {
    const e = new Error(message);
    e.apiCode = code || 'VALIDATION';
    throw e;
  }
}

/**
 * Выполнение операции под блокировкой — защита от одновременной записи.
 * @param {Function} fn
 * @param {number=} timeoutMs
 * @return {*}
 */
function withLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(timeoutMs || 20000);
  if (!got) {
    const e = new Error('Не удалось получить блокировку записи, попробуйте ещё раз');
    e.apiCode = 'LOCKED';
    throw e;
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Выбор подмножества полей объекта.
 * @param {Object} obj
 * @param {Array<string>} keys
 * @return {Object}
 */
function pick_(obj, keys) {
  const out = {};
  (keys || []).forEach(function (k) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  });
  return out;
}

/**
 * Сколько последних записей журнала ошибок храним.
 * Журнал нужен для разбора свежих сбоев; старые записи только раздувают лист
 * и замедляют таблицу.
 */
const LOG_KEEP_ROWS_ = 500;

/**
 * Насколько журнал может перерасти предел до обрезки.
 * Удаление строк — операция небыстрая, поэтому подчищаем пачкой, а не после
 * каждой записи: пусть накопится небольшой излишек.
 */
const LOG_TRIM_MARGIN_ = 50;

/**
 * Запись ошибки в лист «Журнал ошибок». Никогда не бросает исключение —
 * журналирование не должно ломать основной сценарий.
 * @param {string} module
 * @param {Error|string} err
 * @param {Object=} context
 */
function logError_(module, err, context) {
  try {
    const message = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? String(err.stack).split('\n').slice(0, 3).join(' | ') : '';
    appendRowSafe_(CONFIG.SHEETS.LOG, {
      'дата': nowIso_(),
      'модуль': str_(module),
      'сообщение': message,
      'контекст': JSON.stringify({ stack: stack, context: context || {} }).slice(0, 900)
    });
    trimErrorLog_();
  } catch (e) {
    // Молча: журнал недоступен — не повод падать.
  }
}

/**
 * Обрезка журнала ошибок до последних LOG_KEEP_ROWS_ записей.
 *
 * Лист растёт с каждым сбоем и рано или поздно начинает тормозить таблицу.
 * Шапка (строка 1) остаётся на месте, лишние старые строки удаляются.
 *
 * @return {number} сколько строк удалено
 */
function trimErrorLog_() {
  const sh = sheetByName_(CONFIG.SHEETS.LOG);
  if (!sh) return 0;

  const dataRows = sh.getLastRow() - 1;   // без строки заголовков
  if (dataRows <= LOG_KEEP_ROWS_ + LOG_TRIM_MARGIN_) return 0;

  const removeCount = dataRows - LOG_KEEP_ROWS_;
  sh.deleteRows(2, removeCount);
  return removeCount;
}
