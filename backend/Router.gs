/**
 * ============================================================================
 * Модуль: Router
 * Ответственность: таблица маршрутов API, разбор запроса, проверка прав,
 *                  единая обработка ошибок. Все обработчики — тонкие: логика в модулях.
 * Зависимости: Config, Utils, Sessions, Users, Prices, Visits, Statuses,
 *              Objects, Calc, Records, Purchases, Photos, Archive, Cabinet,
 *              Report, Analytics, Bot, Pages
 * ============================================================================
 */

/**
 * Таблица маршрутов.
 * auth: 'none' — без входа, 'user' — нужна сессия, 'leader' — только руководитель.
 * handler(ctx, session) — возвращает данные (будут обёрнуты в ok_) либо
 *                          { __raw: true, response: <TextOutput|HtmlOutput> }.
 */
const ROUTES_ = {
  /* --- Служебные --- */

  'health': {
    auth: 'none',
    handler: function () {
      return healthReport_();
    }
  },

  /* --- Пакет данных для экранов разделов --- */

  'data.bundle': {
    auth: 'user',
    handler: function (ctx, session) {
      return dataBundle_(ctx.token, session, ctx.payload || {});
    }
  },

  /* --- Первичная инициализация таблицы --- */

  'setup.status': {
    auth: 'none',
    handler: function () {
      return setupStatus_();
    }
  },

  'setup.init': {
    auth: 'none',
    handler: function (ctx) {
      // Первичная инициализация разрешена без входа только пока в таблице
      // нет ни одного профиля. Дальше — исключительно руководитель.
      const state = setupStatus_();
      if (!state.bootstrapAllowed) requireLeader_(ctx.token);
      return setupInit_();
    }
  },

  /* --- Вход и профиль --- */

  'auth.login': {
    auth: 'none',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return loginUser_(p.name, p.code, requestMeta_(ctx.event));
    }
  },

  'auth.logout': {
    auth: 'user',
    handler: function (ctx) {
      return logoutUser_(ctx.token);
    }
  },

  'auth.me': {
    auth: 'user',
    handler: function (ctx) {
      return currentUser_(ctx.token);
    }
  },

  'auth.changeCode': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return changeOwnCode_(ctx.token, p.oldCode, p.newCode);
    }
  },

  /* --- Пользователи (руководитель) --- */

  'users.list': {
    auth: 'leader',
    handler: function (ctx) {
      return listUsersForLeader_(ctx.token);
    }
  },

  'users.setCode': {
    auth: 'leader',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return setUserCode_(ctx.token, p.id, p.code);
    }
  },

  'users.setActive': {
    auth: 'leader',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return setUserActive_(ctx.token, p.id, p.active);
    }
  },

  'users.syncCodes': {
    auth: 'leader',
    handler: function (ctx) {
      requireLeader_(ctx.token);
      return { ok: true, count: syncCodesSheet_() };
    }
  },

  /* --- Прайс --- */

  'prices.list': {
    auth: 'none',
    handler: function () {
      return listPrices_();
    }
  },

  'prices.search': {
    auth: 'none',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return { items: searchPrices_(p.query, p.limit) };
    }
  },

  'prices.update': {
    auth: 'leader',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return updatePrice_(ctx.token, p.id, p.price);
    }
  },

  /* --- Посещения --- */

  'visits.log': {
    auth: 'none',
    handler: function (ctx) {
      const p = ctx.payload || {};
      logVisit_(p.user || 'гость', p.role || '', p.action || 'просмотр', requestMeta_(ctx.event));
      return { ok: true };
    }
  },

  'visits.list': {
    auth: 'leader',
    handler: function (ctx) {
      return listVisits_(ctx.token, (ctx.payload || {}).limit);
    }
  },

  'visits.summary': {
    auth: 'leader',
    handler: function (ctx) {
      return visitsSummary_(ctx.token, (ctx.payload || {}).days);
    }
  },

  /* --- Статусы очереди --- */

  'statuses.set': {
    auth: 'user',
    handler: function (ctx) {
      return setStatus_(ctx.token, ctx.payload || {});
    }
  },

  'statuses.list': {
    auth: 'leader',
    handler: function (ctx) {
      return listStatuses_(ctx.token);
    }
  },

  'statuses.clear': {
    auth: 'user',
    handler: function (ctx) {
      return clearStatus_(ctx.token);
    }
  },

  /* --- Объекты --- */

  'objects.list': {
    auth: 'user',
    handler: function (ctx) {
      return listObjects_(ctx.token, ctx.payload || {});
    }
  },

  'objects.get': {
    auth: 'user',
    handler: function (ctx) {
      return getObjectCard_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'objects.create': {
    auth: 'user',
    handler: function (ctx) {
      return createObject_(ctx.token, ctx.payload || {});
    }
  },

  'objects.update': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return updateObject_(ctx.token, p.id, p);
    }
  },

  'objects.setStatus': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return setObjectStatus_(ctx.token, p.id, p.status);
    }
  },

  'objects.remove': {
    auth: 'leader',
    handler: function (ctx) {
      return removeObject_(ctx.token, (ctx.payload || {}).id);
    }
  },

  /* --- Расчёт --- */

  'calc.get': {
    auth: 'user',
    handler: function (ctx) {
      return calcGet_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'calc.save': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return calcSave_(ctx.token, p.id, p.payload || {});
    }
  },

  /* --- Журнал дней --- */

  'days.list': {
    auth: 'user',
    handler: function (ctx) {
      return daysList_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'days.add': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return addDay_(ctx.token, p.id, p.day || {});
    }
  },

  'days.remove': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return daysRemove_(ctx.token, p.id, p.rowId);
    }
  },

  'days.today': {
    auth: 'leader',
    handler: function (ctx) {
      return todayRecords_(ctx.token, (ctx.payload || {}).date);
    }
  },

  /* --- Закупки --- */

  'purchases.list': {
    auth: 'user',
    handler: function (ctx) {
      return purchasesList_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'purchases.add': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return addPurchase_(ctx.token, p.id, p.purchase || {});
    }
  },

  'purchases.remove': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return removePurchase_(ctx.token, p.id, p.rowId);
    }
  },

  /* --- Фотографии накладных --- */

  'photos.upload': {
    auth: 'user',
    handler: function (ctx) {
      return photoUpload_(ctx.token, ctx.payload || {});
    }
  },

  /* --- Закрытие и архив --- */

  'objects.close': {
    auth: 'user',
    handler: function (ctx) {
      return closeObject_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'objects.restore': {
    auth: 'user',
    handler: function (ctx) {
      return restoreObject_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'archive.list': {
    auth: 'leader',
    handler: function (ctx) {
      return archivesList_(ctx.token);
    }
  },

  'archive.cleanup': {
    auth: 'leader',
    handler: function (ctx) {
      return archiveCleanup_(ctx.token, (ctx.payload || {}).archiveId);
    }
  },

  /* --- Кабинет клиента --- */

  'cabinet.link': {
    auth: 'user',
    handler: function (ctx) {
      return cabinetLink_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'cabinet.get': {
    auth: 'user',
    handler: function (ctx) {
      return cabinetGet_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'cabinet.revoke': {
    auth: 'user',
    handler: function (ctx) {
      return cabinetRevoke_(ctx.token, (ctx.payload || {}).id);
    }
  },

  'cabinet.expire': {
    auth: 'leader',
    handler: function (ctx) {
      requireLeader_(ctx.token);
      return cabinetExpire_();
    }
  },

  /* --- Отчёты --- */

  'report.link': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return reportLink_(ctx.token, p.id);
    }
  },

  'report.pdf': {
    auth: 'user',
    handler: function (ctx) {
      requireSession_(ctx.token);
      const object = requireObject_((ctx.payload || {}).id);
      return buildReportPdf_(object);
    }
  },

  'report.send': {
    auth: 'user',
    handler: function (ctx) {
      const p = ctx.payload || {};
      return reportSend_(ctx.token, p.id, p.contact);
    }
  },

  /* --- Аналитика (руководитель) --- */

  'analytics.summary': {
    auth: 'leader',
    handler: function (ctx) {
      return analyticsSummary_(ctx.token, ctx.payload || {});
    }
  },

  'analytics.days': {
    auth: 'leader',
    handler: function (ctx) {
      return analyticsDays_(ctx.token, ctx.payload || {});
    }
  },

  /* --- Уведомления в Telegram --- */

  'bot.status': {
    auth: 'leader',
    handler: function (ctx) {
      return botStatus_(ctx.token);
    }
  },

  'bot.saveToken': {
    auth: 'leader',
    handler: function (ctx) {
      return botSaveToken_(ctx.token, ctx.payload || {});
    }
  },

  'bot.test': {
    auth: 'leader',
    handler: function (ctx) {
      return botTest_(ctx.token);
    }
  },

  'bot.install': {
    auth: 'leader',
    handler: function (ctx) {
      return botInstallTriggers_(ctx.token);
    }
  },

  'bot.remove': {
    auth: 'leader',
    handler: function (ctx) {
      return botRemoveTriggers_();
    }
  },

  'bot.remind': {
    auth: 'leader',
    handler: function (ctx) {
      requireLeader_(ctx.token);
      return botRemind_((ctx.payload || {}).date);
    }
  }
};

/**
 * Разбор входящего запроса в единый контекст.
 * Поддерживаются POST с JSON-телом и GET с параметрами в строке запроса.
 * @param {Object} e — событие Apps Script
 * @return {Object} контекст
 */
function parseRequest_(e) {
  let body = {};
  if (e && e.postData && e.postData.contents) {
    body = jsonParse_(e.postData.contents, {});
    if (typeof body === 'string') body = { action: body };
  }
  const params = (e && e.parameter) || {};
  return {
    action: str_(body.action || params.action || 'health'),
    token: str_(body.token || params.token || ''),
    payload: body.payload || params.payload || {},
    params: params,
    event: e
  };
}

/**
 * Метаданные запроса для журнала посещений.
 * @param {Object} e
 * @return {Object}
 */
function requestMeta_(e) {
  const params = (e && e.parameter) || {};
  const headers = (e && e.headers) || {};
  return {
    ip: str_(headers['X-Forwarded-For'] || headers['x-forwarded-for'] || ''),
    device: truncate_(str_(headers['User-Agent'] || headers['user-agent'] || params.ua || ''), 160)
  };
}

/**
 * Обработка API-запроса: маршрутизация, права, ошибки.
 * @param {Object} e
 * @return {TextOutput}
 */
function handleRequest_(e) {
  let ctx = null;
  try {
    ctx = parseRequest_(e);
    const route = ROUTES_[ctx.action];
    if (!route) {
      return fail_('Неизвестное действие: ' + ctx.action, 'NO_ROUTE');
    }

    let session = null;
    if (route.auth === 'user') session = requireSession_(ctx.token);
    if (route.auth === 'leader') session = requireLeader_(ctx.token);

    const result = route.handler(ctx, session);
    if (result && result.__raw && result.response) return result.response;
    return ok_(result);
  } catch (err) {
    logError_('Router.handleRequest_', err, { action: ctx ? ctx.action : '?' });
    return fail_(err && err.message ? err.message : 'Внутренняя ошибка сервера', (err && err.apiCode) || 'ERROR');
  }
}

/**
 * Короткий отчёт о состоянии системы — используется фронтендом для проверки связи.
 * @return {Object}
 */
function healthReport_() {
  const ss = ss_();
  const existing = {};
  const headers = {};
  ss.getSheets().forEach(function (sh) {
    existing[sh.getName()] = sh.getLastRow();
    // Шапку показываем только у реестров: она нужна при разборе расхождений
    // между схемой и таблицей.
    if (SCHEMA[sh.getName()] && sh.getLastRow() > 0 && sh.getLastColumn() > 0) {
      headers[sh.getName()] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(str_);
    }
  });

  const expected = [
    CONFIG.SHEETS.PRICES,
    CONFIG.SHEETS.USERS,
    CONFIG.SHEETS.CODES,
    CONFIG.SHEETS.OBJECTS,
    CONFIG.SHEETS.VISITS,
    CONFIG.SHEETS.STATUSES
  ];

  const missing = expected.filter(function (name) { return !(name in existing); });

  return {
    app: 'Братство Электриков v2',
    version: '2.0.0',
    time: nowIso_(),
    spreadsheet: ss.getName(),
    sheets: existing,
    headers: headers,
    missingSheets: missing,
    initialized: missing.length === 0,
    users: readRows_(CONFIG.SHEETS.USERS).length,
    prices: readRows_(CONFIG.SHEETS.PRICES).length
  };
}
