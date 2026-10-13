/**
 * ============================================================================
 * Модуль: Code
 * Ответственность: точка входа веб-приложения (doGet/doPost), отдача HTML-страниц
 *                  (кабинет клиента, отчёты) и служебные функции для запуска
 *                  вручную из редактора Apps Script.
 * Зависимости: Config, Utils, Router, Sessions, Users, Prices, Visits, Statuses, DriveFiles
 * ============================================================================
 */

/**
 * GET-запрос.
 *   ?page=cabinet&token=…  — HTML-страница кабинета клиента
 *   ?page=report&…         — HTML-страница отчёта
 *   ?action=health         — API-запрос методом GET
 * @param {Object} e
 * @return {TextOutput|HtmlOutput}
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const page = str_(params.page);
  if (page) {
    try {
      return servePage_(page, params);
    } catch (err) {
      logError_('Code.doGet', err, { page: page });
      return htmlOut_(errorPage_(err.message), { title: 'Ошибка' });
    }
  }
  return handleRequest_(e);
}

/**
 * POST-запрос — основной канал API.
 * Тело: JSON { action, token, payload }.
 * @param {Object} e
 * @return {TextOutput}
 */
function doPost(e) {
  return handleRequest_(e);
}

/**
 * Отдача HTML-страниц. Модули страниц подключаются по мере сборки этапов,
 * поэтому наличие функции проверяется через typeof — отсутствие не ломает API.
 * @param {string} page
 * @param {Object} params
 * @return {HtmlOutput}
 */
function servePage_(page, params) {
  const name = str_(page).toLowerCase();
  if (name === 'cabinet' && typeof cabinetPage_ === 'function') {
    return cabinetPage_(params);
  }
  if (name === 'report' && typeof reportPage_ === 'function') {
    return reportPage_(params);
  }
  return htmlOut_(errorPage_('Страница «' + page + '» пока не подключена.'), { title: 'Братство Электриков' });
}

/**
 * Простая HTML-страница ошибки — без зависимостей.
 * @param {string} message
 * @return {string}
 */
function errorPage_(message) {
  return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Братство Электриков</title>' +
    '<style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    'margin:0;padding:32px 20px;background:#f4f6fa;color:#1b2333}' +
    '.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;' +
    'box-shadow:0 8px 24px rgba(20,35,70,.08)}h1{font-size:20px;margin:0 0 12px}' +
    'p{margin:0;color:#5a6478}</style></head><body><div class="card">' +
    '<h1>Братство Электриков</h1><p>' + String(message || '') + '</p></div></body></html>';
}

/* ==========================================================================
 * Служебные функции для ручного запуска в редакторе Apps Script
 * ======================================================================== */

/**
 * Проверка доступов. ЗАПУСКАТЬ ПЕРВОЙ — при первом запуске Google покажет
 * экран согласия, на котором нужно нажать «Разрешить».
 * Функция ничего не меняет: только читает таблицу, создаёт папки на Диске
 * и проверяет лимиты почты и внешних запросов.
 * @return {Object} отчёт
 */
function checkAccess() {
  const report = { шаг: 'проверка доступов', время: nowIso_(), результаты: {} };

  // 1. Google Таблицы
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    report.результаты.таблица = {
      статус: 'ок',
      название: ss.getName(),
      листов: ss.getSheets().length,
      листы: ss.getSheets().map(function (s) { return s.getName(); })
    };
  } catch (e) {
    report.результаты.таблица = { статус: 'ошибка', текст: e.message };
  }

  // 2. Google Диск
  try {
    report.результаты.диск = { статус: 'ок', папки: driveReport_() };
  } catch (e) {
    report.результаты.диск = { статус: 'ошибка', текст: e.message };
  }

  // 3. Внешние запросы (Telegram)
  try {
    const res = UrlFetchApp.fetch('https://api.telegram.org', { muteHttpExceptions: true });
    report.результаты.внешниеЗапросы = { статус: 'ок', код: res.getResponseCode() };
  } catch (e) {
    report.результаты.внешниеЗапросы = { статус: 'ошибка', текст: e.message };
  }

  // 4. Почта (ничего не отправляем, только смотрим лимит)
  try {
    report.результаты.почта = { статус: 'ок', остатокПисем: MailApp.getRemainingDailyQuota() };
  } catch (e) {
    report.результаты.почта = { статус: 'ошибка', текст: e.message };
  }

  // 5. Триггеры
  try {
    report.результаты.триггеры = { статус: 'ок', установлено: ScriptApp.getProjectTriggers().length };
  } catch (e) {
    report.результаты.триггеры = { статус: 'ошибка', текст: e.message };
  }

  // 6. Профиль пользователя
  try {
    report.результаты.профиль = { статус: 'ок', почта: Session.getActiveUser().getEmail() };
  } catch (e) {
    report.результаты.профиль = { статус: 'ошибка', текст: e.message };
  }

  report.итог = Object.keys(report.результаты).every(function (k) {
    return report.результаты[k].статус === 'ок';
  }) ? 'все доступы выданы' : 'есть замечания — см. выше';

  console.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Русский псевдоним проверки доступов — именно эту функцию выбирать в редакторе.
 * @return {Object}
 */
function проверкаДоступа() {
  return checkAccess();
}

/**
 * Проверка связи с фронтендом: то же, что отдаёт маршрут health.
 * @return {Object}
 */
function состояниеСистемы() {
  const r = healthReport_();
  console.log(JSON.stringify(r, null, 2));
  return r;
}
