/**
 * ============================================================================
 * Модуль: Sessions
 * Ответственность: выдача, проверка и отзыв сессий входа (мастера и руководитель).
 *                  Хранилище — свойства скрипта: одна сессия = одно свойство.
 * Зависимости: Config, Utils, Users
 * ============================================================================
 */

// Префиксы ключей в свойствах скрипта.
const SESSION_PREFIX_ = 'SESS_';
const SESSION_INDEX_ = 'SESS_INDEX';

/**
 * Свойства скрипта.
 * @return {Properties}
 */
function props_() {
  return PropertiesService.getScriptProperties();
}

/**
 * Список активных токенов.
 * @return {Array<string>}
 */
function sessionIndex_() {
  const raw = props_().getProperty(SESSION_INDEX_);
  const list = jsonParse_(raw, []);
  return Array.isArray(list) ? list : [];
}

/**
 * Сохранение списка активных токенов.
 * @param {Array<string>} list
 */
function saveSessionIndex_(list) {
  props_().setProperty(SESSION_INDEX_, JSON.stringify(list || []));
}

/**
 * Создание сессии для пользователя.
 * @param {Object} user — профиль в виде allUsers_(): { id, name, role, ... }
 * @return {{token: string, user: Object, expires: string}}
 */
function createSession_(user) {
  const token = randomToken_(32);
  const expires = addDays_(new Date(), CONFIG.SESSION_DAYS);
  const payload = {
    id: str_(user.id),
    name: str_(user.name),
    role: str_(user.role) || CONFIG.ROLE_MASTER,
    exp: expires.getTime(),
    created: nowIso_()
  };
  props_().setProperty(SESSION_PREFIX_ + token, JSON.stringify(payload));

  const index = sessionIndex_();
  index.push(token);
  saveSessionIndex_(index);

  return { token: token, user: publicUser_(payload), expires: expires.toISOString() };
}

/**
 * Публичное представление пользователя (без кода доступа).
 * @param {Object} session
 * @return {Object}
 */
function publicUser_(session) {
  return {
    id: str_(session.id),
    name: str_(session.name),
    role: str_(session.role) || CONFIG.ROLE_MASTER,
    isLeader: str_(session.role) === CONFIG.ROLE_LEADER
  };
}

/**
 * Получение сессии по токену. Истёкшие сессии удаляются на месте.
 * @param {string} token
 * @return {Object|null}
 */
function getSession_(token) {
  const t = str_(token);
  if (!t) return null;
  const raw = props_().getProperty(SESSION_PREFIX_ + t);
  if (!raw) return null;
  const session = jsonParse_(raw, null);
  if (!session) return null;
  if (!session.exp || session.exp < Date.now()) {
    dropSession_(t);
    return null;
  }
  return session;
}

/**
 * Проверка сессии с выбросом ошибки — для защищённых маршрутов.
 * @param {string} token
 * @return {Object} сессия
 */
function requireSession_(token) {
  const session = getSession_(token);
  assert_(session, 'Сессия истекла. Войдите заново.', 'AUTH');
  return session;
}

/**
 * Проверка, что вошедший — руководитель.
 * @param {string} token
 * @return {Object} сессия
 */
function requireLeader_(token) {
  const session = requireSession_(token);
  assert_(session.role === CONFIG.ROLE_LEADER, 'Действие доступно только руководителю.', 'FORBIDDEN');
  return session;
}

/**
 * Отзыв сессии.
 * @param {string} token
 * @return {boolean}
 */
function dropSession_(token) {
  const t = str_(token);
  if (!t) return false;
  props_().deleteProperty(SESSION_PREFIX_ + t);
  const index = sessionIndex_().filter(function (x) { return x !== t; });
  saveSessionIndex_(index);
  return true;
}

/**
 * Отзыв всех сессий пользователя — например, при смене кода доступа.
 * @param {string} userId
 * @return {number} сколько сессий отозвано
 */
function dropUserSessions_(userId) {
  const id = str_(userId);
  let dropped = 0;
  sessionIndex_().forEach(function (token) {
    const session = getSession_(token);
    if (session && str_(session.id) === id) {
      dropSession_(token);
      dropped++;
    }
  });
  return dropped;
}

/**
 * Уборка истёкших сессий. Вызывается по триггеру раз в сутки.
 * @return {number} сколько удалено
 */
function cleanupSessions_() {
  let removed = 0;
  sessionIndex_().forEach(function (token) {
    const raw = props_().getProperty(SESSION_PREFIX_ + token);
    const session = jsonParse_(raw, null);
    if (!session || !session.exp || session.exp < Date.now()) {
      props_().deleteProperty(SESSION_PREFIX_ + token);
      removed++;
    }
  });
  if (removed) {
    saveSessionIndex_(sessionIndex_().filter(function (t) {
      return !!props_().getProperty(SESSION_PREFIX_ + t);
    }));
  }
  return removed;
}
