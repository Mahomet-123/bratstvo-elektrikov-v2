/**
 * ============================================================================
 * Модуль: format
 * Ответственность: приведение чисел, дат и величин к виду, принятому в России.
 *                  Никаких обращений к DOM и сети.
 * Зависимости: нет
 * ============================================================================
 */

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/**
 * Денежная сумма: «12 345,60 ₽».
 * @param {number} value
 * @param {boolean=} withSymbol
 * @return {string}
 */
export function money(value, withSymbol = true) {
  const n = Number(value) || 0;
  const parts = n.toFixed(2).split('.');
  const int = parts[0].replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  const sign = n < 0 ? '−' : '';
  const text = sign + int + ',' + parts[1];
  return withSymbol ? text + ' ₽' : text;
}

/**
 * Короткая сумма без копеек: «12 346 ₽».
 * @param {number} value
 * @return {string}
 */
export function moneyShort(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '−' : '';
  const int = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  return sign + int + ' ₽';
}

/**
 * Число с разделителями разрядов.
 * @param {number} value
 * @param {number=} digits
 * @return {string}
 */
export function num(value, digits = 0) {
  const n = Number(value) || 0;
  const text = digits > 0 ? n.toFixed(digits) : String(Math.round(n));
  const parts = text.split('.');
  parts[0] = parts[0].replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  return (n < 0 ? '−' : '') + parts.join(',');
}

/**
 * Разбор даты из строки таблицы.
 * @param {string|Date} value
 * @return {Date|null}
 */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Дата в формате ГГГГ-ММ-ДД — для отправки на сервер.
 * @param {Date|string} value
 * @return {string}
 */
export function isoDate(value) {
  const d = toDate(value) || new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

/**
 * Сегодняшняя дата в формате ГГГГ-ММ-ДД.
 * @return {string}
 */
export function today() {
  return isoDate(new Date());
}

/**
 * Дата по-русски: «14 октября 2026».
 * @param {string|Date} value
 * @return {string}
 */
export function dateRu(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.getDate() + ' ' + MONTHS_GENITIVE[d.getMonth()] + ' ' + d.getFullYear();
}

/**
 * Дата коротко: «14.10.2026».
 * @param {string|Date} value
 * @return {string}
 */
export function dateShort(value) {
  const d = toDate(value);
  if (!d) return '—';
  return String(d.getDate()).padStart(2, '0') + '.' +
    String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

/**
 * Дата с днём недели: «14.10.2026, вт».
 * @param {string|Date} value
 * @return {string}
 */
export function dateWithWeekday(value) {
  const d = toDate(value);
  if (!d) return '—';
  return dateShort(d) + ', ' + WEEKDAYS[d.getDay()];
}

/**
 * Дата относительно сегодня: «сегодня», «вчера», иначе короткая дата.
 * @param {string|Date} value
 * @return {string}
 */
export function dateRelative(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = dayDiff(d, new Date());
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  if (diff === 2) return 'позавчера';
  return dateShort(d);
}

/** Разница в целых днях между датами. */
function dayDiff(a, b) {
  const one = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const two = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((two - one) / 86400000);
}

/**
 * Время из ISO-строки: «14:35».
 * @param {string} value
 * @return {string}
 */
export function timeRu(value) {
  const d = toDate(value);
  if (!d) return '—';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Дата и время: «14.10.2026 14:35».
 * @param {string} value
 * @return {string}
 */
export function dateTimeRu(value) {
  const d = toDate(value);
  if (!d) return '—';
  return dateShort(d) + ' ' + timeRu(d);
}

/**
 * Часы: «7,5 ч».
 * @param {number} value
 * @return {string}
 */
export function hours(value) {
  const n = Number(value) || 0;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  return text + ' ч';
}

/**
 * Русская форма множественного числа.
 * @param {number} count
 * @param {Array<string>} forms — [один, два, много]
 * @return {string}
 */
export function plural(count, forms) {
  const n = Math.abs(Math.round(Number(count) || 0)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

/**
 * «5 позиций», «1 позиция», «2 позиции».
 * @param {number} count
 * @param {Array<string>} forms
 * @return {string}
 */
export function countLabel(count, forms) {
  return count + ' ' + plural(count, forms);
}

/**
 * Проценты: «12,5%».
 * @param {number} value
 * @param {number=} digits
 * @return {string}
 */
export function percent(value, digits = 0) {
  const n = Number(value) || 0;
  const text = digits > 0 ? n.toFixed(digits).replace('.', ',') : String(Math.round(n));
  return text + '%';
}

/**
 * Инициалы для аватара: «Мастер 12» → «М1».
 * @param {string} name
 * @return {string}
 */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Обрезка длинного текста.
 * @param {string} text
 * @param {number} max
 * @return {string}
 */
export function shorten(text, max = 60) {
  const s = String(text || '');
  return s.length <= max ? s : s.slice(0, max - 1).trim() + '…';
}

/** Человекочитаемый размер файла. */
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' КБ';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
}
