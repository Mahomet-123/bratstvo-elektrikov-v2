/**
 * ============================================================================
 * Модуль: Cabinet
 * Ответственность: кабинет клиента — персональная ссылка на объект, доступ
 *                  по токену без входа в приложение, закрытие доступа.
 *                  Кабинет живёт, пока идут работы, и ещё несколько дней
 *                  после закрытия — чтобы клиент успел всё посмотреть.
 * Зависимости: Config, Utils, Sheets, Objects, Calc, Sessions, Pages
 * ============================================================================
 */

/**
 * Базовый адрес веб-приложения — из которого собираются ссылки для клиента.
 * @return {string}
 */
function cabinetBaseUrl_() {
  try {
    const url = ScriptApp.getService().getUrl();
    if (url) return url;
  } catch (e) {
    // Сервис недоступен (например, при запуске из редактора) — берём из настроек.
  }
  return 'https://script.google.com/macros/s/' + CONFIG.DEPLOYMENT_ID + '/exec';
}

/**
 * Ссылка на кабинет клиента.
 * @param {Object} object — строка листа «Объекты»
 * @return {string}
 */
function cabinetUrl_(object) {
  const id = str_(object['id']);
  const token = str_(object['токен']);
  if (!id || !token) return '';
  return cabinetBaseUrl_() + '?page=cabinet&id=' + encodeURIComponent(id) +
    '&token=' + encodeURIComponent(token);
}

/**
 * Текст о сроке действия кабинета — показывается клиенту в подвале страницы.
 * @param {Object} object
 * @return {string}
 */
function cabinetValidityText_(object) {
  const closed = isoDate_(object['закрыт']);
  if (!closed) return 'пока идут работы по объекту';
  const until = addDays_(closed, CONFIG.CABINET_DAYS_AFTER_CLOSE);
  return 'до ' + htmlDate_(until) + ' (объект закрыт)';
}

/**
 * Объект по данным ссылки кабинета. Без входа в приложение — проверка
 * строится на паре «идентификатор объекта + токен».
 * @param {Object} params — { id, token }
 * @return {Object} строка листа «Объекты»
 */
function cabinetRequireObject_(params) {
  const p = params || {};
  const id = str_(p.id);
  const token = str_(p.token);
  assert_(id && token, 'Ссылка неполная: не хватает данных объекта.', 'VALIDATION');

  const object = findRow_(CONFIG.SHEETS.OBJECTS, function (row) {
    return str_(row['id']) === id;
  });
  assert_(object, 'Объект не найден.', 'NOT_FOUND');
  assert_(str_(object['токен']) === token, 'Ссылка недействительна.', 'FORBIDDEN');
  assert_(bool_(object['кабинет']), 'Доступ в кабинет по этой ссылке закрыт.', 'FORBIDDEN');
  return object;
}

/**
 * HTML-страница кабинета клиента.
 * @param {Object} params — { id, token }
 * @return {HtmlOutput}
 */
function cabinetPage_(params) {
  let object = null;
  try {
    object = cabinetRequireObject_(params);
  } catch (err) {
    return htmlOut_(deadLinkPage_(err && err.message), { title: 'Ссылка недоступна' });
  }

  const data = reportData_(object);
  const html = cabinetHtml_(data, { revoke: cabinetValidityText_(object) });
  return htmlOut_(html, { title: 'Объект № ' + data.object.numberLabel + ' — кабинет клиента' });
}

/**
 * Состояние кабинета без изменений — для экрана управления ссылкой.
 * Отдельный маршрут нужен, чтобы простой просмотр ссылки не попадал
 * в журнал посещений как «открыл кабинет клиента».
 * @param {string} token — сессия мастера или руководителя
 * @param {string} id — объект
 * @return {Object} { enabled, url, object }
 */
function cabinetGet_(token, id) {
  requireSession_(token);
  const object = requireObject_(id);
  const enabled = bool_(object['кабинет']);
  return {
    enabled: enabled,
    url: enabled ? cabinetUrl_(object) : '',
    validity: cabinetValidityText_(object),
    object: objectView_(object)
  };
}

/**
 * Включение кабинета и выдача ссылки. Токен при необходимости создаётся заново.
 * @param {string} token — сессия мастера или руководителя
 * @param {string} id — объект
 * @return {Object} { ok, url, token, enabled }
 */
function cabinetLink_(token, id) {
  const session = requireSession_(token);
  const object = requireObject_(id);

  return withLock_(function () {
    const patch = { 'кабинет': 'да', 'обновлён': nowIso_() };
    if (!str_(object['токен'])) patch['токен'] = randomToken_(CONFIG.TOKEN_LENGTH);

    updateRow_(CONFIG.SHEETS.OBJECTS, object._row, patch);

    const fresh = requireObject_(id);
    logVisit_(session.name, session.role, 'открыл кабинет клиента по объекту ' + objectView_(fresh).title, {});

    return { ok: true, url: cabinetUrl_(fresh), token: str_(fresh['токен']), enabled: true };
  });
}

/**
 * Закрытие кабинета: ссылка перестаёт работать сразу.
 * Токен при этом меняется — если старую ссылку кто-то сохранил, она мертва.
 * @param {string} token — сессия
 * @param {string} id — объект
 * @return {Object}
 */
function cabinetRevoke_(token, id) {
  const session = requireSession_(token);
  const object = requireObject_(id);

  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.OBJECTS, object._row, {
      'кабинет': 'нет',
      'токен': randomToken_(CONFIG.TOKEN_LENGTH),
      'обновлён': nowIso_()
    });

    logVisit_(session.name, session.role, 'закрыл кабинет клиента по объекту ' + objectView_(object).title, {});
    return { ok: true, enabled: false };
  });
}

/**
 * Закрытие кабинетов у объектов, закрытых больше CABINET_DAYS_AFTER_CLOSE дней
 * назад. Вызывается по расписанию — чтобы старые ссылки не жили вечно.
 * @return {Object} { closed, items }
 */
function cabinetExpire_() {
  const limit = addDays_(todayIso_(), -CONFIG.CABINET_DAYS_AFTER_CLOSE);
  const items = [];

  readRows_(CONFIG.SHEETS.OBJECTS).forEach(function (row) {
    if (!bool_(row['кабинет'])) return;
    if (str_(row['статус']) !== CONFIG.STATUS_CLOSED) return;
    const closed = isoDate_(row['закрыт']);
    if (!closed || closed > limit) return;

    updateRow_(CONFIG.SHEETS.OBJECTS, row._row, {
      'кабинет': 'нет',
      'токен': randomToken_(CONFIG.TOKEN_LENGTH),
      'обновлён': nowIso_()
    });
    items.push(objectView_(row).numberLabel);
  });

  return { closed: items.length, items: items };
}
