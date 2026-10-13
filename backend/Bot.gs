/**
 * ============================================================================
 * Модуль: Bot
 * Ответственность: уведомления бригаде в Telegram — вечернее напоминание
 *                  «кто не записал день» и служебные сообщения. Ключ бота
 *                  и адрес чата хранятся в свойствах скрипта, а не в коде.
 *                  Модуль никогда не мешает основной работе: если Telegram
 *                  недоступен, всё просто логируется.
 * Зависимости: Config, Utils, Sessions, Users, Records, Cabinet
 * ============================================================================
 */

/**
 * Настройки Telegram из свойств скрипта.
 * @return {{token: string, chat: string}}
 */
function telegramConfig_() {
  const props = props_();
  return {
    token: str_(props.getProperty(CONFIG.TELEGRAM.TOKEN_PROP)),
    chat: str_(props.getProperty(CONFIG.TELEGRAM.CHAT_PROP))
  };
}

/**
 * Настроен ли бот.
 * @return {boolean}
 */
function telegramReady_() {
  const cfg = telegramConfig_();
  return !!(cfg.token && cfg.chat);
}

/**
 * Отправка сообщения в Telegram.
 * @param {string} text — текст в разметке HTML
 * @return {Object} { ok, reason?, description? }
 */
function telegramSend_(text) {
  const cfg = telegramConfig_();
  if (!cfg.token || !cfg.chat) {
    return { ok: false, reason: 'not_configured', description: 'Бот ещё не настроен.' };
  }

  const url = CONFIG.TELEGRAM.API_BASE + '/bot' + cfg.token + '/sendMessage';
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: cfg.chat,
        text: str_(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const body = jsonParse_(res.getContentText(), {});
    return {
      ok: code === 200 && !!(body && body.ok),
      code: code,
      description: body && body.description ? str_(body.description) : ''
    };
  } catch (e) {
    logError_('Bot.telegramSend_', e, {});
    return { ok: false, reason: 'network', description: e.message };
  }
}

/**
 * Проверка ключа бота — обращение к Telegram за сведениями о боте.
 * @param {string} token — ключ бота
 * @return {Object}
 */
function telegramCheckToken_(token) {
  const key = str_(token);
  if (!key) return { ok: false, description: 'Пустой ключ.' };
  try {
    const res = UrlFetchApp.fetch(CONFIG.TELEGRAM.API_BASE + '/bot' + key + '/getMe', {
      muteHttpExceptions: true
    });
    const body = jsonParse_(res.getContentText(), {});
    return {
      ok: res.getResponseCode() === 200 && !!(body && body.ok),
      username: body && body.result ? str_(body.result.username) : '',
      name: body && body.result ? str_(body.result.first_name) : '',
      description: body && body.description ? str_(body.description) : ''
    };
  } catch (e) {
    return { ok: false, description: e.message };
  }
}

/**
 * Состояние настроек уведомлений — для панели руководителя.
 * Сам ключ наружу не отдаём: только признак «задан».
 * @param {string} token
 * @return {Object}
 */
function botStatus_(token) {
  requireLeader_(token);
  const cfg = telegramConfig_();
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'dailyMaintenance';
  });

  return {
    configured: !!(cfg.token && cfg.chat),
    hasToken: !!cfg.token,
    chat: cfg.chat,
    reminderHour: CONFIG.TELEGRAM.REMINDER_HOUR,
    triggerInstalled: triggers.length > 0,
    timezone: Session.getScriptTimeZone()
  };
}

/**
 * Сохранение ключа бота и адреса чата.
 * @param {string} token — сессия руководителя
 * @param {Object} payload — { botToken, chatId }
 * @return {Object}
 */
function botSaveToken_(token, payload) {
  const session = requireLeader_(token);
  const p = payload || {};
  const botToken = str_(p.botToken).trim();
  const chatId = str_(p.chatId).trim();

  assert_(botToken || chatId, 'Укажите ключ бота или адрес чата.', 'VALIDATION');

  let check = null;
  if (botToken) {
    check = telegramCheckToken_(botToken);
    assert_(check.ok, 'Telegram не принял ключ: ' + (check.description || 'проверьте значение'), 'VALIDATION');
    props_().setProperty(CONFIG.TELEGRAM.TOKEN_PROP, botToken);
  }
  if (chatId) props_().setProperty(CONFIG.TELEGRAM.CHAT_PROP, chatId);

  logVisit_(session.name, session.role, 'настроил уведомления Telegram', {});
  return {
    ok: true,
    bot: check ? { username: check.username, name: check.name } : null,
    status: botStatus_(token)
  };
}

