/**
 * ============================================================================
 * Модуль: config (фронтенд)
 * Ответственность: настройки клиента — адрес API, ключи хранилища, параметры
 *                  офлайн-очереди и кэша. Единственное место с адресом бэкенда.
 * Зависимости: нет
 * ============================================================================
 */

/** Адрес веб-приложения Apps Script. */
const API_URL =
  'https://script.google.com/macros/s/AKfycbxyAah88qWJJvNzNL8sjGdwixn_stixWCX8vJkq7qy_2PhpooTASp2j-7W46HIBJXc-/exec';

export const CONFIG = {
  APP_NAME: 'Братство Электриков',
  VERSION: '2.0.0',

  API_URL: API_URL,

  /* Ключи локального хранилища */
  STORAGE: {
    TOKEN: 'be.token',
    USER: 'be.user',
    PRICES: 'be.prices',
    PRICES_AT: 'be.pricesAt',
    OBJECTS: 'be.objects',
    OBJECTS_AT: 'be.objectsAt',
    BUNDLE: 'be.bundle',
    BUNDLE_AT: 'be.bundleAt',
    DRAFT_CALC: 'be.draftCalc'
  },

  /* Офлайн-очередь */
  QUEUE: {
    DB_NAME: 'bratstvo-elektrikov',
    DB_VERSION: 1,
    STORE: 'queue',
    RETRY_MINUTES: [1, 5, 15],
    MAX_ATTEMPTS: 20
  },

  /* Кэш данных */
  CACHE: {
    PRICES_TTL_MIN: 12 * 60,   // прайс обновляем раз в 12 часов
    // Пакет данных разделов (объекты, аналитика, бригада, посещения, архив).
    // Свежее этого срока экраны берут из памяти и в сеть не ходят.
    BUNDLE_TTL_MIN: 5,
    // Данные конкретного объекта (карточка, расчёт, дни, закупки). Экраны
    // рисуют их сразу, а свежие подтягивают в фоне — ожидания при переходах нет.
    OBJECT_TTL_MIN: 5
  },

  /* Фото накладных */
  PHOTO: {
    MAX_SIDE: 1600,            // длинная сторона после сжатия, px
    TARGET_BYTES: 300 * 1024,  // целевой размер ~300 КБ
    MIN_QUALITY: 0.4,
    MAX_QUALITY: 0.82,
    MAX_BYTES: 1024 * 1024     // предохранитель: больше мегабайта не отправляем
  },

  /* Роли — те же строки, что и в настройках бэкенда */
  ROLE_LEADER: 'leader',
  ROLE_MASTER: 'master',

  /* Классификаторы */
  STATUSES: ['расчёт', 'в работе', 'закрыт'],
  STATUS_CALC: 'расчёт',
  STATUS_WORK: 'в работе',
  STATUS_CLOSED: 'закрыт',
  STATUS_LABEL: {
    'расчёт': 'Расчёт',
    'в работе': 'В работе',
    'закрыт': 'Закрыт'
  },
  STATUS_BADGE: {
    'расчёт': 'badge--calc',
    'в работе': 'badge--work',
    'закрыт': 'badge--closed'
  },

  /* Ограничения */
  MAX_MASTERS: 50,
  TOAST_MS: 3200
};

export default CONFIG;
