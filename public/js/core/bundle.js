/**
 * ============================================================================
 * Модуль: bundle
 * Ответственность: пакет данных разделов с сервера — загрузка одним запросом,
 *                  хранение на устройстве, срок годности, пометка устаревшим,
 *                  подписка на изменения.
 *
 *                  Экраны разделов (объекты, аналитика, бригада, посещения,
 *                  архив) читают данные отсюда. Поэтому переключение вкладок
 *                  не ходит в сеть: данные уже лежат на устройстве.
 *
 *                  Данные по конкретному объекту (расчёт, дни, закупки) сюда
 *                  НЕ входят — они меняются часто, и их читаем с сервера.
 *
 * Зависимости: config, core/store, core/logger, api/endpoints
 * ============================================================================
 */

import { CONFIG } from '../config.js';
import { store } from './store.js';
import { log } from './logger.js';
import { api } from '../api/endpoints.js';

/** Загрузка в процессе: два экрана не должны тянуть пакет одновременно. */
let inFlight = null;

/** Подписчики на изменение пакета. */
const listeners = new Set();

/** Текущее время в том же виде, что и на сервере. */
function nowIso() {
  return new Date().toISOString();
}

/** Сообщить подписчикам, что пакет изменился. */
function notify() {
  const snapshot = { bundle: get(), at: store.get().bundleAt, stale: isStale() };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('Ошибка подписчика пакета данных:', error);
    }
  });
}

/* --------------------------------------------------------------------------
 * Чтение
 * ------------------------------------------------------------------------ */

/**
 * Пакет данных или null, если его ещё не загружали.
 * @return {Object|null}
 */
export function get() {
  return store.get().bundle;
}

/** Есть ли пакет на устройстве. */
export function has() {
  return Boolean(store.get().bundle);
}

/** Когда пакет получен с сервера (пустая строка — никогда). */
export function collectedAt() {
  return store.get().bundleAt || '';
}

/** Сколько миллисекунд прошло с момента получения пакета. */
export function ageMs() {
  const at = collectedAt();
  if (!at) return Infinity;
  const time = new Date(at).getTime();
  if (!isFinite(time)) return Infinity;
  return Date.now() - time;
}

/**
 * Пора ли обновить пакет.
 * Пустой срок годности (после изменения данных) считается устаревшим.
 */
export function isStale() {
  return ageMs() > CONFIG.CACHE.BUNDLE_TTL_MIN * 60000;
}

/**
 * Подписка на изменения пакета.
 * @param {Function} listener — (snapshot) => void
 * @return {Function} отписка
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* --------------------------------------------------------------------------
 * Запись
 * ------------------------------------------------------------------------ */

/** Сохранить пакет в состояние и в локальное хранилище. */
function apply(data, at) {
  const stamp = at || nowIso();
  store.patch({
    bundle: data,
    bundleAt: stamp,
    objects: (data && data.objects) || []
  });

  try {
    localStorage.setItem(CONFIG.STORAGE.BUNDLE, JSON.stringify(data));
    localStorage.setItem(CONFIG.STORAGE.BUNDLE_AT, stamp);
  } catch (error) {
    // Хранилище может быть переполнено — тогда просто держим пакет в памяти.
    log.warn('Не удалось сохранить пакет данных на устройстве', error.message);
  }

  notify();
}

/**
 * Восстановить пакет из локального хранилища при запуске приложения.
 * @return {boolean} нашёлся ли пакет
 */
export function restore() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE.BUNDLE);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return false;
    apply(data, localStorage.getItem(CONFIG.STORAGE.BUNDLE_AT) || '');
    return true;
  } catch (error) {
    return false;
  }
}

/* --------------------------------------------------------------------------
 * Загрузка
 * ------------------------------------------------------------------------ */

/**
 * Загрузить пакет с сервера.
 * Повторные вызовы, пока идёт загрузка, получают тот же запрос.
 * @param {Object=} options — { includeClosed, visitsLimit, visitsDays }
 * @return {Promise<Object>}
 */
export function load(options) {
  if (inFlight) return inFlight;

  inFlight = api.dataBundle(options || {})
    .then((data) => {
      apply(data);
      log.info('Пакет данных обновлён');
      return data;
    })
    .catch((error) => {
      log.warn('Не удалось обновить пакет данных', error.message);
      throw error;
    })
    .then(
      (result) => { inFlight = null; return result; },
      (error) => { inFlight = null; throw error; }
    );

  return inFlight;
}

/**
 * Данные для экрана: свежий пакет отдаём сразу, устаревший — обновляем.
 *
 * Экраны устроены так: сначала рисуют сохранённое (`get()`) — мгновенно,
 * без ожидания сети, — а затем вызывают этот метод и перерисовываются.
 * Если пакет свежий, в сеть никто не пойдёт вовсе.
 *
 * @param {Object=} options — { force }
 * @return {Promise<Object|null>} актуальный пакет
 */
export async function ensure(options) {
  const opts = options || {};
  if (has() && !opts.force && !isStale()) return get();
  return load(opts);
}

/* --------------------------------------------------------------------------
 * Устаревание и сброс
 * ------------------------------------------------------------------------ */

/**
 * Пометить пакет устаревшим.
 *
 * Вызывается после любого изменения данных на сервере (создание, правка,
 * смена статуса, уборка, возврат из архива). Данные остаются на экране —
 * их не выбрасываем, чтобы не показывать пустоту, — но при следующем заходе
 * экран обновит пакет.
 */
export function markStale() {
  store.patch({ bundleAt: '' });
  try {
    localStorage.removeItem(CONFIG.STORAGE.BUNDLE_AT);
  } catch (error) {
    /* не критично */
  }
  notify();
}

/** Полностью убрать пакет (выход из приложения). */
export function clear() {
  try {
    localStorage.removeItem(CONFIG.STORAGE.BUNDLE);
    localStorage.removeItem(CONFIG.STORAGE.BUNDLE_AT);
  } catch (error) {
    /* не критично */
  }
  store.patch({ bundle: null, bundleAt: '', objects: [] });
  notify();
}

/**
 * Пометить устаревшим и сразу обновить.
 *
 * Вызывается после изменения данных на сервере: пока человек возвращается
 * к списку, пакет уже обновляется.
 *
 * Важная тонкость: если загрузка уже шла, её ответ начал собираться ДО нашего
 * изменения и нового объекта в нём нет. Поэтому дожидаемся её и запрашиваем
 * заново — иначе свежим будет помечен старый ответ, и созданный объект
 * не появится в списке.
 *
 * Ошибку не пробрасываем: экран покажет сохранённые данные, а пакет останется
 * помеченным устаревшим — обновление повторится при следующем заходе.
 *
 * @param {Object=} options
 * @return {Promise<Object|null>}
 */
export function refresh(options) {
  markStale();

  const previous = inFlight ? inFlight.catch(() => null) : Promise.resolve();

  return previous
    .then(() => {
      // Ответ прежней загрузки мог снова пометить пакет свежим — снимаем метку.
      markStale();
      return load(options);
    })
    .catch((error) => {
      log.warn('Пакет данных не обновился после изменения', error.message);
      return null;
    });
}

export default {
  get: get,
  has: has,
  load: load,
  ensure: ensure,
  restore: restore,
  refresh: refresh,
  isStale: isStale,
  ageMs: ageMs,
  collectedAt: collectedAt,
  markStale: markStale,
  clear: clear,
  subscribe: subscribe
};