/**
 * Тестовое сообщение в чат.
 * @param {string} token
 * @return {Object}
 */
function botTest_(token) {
  const session = requireLeader_(token);
  const res = telegramSend_(
    '<b>Братство Электриков</b>\nСвязь с бригадой настроена.\nПроверка от ' + session.name + '.'
  );
  return { ok: res.ok, description: res.description || (res.ok ? 'Сообщение отправлено.' : 'Не удалось отправить.') };
}

/**
 * Сборка вечернего напоминания: сколько часов записано за день и кто отстал.
 * @param {string=} date
 * @return {string} текст в разметке HTML
 */
function reminderText_(date) {
  const day = isoDate_(date) || todayIso_();
  const summary = recordsOfDate_(day);
  const masters = allUsers_().filter(function (u) {
    return u.role === CONFIG.ROLE_MASTER && u.active;
  });

  const reported = {};
  summary.records.forEach(function (r) { reported[r.executor] = true; });

  const silent = masters.filter(function (u) { return !reported[u.name]; }).map(function (u) { return u.name; });
  const duplicates = summary.records.filter(function (r) { return r.duplicate; }).length;

  const lines = [
    '<b>Итоги дня ' + htmlDate_(day) + '</b>',
    'Часов записано: ' + htmlHours_(summary.hours),
    'Записей: ' + summary.records.length + ' · объектов: ' + summary.objectsTouched
  ];

  if (duplicates) lines.push('Повторных записей: ' + duplicates);
  if (silent.length) {
    lines.push('');
    lines.push('Не записали день: ' + silent.join(', '));
  } else if (masters.length) {
    lines.push('');
    lines.push('Все мастера отчитались.');
  }
  if (!summary.records.length) {
    lines.push('');
    lines.push('За сегодня записей нет вовсе.');
  }
  return lines.join('\n');
}

/**
 * Вечернее напоминание в Telegram.
 * @param {string=} date
 * @return {Object}
 */
function botRemind_(date) {
  if (!telegramReady_()) return { ok: false, reason: 'not_configured' };
  return telegramSend_(reminderText_(date));
}

/* ==========================================================================
 * Ежедневное обслуживание и триггеры
 * ======================================================================== */

/**
 * Ежедневная служебная работа: напоминание, закрытие старых кабинетов,
 * чистка истёкших сессий. Вешается на триггер по времени.
 * @return {Object} отчёт
 */
function dailyMaintenance() {
  const report = { время: nowIso_(), шаги: {} };

  try {
    report.шаги.напоминание = botRemind_();
  } catch (e) {
    logError_('Bot.dailyMaintenance', e, { шаг: 'напоминание' });
    report.шаги.напоминание = { ok: false, description: e.message };
  }

  try {
    report.шаги.кабинеты = cabinetExpire_();
  } catch (e) {
    logError_('Bot.dailyMaintenance', e, { шаг: 'кабинеты' });
    report.шаги.кабинеты = { closed: 0, error: e.message };
  }

  try {
    report.шаги.сессии = { удалено: cleanupSessions_() };
  } catch (e) {
    logError_('Bot.dailyMaintenance', e, { шаг: 'сессии' });
    report.шаги.сессии = { error: e.message };
  }

  console.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Постановка ежедневного триггера. Повторный вызов не создаёт дубликат.
 * @param {string=} token
 * @return {Object}
 */
function botInstallTriggers_(token) {
  if (token) requireLeader_(token);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased()
    .atHour(CONFIG.TELEGRAM.REMINDER_HOUR)
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  return { ok: true, hour: CONFIG.TELEGRAM.REMINDER_HOUR, timezone: Session.getScriptTimeZone() };
}

/**
 * Снятие ежедневного триггера.
 * @return {Object}
 */
function botRemoveTriggers_() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyMaintenance') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return { ok: true, removed: removed };
}

/**
 * Русский псевдоним — включить ежедневные напоминания из редактора.
 * @return {Object}
 */
function включитьНапоминания() {
  const r = botInstallTriggers_();
  console.log(JSON.stringify(r, null, 2));
  return r;
}
