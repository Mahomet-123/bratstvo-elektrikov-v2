/**
 * ============================================================================
 * Модуль: endpoints
 * Ответственность: именованные обёртки над маршрутами API — чтобы экраны
 *                  не знали строковых имён действий и формы полезной нагрузки.
 *                  Имена действий обязаны совпадать с таблицей маршрутов
 *                  бэкенда (backend/Router.gs): опечатка здесь не ловится
 *                  проверкой синтаксиса и проявляется только в бою.
 * Зависимости: api/apiClient
 * ============================================================================
 */

import { request } from './apiClient.js';

export const api = {
  /* --- Служебное --- */

  health: () => request('health'),
  setupStatus: () => request('setup.status'),
  setupInit: () => request('setup.init'),

  /* --- Пакет данных разделов --- */
  // Один запрос вместо пяти: объекты, аналитика, бригада, посещения, архив.
  dataBundle: (options) => request('data.bundle', options || {}, { timeout: 60000 }),

  /* --- Вход и профиль --- */

  login: (name, code) => request('auth.login', { name: name, code: code }, { token: '' }),
  logout: () => request('auth.logout'),
  me: () => request('auth.me'),
  changeCode: (oldCode, newCode) => request('auth.changeCode', { oldCode: oldCode, newCode: newCode }),

  /* --- Бригада (руководитель) --- */

  usersList: () => request('users.list'),
  userSetCode: (id, code) => request('users.setCode', { id: id, code: code || '' }),
  userSetActive: (id, active) => request('users.setActive', { id: id, active: Boolean(active) }),
  usersSyncCodes: () => request('users.syncCodes'),

  /* --- Прайс --- */

  pricesList: () => request('prices.list', {}, { timeout: 60000 }),
  pricesSearch: (query, limit) => request('prices.search', { query: query, limit: limit }),
  priceUpdate: (id, price) => request('prices.update', { id: id, price: price }),

  /* --- Посещения --- */

  visitsLog: (action, meta) => request('visits.log', Object.assign({ action: action }, meta || {})),
  visitsList: (limit) => request('visits.list', { limit: limit }),
  visitsSummary: (days) => request('visits.summary', { days: days }),

  /* --- Состояние очереди --- */

  statusSet: (state) => request('statuses.set', state),
  statusList: () => request('statuses.list'),
  statusClear: () => request('statuses.clear'),

  /* --- Объекты --- */

  objectsList: (options) => request('objects.list', options || {}),
  objectGet: (id) => request('objects.get', { id: id }),
  objectCreate: (data) => request('objects.create', data),
  objectUpdate: (id, data) => request('objects.update', Object.assign({ id: id }, data)),
  objectSetStatus: (id, status) => request('objects.setStatus', { id: id, status: status }),
  objectSetMarkup: (id, on) => request('objects.setMarkup', { id: id, on: Boolean(on) }),
  objectClose: (id) => request('objects.close', { id: id }),
  objectRestore: (id) => request('objects.restore', { id: id }),
  objectRemove: (id) => request('objects.remove', { id: id }),

  /* --- Расчёт --- */

  calcGet: (id) => request('calc.get', { id: id }),
  calcSave: (id, payload) => request('calc.save', { id: id, payload: payload }),

  /* --- Журнал дней --- */

  daysList: (id) => request('days.list', { id: id }),
  daysAdd: (id, day) => request('days.add', { id: id, day: day }),
  daysRemove: (id, rowId) => request('days.remove', { id: id, rowId: rowId }),
  daysToday: (date) => request('days.today', { date: date }),

  /* --- Закупки --- */

  purchasesList: (id) => request('purchases.list', { id: id }),
  purchasesAdd: (id, purchase) => request('purchases.add', { id: id, purchase: purchase }),
  // Несколько наименований за один заход — одной операцией.
  purchasesAddBatch: (id, items, markup) =>
    request('purchases.addBatch', { id: id, items: items, markup: Boolean(markup) }),
  purchasesRemove: (id, rowId) => request('purchases.remove', { id: id, rowId: rowId }),

  /* --- Фотографии накладных --- */

  photoUpload: (payload) => request('photos.upload', payload, { timeout: 90000 }),

  /* --- Аналитика (руководитель) --- */

  analyticsSummary: (options) => request('analytics.summary', options || {}),
  analyticsDays: (options) => request('analytics.days', options || {}),

  /* --- Отчёт клиенту --- */

  reportLink: (id) => request('report.link', { id: id }),
  reportPdf: (id) => request('report.pdf', { id: id }, { timeout: 120000 }),
  reportSend: (id, contact) => request('report.send', { id: id, contact: contact }, { timeout: 120000 }),

  /* --- Кабинет клиента --- */

  cabinetGet: (id) => request('cabinet.get', { id: id }),
  // Кабинет клиента по короткой ссылке: пропуск — сам токен.
  cabinetData: (token) => request('cabinet.data', { token: token }),
  cabinetLink: (id) => request('cabinet.link', { id: id }),
  cabinetRevoke: (id) => request('cabinet.revoke', { id: id }),
  cabinetExpire: () => request('cabinet.expire'),

  /* --- Архив по годам --- */

  archiveList: () => request('archive.list'),
  archiveCleanup: (archiveId) => request('archive.cleanup', { archiveId: archiveId }),

  /* --- Уведомления в Telegram --- */

  botStatus: () => request('bot.status'),
  botSaveToken: (botToken, chatId) => request('bot.saveToken', { botToken: botToken, chatId: chatId }),
  botTest: () => request('bot.test'),
  botInstall: () => request('bot.install'),
  botRemove: () => request('bot.remove'),
  botRemind: (date) => request('bot.remind', { date: date })
};

export default api;
