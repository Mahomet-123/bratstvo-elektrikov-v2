/**
 * ============================================================================
 * Модуль: sync
 * Ответственность: отправка офлайн-очереди — по одной записи, с повторами
 *                  (1 → 5 → 15 минут), остановкой при пропаже сети и ручным
 *                  запуском. Состояние очереди держит в общем хранилище,
 *                  чтобы индикатор в шапке показывал правду.
 * Зависимости: config, core/store, core/queue, core/logger, api/*
 * ============================================================================
 */

import { CONFIG } from '../config.js';
import { store } from './store.js';
import { log } from './logger.js';
import * as queue from './queue.js';
import { api } from '../api/endpoints.js';
import objectCache from './objectCache.js';
import { describeError, ApiError } from '../api/apiClient.js';

/** Что умеет очередь: вид записи → как её отправить. */
const KINDS = {
  /**
   * Закупка. Сначала загружаются все фото накладной (их может быть несколько),
   * затем создаётся сама запись — чтобы ссылки уже существовали.
   *
   * Поддерживаем и список `photos`, и одиночное `photo`: в очереди на телефоне
   * могли остаться записи прежней версии приложения.
   */
  purchase: async (payload) => {
    const list = Array.isArray(payload.photos) && payload.photos.length
      ? payload.photos
      : (payload.photo && payload.photo.data ? [payload.photo] : []);

    const uploaded = [];
    for (let i = 0; i < list.length; i++) {
      const photo = list[i];
      if (!photo || !photo.data) continue;
      const result = await api.photoUpload({
        id: payload.objectId,
        name: photo.name || ('Накладная ' + (i + 1)),
        mime: photo.mime || 'image/jpeg',
        data: photo.data
      });
      uploaded.push({ link: result.url, id: result.fileId });
    }

    return api.purchasesAdd(payload.objectId, Object.assign({}, payload.purchase, {
      photos: uploaded,
      photo: uploaded.length ? '' : (payload.purchase.photo || ''),
      photoId: uploaded.length ? '' : (payload.purchase.photoId || '')
    }));
  },

  /** Запись журнала дней. */
  day: async (payload) => api.daysAdd(payload.objectId, payload.day)
};

/**
 * Отправить запись прямо сейчас, минуя очередь.
 * Экраны пользуются этим, когда сеть есть: одна и та же функция отвечает
 * и за отправку из очереди, и за немедленную отправку — расхождений нет.
 * @param {string} kind — 'purchase' | 'day'
 * @param {Object} payload
 * @return {Promise<*>} ответ сервера
 */
export function sendNow(kind, payload) {
  const handler = KINDS[kind];
  if (!handler) throw new Error('Неизвестный вид записи: ' + kind);
  return handler(payload || {});
}

/** Состояние отправки в пределах запуска приложения. */
const state = {
  flushing: false,
  timer: null,
  listeners: new Set()
};

/* --------------------------------------------------------------------------
 * Наблюдатели
 * ------------------------------------------------------------------------ */

/**
 * Подписка на изменение состояния очереди.
 * @param {Function} listener — (snapshot) => void
 * @return {Function} отписка
 */
export function subscribe(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** Сообщить наблюдателям текущее состояние. */
function notify() {
  const snapshot = {
    count: store.get().queueCount,
    error: store.get().queueError,
    sending: state.flushing
  };
  state.listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('Ошибка подписчика очереди:', error);
    }
  });
}

/**
 * Обновить счётчик записей в общем состоянии.
 * @return {Promise<number>}
 */
export async function refresh() {
  try {
    const value = await queue.count();
    store.patch({ queueCount: value });
    notify();
    return value;
  } catch (error) {
    log.warn('Не удалось прочитать очередь', error.message);
    return 0;
  }
}

/* --------------------------------------------------------------------------
 * Постановка в очередь
 * ------------------------------------------------------------------------ */

/**
 * Положить операцию в очередь на отправку.
 * @param {string} kind — 'purchase' | 'day'
 * @param {Object} payload — данные операции
 * @param {string} label — как показать запись человеку
 * @return {Promise<number|null>} идентификатор записи
 */
export async function enqueue(kind, payload, label) {
  try {
    const id = await queue.add({
      kind: kind,
      payload: payload,
      label: label || '',
      objectId: (payload && payload.objectId) || ''
    });
    await refresh();
    scheduleNext();
    return id;
  } catch (error) {
    log.error('Не удалось поставить запись в очередь', error.message);
    return null;
  }
}

/* --------------------------------------------------------------------------
 * Отправка
 * ------------------------------------------------------------------------ */

/** Задержка до следующей попытки, минут. */
function delayMinutes(attempts) {
  const plan = CONFIG.QUEUE.RETRY_MINUTES || [1, 5, 15];
  const index = Math.min(Math.max(attempts - 1, 0), plan.length - 1);
  return plan[index];
}

