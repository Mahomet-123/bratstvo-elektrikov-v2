/**
 * ============================================================================
 * Модуль: store
 * Ответственность: состояние приложения на клиенте — сессия, справочники,
 *                  список объектов, состояние синхронизации. С подпиской
 *                  на изменения и сохранением части данных в localStorage.
 * Зависимости: config
 * ============================================================================
 */

import { CONFIG } from '../config.js';

/** Начальное состояние приложения. */
const INITIAL = {
  ready: false,
  online: navigator.onLine,
  session: null,        // { token, user, expires }
  user: null,           // { id, name, role, isLeader }
  mustChangeCode: false,
  prices: null,         // полный прайс с разделами
  objects: [],          // список объектов
  queueCount: 0,        // сколько записей ждёт отправки
  queueError: '',       // последняя ошибка отправки
  lastSyncAt: '',       // когда успешно отправляли
  visitsLogged: false
};

/**
 * Создание хранилища состояния.
 * @param {Object} initial
 * @return {Object} { get, set, patch, subscribe }
 */
export function createStore(initial) {
  let state = Object.assign({}, initial);
  const listeners = new Set();

  return {
    /** Текущее состояние (только для чтения). */
    get() {
      return state;
    },

    /** Полная замена состояния. */
    set(next) {
      state = Object.assign({}, next);
      notify();
    },

    /** Частичное обновление. */
    patch(changes) {
      let changed = false;
      Object.keys(changes).forEach((key) => {
        if (state[key] !== changes[key]) changed = true;
      });
      if (!changed) return state;
      state = Object.assign({}, state, changes);
      notify();
      return state;
    },

    /** Подписка на изменения. Возвращает функцию отписки. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  function notify() {
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        // Подписчик не должен ломать остальных.
        console.error('Ошибка подписчика store:', error);
      }
    });
  }
}

/** Единственное хранилище приложения. */
export const store = createStore(INITIAL);

/* --------------------------------------------------------------------------
 * Сохранение сессии между запусками
 * ------------------------------------------------------------------------ */

/**
 * Запись сессии в localStorage.
 * @param {Object|null} session — { token, user, expires }
 * @param {boolean=} mustChangeCode
 */
export function saveSession(session, mustChangeCode) {
  try {
    if (!session) {
      localStorage.removeItem(CONFIG.STORAGE.TOKEN);
      localStorage.removeItem(CONFIG.STORAGE.USER);
      store.patch({ session: null, user: null, mustChangeCode: false });
      return;
    }
    localStorage.setItem(CONFIG.STORAGE.TOKEN, session.token);
    localStorage.setItem(CONFIG.STORAGE.USER, JSON.stringify({
      user: session.user,
      expires: session.expires,
      mustChangeCode: Boolean(mustChangeCode)
    }));
    store.patch({
      session: session,
      user: session.user,
      mustChangeCode: Boolean(mustChangeCode)
    });
  } catch (error) {
    console.warn('Не удалось сохранить сессию:', error.message);
  }
}

/**
 * Чтение сохранённой сессии.
 * @return {Object|null}
 */
export function loadSession() {
  try {
    const token = localStorage.getItem(CONFIG.STORAGE.TOKEN);
    const raw = localStorage.getItem(CONFIG.STORAGE.USER);
    if (!token || !raw) return null;

    const saved = JSON.parse(raw);
    if (!saved || !saved.user) return null;
    if (saved.expires && new Date(saved.expires).getTime() < Date.now()) {
      localStorage.removeItem(CONFIG.STORAGE.TOKEN);
      localStorage.removeItem(CONFIG.STORAGE.USER);
      return null;
    }

    const session = { token: token, user: saved.user, expires: saved.expires };
    store.patch({ session: session, user: saved.user, mustChangeCode: Boolean(saved.mustChangeCode) });
    return session;
  } catch (error) {
    return null;
  }
}

/* --------------------------------------------------------------------------
 * Кэш справочников
 * ------------------------------------------------------------------------ */

/**
 * Сохранить прайс в локальный кэш.
 * @param {Object} prices
 */
export function cachePrices(prices) {
  try {
    localStorage.setItem(CONFIG.STORAGE.PRICES, JSON.stringify(prices));
    localStorage.setItem(CONFIG.STORAGE.PRICES_AT, new Date().toISOString());
  } catch (error) {
    console.warn('Не удалось закэшировать прайс:', error.message);
  }
  store.patch({ prices: prices });
}

/**
 * Прочитать прайс из кэша, если он ещё свежий.
 * @param {boolean=} ignoreTtl
 * @return {Object|null}
 */
export function readCachedPrices(ignoreTtl) {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE.PRICES);
    if (!raw) return null;
    const at = localStorage.getItem(CONFIG.STORAGE.PRICES_AT);
    if (!ignoreTtl && at) {
      const ageMin = (Date.now() - new Date(at).getTime()) / 60000;
      if (ageMin > CONFIG.CACHE.PRICES_TTL_MIN) return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

/**
 * Сохранить список объектов в кэш.
 * @param {Array} objects
 */
export function cacheObjects(objects) {
  try {
    localStorage.setItem(CONFIG.STORAGE.OBJECTS, JSON.stringify(objects));
    localStorage.setItem(CONFIG.STORAGE.OBJECTS_AT, new Date().toISOString());
  } catch (error) {
    console.warn('Не удалось закэшировать объекты:', error.message);
  }
  store.patch({ objects: objects });
}

/**
 * Прочитать объекты из кэша.
 * @param {boolean=} ignoreTtl
 * @return {Array|null}
 */
export function readCachedObjects(ignoreTtl) {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE.OBJECTS);
    if (!raw) return null;
    const at = localStorage.getItem(CONFIG.STORAGE.OBJECTS_AT);
    if (!ignoreTtl && at) {
      const ageMin = (Date.now() - new Date(at).getTime()) / 60000;
      if (ageMin > CONFIG.CACHE.OBJECTS_TTL_MIN) return null;
    }
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch (error) {
    return null;
  }
}

/** Очистить весь локальный кэш при выходе. */
export function clearCache() {
  [
    CONFIG.STORAGE.PRICES,
    CONFIG.STORAGE.PRICES_AT,
    CONFIG.STORAGE.OBJECTS,
    CONFIG.STORAGE.OBJECTS_AT,
    CONFIG.STORAGE.DRAFT_CALC
  ].forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      /* не критично */
    }
  });
}
