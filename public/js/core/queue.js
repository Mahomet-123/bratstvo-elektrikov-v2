/**
 * ============================================================================
 * Модуль: queue
 * Ответственность: локальное хранилище неотправленных записей (IndexedDB).
 *                  Умеет только складывать, читать, менять и удалять записи —
 *                  за отправку и повторы отвечает модуль sync.
 * Зависимости: config
 * ============================================================================
 */

import { CONFIG } from '../config.js';

const DB_NAME = CONFIG.QUEUE.DB_NAME;
const DB_VERSION = CONFIG.QUEUE.DB_VERSION;
const STORE = CONFIG.QUEUE.STORE;

/** Открытое соединение кешируется на всё время работы приложения. */
let dbPromise = null;

/**
 * Поддерживает ли браузер IndexedDB.
 * @return {boolean}
 */
export function isSupported() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

/**
 * Открытие базы очереди.
 * @return {Promise<IDBDatabase>}
 */
function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error('Браузер не поддерживает офлайн-хранилище'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть офлайн-хранилище'));
  });

  // Неудачная попытка не должна «залипать» навсегда.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/**
 * Обёртка над одной операцией в хранилище.
 * @param {string} mode — 'readonly' | 'readwrite'
 * @param {Function} run — (store) => IDBRequest
 * @return {Promise<*>}
 */
async function withStore(mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = run(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error || new Error('Ошибка офлайн-хранилища'));
    tx.onabort = () => reject(tx.error || new Error('Операция прервана'));
  });
}

/**
 * Постановка записи в очередь.
 * @param {Object} item — { kind, payload, label, objectId }
 * @return {Promise<number>} идентификатор записи
 */
export async function add(item) {
  const record = Object.assign({
    kind: '',
    payload: {},
    label: '',
    objectId: '',
    attempts: 0,
    lastAttemptAt: '',
    nextAttemptAt: '',
    error: '',
    createdAt: new Date().toISOString()
  }, item);

  const id = await withStore('readwrite', (store) => store.add(record));
  return id;
}

/**
 * Все записи очереди в порядке добавления.
 * @return {Promise<Array<Object>>}
 */
export async function all() {
  const items = await withStore('readonly', (store) => store.getAll());
  return (items || []).sort((a, b) => (a.id || 0) - (b.id || 0));
}

/**
 * Сколько записей ждёт отправки.
 * @return {Promise<number>}
 */
export async function count() {
  const value = await withStore('readonly', (store) => store.count());
  return Number(value) || 0;
}

/**
 * Сохранение изменённой записи.
 * @param {Object} item — запись целиком, с полем id
 * @return {Promise<void>}
 */
export function put(item) {
  return withStore('readwrite', (store) => store.put(item));
}

/**
 * Удаление записи по идентификатору.
 * @param {number} id
 * @return {Promise<void>}
 */
export function remove(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

/**
 * Полная очистка очереди.
 * @return {Promise<void>}
 */
export function clear() {
  return withStore('readwrite', (store) => store.clear());
}