/**
 * Ошибка означает отсутствие связи, а не отказ сервера?
 * Нужна экранам: по ней решается, ставить ли запись в очередь.
 * @param {Error} error
 * @return {boolean}
 */
export function isOfflineError(error) {
  return !navigator.onLine || (error instanceof ApiError && error.offline) ||
    (error instanceof ApiError && error.code === 'TIMEOUT');
}

/**
 * Отправка очереди.
 * @param {Object=} options — { manual, silent }
 * @return {Promise<Object>} { sent, failed, left, stopped }
 */
export async function flush(options) {
  const opts = options || {};
  if (state.flushing) return { sent: 0, failed: 0, left: await refresh(), busy: true };

  state.flushing = true;
  notify();

  const result = { sent: 0, failed: 0, left: 0, stopped: '' };

  try {
    const items = await queue.all();
    const now = Date.now();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Записи, которым ещё рано повторяться, пропускаем.
      if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > now) continue;
      // Исчерпавшие попытки ждут ручного вмешательства.
      if ((item.attempts || 0) >= CONFIG.QUEUE.MAX_ATTEMPTS) continue;

      if (!navigator.onLine) {
        result.stopped = 'нет сети';
        break;
      }

      const handler = KINDS[item.kind];
      if (!handler) {
        await queue.remove(item.id);
        result.failed++;
        continue;
      }

      try {
        await handler(item.payload || {});
        await queue.remove(item.id);
        // Запись ушла на сервер: убираем её из списка ждущих и помечаем
        // данные объекта устаревшими — при следующем заходе подтянутся свежие.
        if (item.objectId) {
          objectCache.dropPending(item.objectId, item.kind, item.id);
          objectCache.markStale(item.objectId);
        }
        result.sent++;
        store.patch({ queueError: '' });
      } catch (error) {
        if (isOfflineError(error)) {
          // Связь пропала: попытку не считаем, просто ждём следующего раза.
          result.stopped = 'нет связи';
          break;
        }

        const attempts = (item.attempts || 0) + 1;
        const nextAt = new Date(Date.now() + delayMinutes(attempts) * 60000).toISOString();
        await queue.put(Object.assign({}, item, {
          attempts: attempts,
          lastAttemptAt: new Date().toISOString(),
          nextAttemptAt: nextAt,
          error: describeError(error)
        }));
        store.patch({ queueError: describeError(error) });
        result.failed++;
      }
    }

    result.left = await refresh();

    if (result.sent > 0) {
      store.patch({ lastSyncAt: new Date().toISOString() });
      log.info('Отправлено записей из очереди: ' + result.sent);
    }
  } catch (error) {
    log.error('Сбой отправки очереди', error.message);
    result.stopped = error.message;
  } finally {
    state.flushing = false;
    notify();
    scheduleNext();
  }

  return result;
}

/**
 * Ручная отправка из интерфейса: сбрасывает отсрочки и пробует снова.
 * @return {Promise<Object>}
 */
export async function flushManual() {
  const items = await queue.all();
  const reset = items.map((item) => Object.assign({}, item, {
    nextAttemptAt: '',
    attempts: item.attempts >= CONFIG.QUEUE.MAX_ATTEMPTS ? 0 : item.attempts
  }));
  for (let i = 0; i < reset.length; i++) await queue.put(reset[i]);
  return flush({ manual: true });
}

/**
 * Есть ли записи, требующие внимания человека.
 * @return {Promise<Array<Object>>}
 */
export async function failedItems() {
  const items = await queue.all();
  return items.filter((item) => (item.attempts || 0) > 0);
}

/* --------------------------------------------------------------------------
 * Планировщик
 * ------------------------------------------------------------------------ */

/** Запланировать следующую попытку отправки. */
export function scheduleNext() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  const count = Number(store.get().queueCount) || 0;
  if (!count || !navigator.onLine) return;

  const plan = CONFIG.QUEUE.RETRY_MINUTES || [1, 5, 15];
  const waitMs = Math.min(plan[0] || 1, 5) * 60000;

  state.timer = setTimeout(() => {
    flush().catch(() => {});
  }, waitMs);
}

/**
 * Запуск наблюдения за очередью: пересчёт при старте, отправка при появлении
 * сети и при возвращении приложения на экран.
 */
export async function start() {
  await refresh();
  scheduleNext();

  window.addEventListener('online', () => {
    flush().catch(() => {});
  });

  // Приложение вернулось на передний план — хороший момент отправить накопившееся.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      flush().catch(() => {});
    }
  });
}

export default {
  start: start,
  flush: flush,
  flushManual: flushManual,
  enqueue: enqueue,
  refresh: refresh,
  subscribe: subscribe,
  failedItems: failedItems,
  scheduleNext: scheduleNext,
  sendNow: sendNow,
  isOfflineError: isOfflineError
};
