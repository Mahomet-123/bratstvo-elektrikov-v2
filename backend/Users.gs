/**
 * ============================================================================
 * Модуль: Users
 * Ответственность: профили бригады — вход по имени и коду, выдача и смена кодов,
 *                  список мастеров для руководителя, синхронизация листа кодов.
 * Зависимости: Config, Utils, Sheets, Sessions, Visits
 * ============================================================================
 */

/**
 * Приведение кода доступа к каноническому виду: только цифры, с ведущими нулями.
 * Нужно потому, что Google Таблицы могут хранить «0000» как число 0.
 * @param {*} value
 * @return {string}
 */
function normCode_(value) {
  const digits = str_(value).replace(/\D/g, '');
  if (!digits) return '';
  return pad_(Number(digits), CONFIG.CODE_LENGTH);
}

/**
 * Все профили бригады.
 * @return {Array<Object>}
 */
function allUsers_() {
  return readRows_(CONFIG.SHEETS.USERS).map(function (row) {
    return {
      _row: row._row,
      id: str_(row['id']),
      name: str_(row['имя']),
      code: normCode_(row['код']),
      role: str_(row['роль']) || CONFIG.ROLE_MASTER,
      active: row['активен'] === '' ? true : bool_(row['активен']),
      phone: str_(row['телефон']),
      created: str_(row['создан']),
      changed: str_(row['изменён'])
    };
  });
}

/**
 * Поиск профиля по имени (без учёта регистра и лишних пробелов).
 * @param {string} name
 * @return {Object|null}
 */
function findUserByName_(name) {
  const needle = str_(name).toLowerCase().replace(/\s+/g, ' ');
  if (!needle) return null;
  const list = allUsers_();
  for (let i = 0; i < list.length; i++) {
    if (list[i].name.toLowerCase().replace(/\s+/g, ' ') === needle) return list[i];
  }
  return null;
}

/**
 * Поиск профиля по идентификатору.
 * @param {string} id
 * @return {Object|null}
 */
function findUserById_(id) {
  const needle = str_(id);
  if (!needle) return null;
  const list = allUsers_();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === needle) return list[i];
  }
  return null;
}

/**
 * Профиль руководителя (первый с ролью leader).
 * @return {Object|null}
 */
function findLeader_() {
  const list = allUsers_();
  for (let i = 0; i < list.length; i++) {
    if (list[i].role === CONFIG.ROLE_LEADER) return list[i];
  }
  return null;
}

/**
 * Публичное представление профиля (без кода — код отдаём только руководителю).
 * @param {Object} user
 * @return {Object}
 */
function userView_(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    active: user.active,
    phone: user.phone
  };
}

/**
 * Вход в приложение по имени и коду.
 * @param {string} name
 * @param {string} code
 * @param {Object=} meta — данные запроса для журнала посещений (ip, устройство)
 * @return {Object} { token, user, expires, mustChangeCode }
 */
function loginUser_(name, code, meta) {
  const user = findUserByName_(name);
  assert_(user, 'Пользователь с таким именем не найден.', 'AUTH');
  assert_(user.active, 'Доступ отключён. Обратитесь к руководителю.', 'FORBIDDEN');

  const given = normCode_(code);
  assert_(given && given === user.code, 'Неверный код доступа.', 'AUTH');

  const session = createSession_(user);
  logVisit_(user.name, user.role, 'вход', meta);

  return {
    token: session.token,
    user: publicUser_(session),
    expires: session.expires,
    mustChangeCode: needsCodeChange_(user)
  };
}

/**
 * Требуется ли смена кода: у руководителя остался заводской 0000.
 * @param {Object} user
 * @return {boolean}
 */
function needsCodeChange_(user) {
  return user.role === CONFIG.ROLE_LEADER && user.code === normCode_(CONFIG.LEADER_DEFAULT_CODE);
}

/**
 * Выход из приложения.
 * @param {string} token
 * @return {Object}
 */
function logoutUser_(token) {
  const session = getSession_(token);
  if (session) logVisit_(session.name, session.role, 'выход', {});
  dropSession_(token);
  return { ok: true };
}

/**
 * Смена собственного кода доступа.
 * @param {string} token
 * @param {string} oldCode
 * @param {string} newCode
 * @return {Object}
 */
