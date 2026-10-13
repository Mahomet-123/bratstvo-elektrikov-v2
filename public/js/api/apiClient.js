/**
 * ============================================================================
 * Модуль: apiClient
 * Ответственность: единственная точка общения с бэкендом Apps Script —
 *                  сборка запроса, подстановка токена, разбор ответа,
 *                  таймауты и понятные ошибки.
 * Зависимости: config, core/store, core/logger
 * ============================================================================
 */

import { CONFIG } from '../config.js';
import { store } from '../core/store.js';
import { log } from '../core/logger.js';

/** Ошибка обращения к API с машинным кодом. */
export class ApiError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'ERROR';
    this.details = details || null;
    this.offline = code === 'OFFLINE';
  }
}

/** Таймаут одного запроса. */
const TIMEOUT_MS = 45000;

/**
 * Вызов API.
 * @param {string} action — имя маршрута, например «objects.list»
 * @param {Object=} payload
 * @param {Object=} options — { token, timeout, silent }
 * @return {Promise<*>} полезная нагрузка ответа (поле data)
 */
export async function request(action, payload, options) {
  const config = options || {};

  if (!navigator.onLine) {
    throw new ApiError('Нет подключения к интернету', 'OFFLINE');
  }

  const token = config.token !== undefined
    ? config.token
    : (store.get().session ? store.get().session.token : '');

  const body = JSON.stringify({
    action: action,
    token: token || '',
    payload: payload || {}
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout || TIMEOUT_MS);

  let response;
  try {
    response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error && error.name === 'AbortError') {
      throw new ApiError('Сервер не ответил вовремя. Попробуйте ещё раз.', 'TIMEOUT');
    }
    log.warn('Сеть недоступна при вызове ' + action, error.message);
    throw new ApiError('Нет связи с сервером', 'OFFLINE');
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new ApiError('Сервер вернул ошибку ' + response.status, 'HTTP_' + response.status);
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    log.error('Ответ сервера не разобран как JSON', { action: action, head: text.slice(0, 200) });
    throw new ApiError('Некорректный ответ сервера', 'BAD_RESPONSE');
  }

  if (!parsed.ok) {
    throw new ApiError(parsed.error || 'Неизвестная ошибка сервера', parsed.code || 'ERROR', parsed);
  }

  return parsed.data;
}

/**
 * Проверка связи с сервером.
 * @return {Promise<Object>}
 */
export function health() {
  return request('health', {}, { timeout: 20000 });
}

/**
 * Человеческое описание ошибки — для показа в уведомлении.
 * @param {Error} error
 * @return {string}
 */
export function describeError(error) {
  if (!error) return 'Неизвестная ошибка';
  if (error instanceof ApiError) {
    if (error.offline) return 'Нет интернета — запись сохранена в очередь';
    if (error.code === 'AUTH') return 'Сессия истекла, войдите заново';
    if (error.code === 'FORBIDDEN') return 'Недостаточно прав для этого действия';
    return error.message;
  }
  return error.message || 'Непредвиденная ошибка';
}

export default { request, health, describeError, ApiError };
