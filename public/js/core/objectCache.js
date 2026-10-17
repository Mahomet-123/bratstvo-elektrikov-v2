/**
 * ============================================================================
 * Модуль: objectCache
 * Ответственность: данные объекта, сохранённые на устройстве — карточка,
 *                  расчёт, журнал дней и закупки, а также записи, которые
 *                  ещё не ушли на сервер.
 *
 *                  Экраны объекта сначала рисуют сохранённое (мгновенно,
 *                  без ожидания сети), а свежее подтягивают следом. Поэтому
 *                  переходы между экранами объекта не показывают «Загружаем…».
 *
 *                  Записи, сделанные без сети, лежат здесь же до отправки:
 *                  человек видит свою работу сразу, а не после ответа Google.
 *
 * Зависимости: config
 * ============================================================================
 */

import { CONFIG } from '../config.js';

/** Сколько объектов держим на устройстве. */
const KEEP_OBJECTS = 20;

/** Префикс ключа объекта в локальном хранилище. */
const PREFIX = 'be.obj.';

/** Ключ списка сохранённых объектов. */
const INDEX_KEY = 'be.obj.index';

/** Что храним по объекту. */
function emptyEntry() {
  return {
    card: null,
    calc: null,
    days: null,
    purchases: null,
    pendingDay: [],
    pendingPurchase: [],
    at: ''
  };
}

/** Прочитать запись объекта. */
function readRaw(id) {
  const key = str(id);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

/** Записать запись объекта и обновить список сохранённых. */
function writeRaw(id, entry) {
  const key = str(id);
  if (!key) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
    touchIndex(key);
  } catch (error) {
    // Хранилище может быть переполнено — тогда чистим самые старые объекты.
    prune(true);
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(entry));
      touchIndex(key);
    } catch (second) {
      /* молча: кэш — не повод ломать работу */
    }
  }
}

function str(value) {
  return value === undefined || value === null ? '' : String(value);
}

/** Отметить объект как недавно использованный и подчистить старые. */
function touchIndex(id) {
  let index = [];
  try {
    index = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    if (!Array.isArray(index)) index = [];
  } catch (error) {
    index = [];
  }

  index = index.filter((item) => item && item.id !== id);
  index.push({ id: id, at: new Date().toISOString() });

  // Держим только последние объекты: иначе хранилище распухнет.
  if (index.length > KEEP_OBJECTS) {
    const extra = index.slice(0, index.length - KEEP_OBJECTS);
    extra.forEach((item) => {
      try {
        localStorage.removeItem(PREFIX + item.id);
      } catch (error) {
        /* не критично */
      }
    });
    index = index.slice(index.length - KEEP_OBJECTS);
  }

  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    /* не критично */
  }
}

/** Убрать из хранилища самые старые объекты. */
function prune(all) {
  let index = [];
  try {
    index = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
  } catch (error) {
    index = [];
  }
  if (!Array.isArray(index)) index = [];

  const keep = all ? 1 : Math.floor(KEEP_OBJECTS / 2);
  const extra = index.slice(0, Math.max(0, index.length - keep));
  extra.forEach((item) => {
    try {
      localStorage.removeItem(PREFIX + item.id);
    } catch (error) {
      /* не критично */
    }
  });

  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index.slice(Math.max(0, index.length - keep))));
  } catch (error) {
    /* не критично */
  }
}

/* --------------------------------------------------------------------------
 * Чтение и запись
 * ------------------------------------------------------------------------ */

/**
 * Сохранённые данные объекта.
 * @param {string} id
 * @return {Object|null}
 */
export function read(id) {
  return readRaw(id);
}

/**
 * Одна часть кэша объекта.
 * @param {string} id
 * @param {string} name — 'card' | 'calc' | 'days' | 'purchases'
 * @return {*}
 */
export function part(id, name) {
  const entry = readRaw(id);
  return entry ? entry[name] : null;
}

/**
 * Сохранить часть кэша и отметить данные свежими.
 * @param {string} id
 * @param {string} name
 * @param {*} value
 */
export function put(id, name, value) {
  const entry = readRaw(id) || emptyEntry();
  entry[name] = value;
  entry.at = new Date().toISOString();
  writeRaw(id, entry);
}

/**
 * Пора ли обновить данные объекта.
 * @param {string} id
 * @return {boolean}
 */
export function isStale(id) {
  const entry = readRaw(id);
  if (!entry || !entry.at) return true;
  const age = Date.now() - new Date(entry.at).getTime();
  if (!isFinite(age)) return true;
  return age > CONFIG.CACHE.OBJECT_TTL_MIN * 60000;
}

/**
 * Пометить данные объекта устаревшими.
 * Сами данные не выбрасываем: экран покажет их сразу, а свежие подтянет следом.
 * @param {string} id
 */
export function markStale(id) {
  const entry = readRaw(id);
  if (!entry) return;
  entry.at = '';
  writeRaw(id, entry);
}

/** Убрать объект из хранилища (например, после уборки). */
export function forget(id) {
  try {
    localStorage.removeItem(PREFIX + str(id));
  } catch (error) {
    /* не критично */
  }
}

/* --------------------------------------------------------------------------
 * Записи, ждущие отправки
 * ------------------------------------------------------------------------ */

/**
 * Запомнить неотправленную запись, чтобы человек видел её сразу.
 * @param {string} id — объект
 * @param {string} kind — 'day' | 'purchase'
 * @param {Object} record — как показывать запись
 */
export function addPending(id, kind, record) {
  const entry = readRaw(id) || emptyEntry();
  const key = kind === 'day' ? 'pendingDay' : 'pendingPurchase';
  entry[key] = (entry[key] || []).concat([record]);
  writeRaw(id, entry);
}

/**
 * Убрать запись из списка ждущих (её отправили).
 * @param {string} id
 * @param {string} kind
 * @param {number=} queueId — если не задан, убираем все записи этого вида
 */
export function dropPending(id, kind, queueId) {
  const entry = readRaw(id);
  if (!entry) return;

  const key = kind === 'day' ? 'pendingDay' : 'pendingPurchase';
  const list = entry[key] || [];

  entry[key] = queueId === undefined || queueId === null
    ? []
    : list.filter((item) => item.queueId !== queueId);

  writeRaw(id, entry);
}

/**
 * Список ждущих отправки записей.
 * @param {string} id
 * @param {string} kind
 * @return {Array<Object>}
 */
export function pending(id, kind) {
  const entry = readRaw(id);
  if (!entry) return [];
  return (kind === 'day' ? entry.pendingDay : entry.pendingPurchase) || [];
}

export default {
  read: read,
  part: part,
  put: put,
  isStale: isStale,
  markStale: markStale,
  forget: forget,
  addPending: addPending,
  dropPending: dropPending,
  pending: pending
};
