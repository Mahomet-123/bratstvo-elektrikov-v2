/**
 * ============================================================================
 * Модуль: router
 * Ответственность: навигация по хэш-адресам (#/objects, #/object/005) —
 *                  разбор адреса, сопоставление с экраном, перерисовка.
 * Зависимости: core/logger
 * ============================================================================
 */

import { log } from './logger.js';

/**
 * Разбор шаблона пути в регулярное выражение и список имён параметров.
 * @param {string} pattern — «/object/:id»
 * @return {{regex: RegExp, keys: Array<string>}}
 */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\/:([A-Za-z0-9_]+)/g, (match, key) => {
      keys.push(key);
      return '/([^/]+)';
    });
  return { regex: new RegExp('^' + (source || '') + '/?$'), keys };
}

/**
 * Создание роутера.
 * @param {Object} options
 * @param {Array<{path: string, handler: Function, title?: string}>} options.routes
 * @param {Function=} options.fallback — вызывается, если адрес не распознан
 * @return {Object}
 */
export function createRouter(options) {
  const config = options || {};
  const compiled = (config.routes || []).map((route) => {
    const info = compile(route.path);
    return { route: route, regex: info.regex, keys: info.keys };
  });

  let current = null;
  let currentParams = {};

  /** Разбор текущего адреса без вызова обработчика. */
  function parse() {
    const raw = window.location.hash.replace(/^#/, '') || '/objects';
    const clean = raw.split('?')[0];
    const query = {};
    const queryPart = raw.split('?')[1];
    if (queryPart) {
      queryPart.split('&').forEach((pair) => {
        const [key, value] = pair.split('=');
        if (key) query[decodeURIComponent(key)] = decodeURIComponent(value || '');
      });
    }
    return { path: clean, query: query };
  }

  /** Обработка текущего адреса. */
  function resolve() {
    const { path, query } = parse();

    for (let i = 0; i < compiled.length; i++) {
      const item = compiled[i];
      const match = item.regex.exec(path);
      if (!match) continue;

      const params = { query: query };
      item.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1]);
      });

      current = item.route;
      currentParams = params;
      try {
        item.route.handler(params);
      } catch (error) {
        log.error('Ошибка экрана ' + item.route.path, error);
      }
      return;
    }

    if (typeof config.fallback === 'function') {
      config.fallback(path);
    } else {
      log.warn('Неизвестный адрес: ' + path);
      go('/objects', true);
    }
  }

  /**
   * Переход на адрес.
   * @param {string} path
   * @param {boolean=} replace — заменить запись в истории
   */
  function go(path, replace) {
    const target = '#' + (path.startsWith('/') ? path : '/' + path);
    if (window.location.hash === target) {
      resolve();
      return;
    }
    if (replace) {
      window.history.replaceState(null, '', target);
      resolve();
    } else {
      window.location.hash = target;
    }
  }

  /** Запуск: подписка на изменения адреса и первый разбор. */
  function start() {
    window.addEventListener('hashchange', resolve);
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/objects');
    }
    resolve();
  }

  return {
    start: start,
    go: go,
    resolve: resolve,
    /** Текущий разобранный адрес. */
    info() {
      return { route: current, params: currentParams };
    }
  };
}