function changeOwnCode_(token, oldCode, newCode) {
  const session = requireSession_(token);
  const user = findUserById_(session.id);
  assert_(user, 'Профиль не найден.', 'NOT_FOUND');

  const given = normCode_(oldCode);
  assert_(given === user.code, 'Текущий код указан неверно.', 'AUTH');

  const next = normCode_(newCode);
  assert_(next.length === CONFIG.CODE_LENGTH, 'Код должен состоять из ' + CONFIG.CODE_LENGTH + ' цифр.', 'VALIDATION');
  assert_(next !== given, 'Новый код совпадает с текущим.', 'VALIDATION');

  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.USERS, user._row, {
      'код': next,
      'изменён': nowIso_()
    });
    syncCodesSheet_();
    logVisit_(user.name, user.role, 'смена своего кода', {});
    return { ok: true, code: next };
  });
}

/**
 * Список профилей с кодами — только для руководителя.
 * @param {string} token
 * @return {Object}
 */
function listUsersForLeader_(token) {
  requireLeader_(token);
  const list = allUsers_().map(function (u) {
    return {
      id: u.id,
      name: u.name,
      code: u.code,
      role: u.role,
      active: u.active,
      phone: u.phone,
      needsCodeChange: needsCodeChange_(u)
    };
  });
  return {
    leader: list.filter(function (u) { return u.role === CONFIG.ROLE_LEADER; }),
    masters: list.filter(function (u) { return u.role === CONFIG.ROLE_MASTER; }),
    total: list.length
  };
}

/**
 * Выдача или смена кода мастеру — руководителем.
 * @param {string} token
 * @param {string} userId
 * @param {string=} code — если не задан, код генерируется
 * @return {Object}
 */
function setUserCode_(token, userId, code) {
  const leader = requireLeader_(token);
  const user = findUserById_(userId);
  assert_(user, 'Мастер не найден.', 'NOT_FOUND');
  assert_(user.role !== CONFIG.ROLE_LEADER, 'Код руководителя меняется в профиле, а не здесь.', 'VALIDATION');

  let next = normCode_(code);
  if (!next) next = uniqueCode_();

  assert_(next.length === CONFIG.CODE_LENGTH, 'Код должен состоять из ' + CONFIG.CODE_LENGTH + ' цифр.', 'VALIDATION');

  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.USERS, user._row, {
      'код': next,
      'изменён': nowIso_()
    });
    syncCodesSheet_();
    dropUserSessions_(user.id); // старые входы мастера становятся недействительными
    logVisit_(leader.name, leader.role, 'выдал код мастеру ' + user.name, {});
    return { ok: true, id: user.id, name: user.name, code: next };
  });
}

/**
 * Включение или отключение доступа мастеру.
 * @param {string} token
 * @param {string} userId
 * @param {boolean} active
 * @return {Object}
 */
function setUserActive_(token, userId, active) {
  const leader = requireLeader_(token);
  const user = findUserById_(userId);
  assert_(user, 'Мастер не найден.', 'NOT_FOUND');
  assert_(user.role !== CONFIG.ROLE_LEADER, 'Нельзя отключить руководителя.', 'VALIDATION');

  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.USERS, user._row, {
      'активен': active ? 'да' : 'нет',
      'изменён': nowIso_()
    });
    if (!active) dropUserSessions_(user.id);
    logVisit_(leader.name, leader.role, (active ? 'включил' : 'отключил') + ' доступ ' + user.name, {});
    return { ok: true, id: user.id, active: !!active };
  });
}

/**
 * Свободный код из 4 цифр, не занятый другими профилями.
 * @return {string}
 */
function uniqueCode_() {
  const taken = {};
  allUsers_().forEach(function (u) { taken[u.code] = true; });
  for (let attempt = 0; attempt < 500; attempt++) {
    const candidate = randomDigits_(CONFIG.CODE_LENGTH);
    if (!taken[candidate]) return candidate;
  }
  throw new Error('Не удалось подобрать свободный код доступа.');
}

/**
 * Пересборка листа «Коды доступа» из листа «Пользователи».
 * Служебный лист для руководителя: кто есть кто и с каким кодом.
 * @return {number} число записей
 */
function syncCodesSheet_() {
  const users = allUsers_();
  const rows = users.map(function (u) {
    return [u.name, u.code, u.created || '', u.changed || ''];
  });
  replaceTable_(CONFIG.SHEETS.CODES, SCHEMA[CONFIG.SHEETS.CODES], rows);
  return rows.length;
}

/**
 * Текущий профиль по токену.
 * @param {string} token
 * @return {Object}
 */
function currentUser_(token) {
  const session = requireSession_(token);
  const user = findUserById_(session.id);
  return {
    user: publicUser_(session),
    mustChangeCode: user ? needsCodeChange_(user) : false,
    phone: user ? user.phone : ''
  };
}
