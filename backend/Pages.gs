/**
 * ============================================================================
 * Модуль: Pages
 * Ответственность: серверная отрисовка самостоятельных HTML-страниц —
 *                  кабинета клиента и отчёта. Эти страницы открываются по
 *                  ссылке без входа в приложение, поэтому вся вёрстка и стили
 *                  собираются здесь, на сервере, без внешних зависимостей.
 *                  Цвета совпадают с токенами приложения (public/css/base.css).
 * Зависимости: Config, Utils
 * ============================================================================
 */

/** Палитра страниц — те же значения, что в токенах приложения. */
const PAGE_COLORS_ = {
  bg: '#f4f6fa',
  surface: '#ffffff',
  surface2: '#f8fafc',
  border: '#e2e7ef',
  text: '#16202e',
  muted: '#6b7688',
  primary: '#1657c4',
  primarySoft: '#e8effc',
  accent: '#f2a20c',
  accentSoft: '#fdf3e0',
  success: '#12946a',
  successSoft: '#e6f6f0',
  danger: '#d0402f',
  dangerSoft: '#fdecea',
  warning: '#b87600',
  warningSoft: '#fdf1dc'
};

/**
 * Экранирование текста для вставки в HTML.
 * @param {*} value
 * @return {string}
 */
function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Сумма в рублях: «12 500,00 ₽».
 * @param {number} value
 * @return {string}
 */
function htmlMoney_(value) {
  const n = Math.round((Number(value) || 0) * 100) / 100;
  const parts = n.toFixed(2).split('.');
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return int + ',' + parts[1] + '\u00A0₽';
}

/**
 * Часы: «8 ч» или «7,5 ч».
 * @param {number} value
 * @return {string}
 */
function htmlHours_(value) {
  const n = Number(value) || 0;
  return (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')) + '\u00A0ч';
}

/**
 * Дата из ISO: «14.10.2026».
 * @param {string} value
 * @return {string}
 */
function htmlDate_(value) {
  const iso = isoDate_(value);
  if (!iso) return '—';
  const p = iso.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

/**
 * Ссылка на изображение на Диске — превью шириной до 1000 px.
 * @param {string} fileId
 * @return {string}
 */
function driveImageUrl_(fileId) {
  const key = str_(fileId);
  return key ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(key) + '&sz=w1000' : '';
}

/**
 * Каркас страницы: заголовок, стили, шапка и подвал.
 * @param {string} title
 * @param {string} body — внутренний HTML
 * @param {Object=} options — { subtitle, printable, footer }
 * @return {string}
 */
function htmlShell_(title, body, options) {
  const o = options || {};
  const c = PAGE_COLORS_;
  const printButton = o.printable
    ? '<button class="btn btn--ghost no-print" type="button" onclick="window.print()">Сохранить в PDF</button>'
    : '';

  return '<!DOCTYPE html><html lang="ru"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="color-scheme" content="light">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>' + escapeHtml_(title) + '</title>' +
    '<style>' + pageStyles_(c) + '</style>' +
    '</head><body>' +
    '<header class="top">' +
    '<div class="top__brand">Братство Электриков</div>' +
    '<div class="top__title">' + escapeHtml_(title) + '</div>' +
    (o.subtitle ? '<div class="top__sub">' + escapeHtml_(o.subtitle) + '</div>' : '') +
    (printButton ? '<div class="top__actions">' + printButton + '</div>' : '') +
    '</header>' +
    '<main class="wrap">' + body + '</main>' +
    '<footer class="foot">' + escapeHtml_(o.footer || ('Сформировано ' + nowIso_().slice(0, 16).replace('T', ' '))) + '</footer>' +
    '</body></html>';
}

/**
 * Стили страниц. Собраны строкой, чтобы страница не зависела от внешних файлов.
 * @param {Object} c — палитра
 * @return {string}
 */
function pageStyles_(c) {
  return [
    ':root{color-scheme:light}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:' + c.bg + ';color:' + c.text + ';',
    'font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
    '.top{background:linear-gradient(135deg,' + c.primary + ',#0f3f92);color:#fff;padding:22px 18px 20px}',
    '.top__brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.75}',
    '.top__title{font-size:21px;font-weight:650;margin-top:6px;line-height:1.25}',
    '.top__sub{font-size:13px;opacity:.85;margin-top:6px}',
    '.top__actions{margin-top:14px}',
    '.wrap{max-width:840px;margin:0 auto;padding:18px 14px 40px}',
    '.foot{max-width:840px;margin:0 auto;padding:0 14px 36px;color:' + c.muted + ';font-size:12px}',
    '.card{background:' + c.surface + ';border:1px solid ' + c.border + ';border-radius:16px;',
    'padding:16px;margin-bottom:14px;box-shadow:0 1px 2px rgba(18,32,54,.05)}',
    '.card__title{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:' + c.muted + ';',
    'font-weight:650;margin:0 0 12px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.kv{background:' + c.surface2 + ';border-radius:12px;padding:10px 12px}',
    '.kv__k{font-size:11px;color:' + c.muted + ';text-transform:uppercase;letter-spacing:.05em}',
    '.kv__v{font-size:15px;font-weight:600;margin-top:3px;word-break:break-word}',
    '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
    '.stat{background:' + c.primarySoft + ';border-radius:12px;padding:12px}',
    '.stat__v{font-size:20px;font-weight:700;color:' + c.primary + '}',
    '.stat__k{font-size:12px;color:' + c.muted + ';margin-top:2px}',
    '.bar{height:8px;border-radius:99px;background:' + c.border + ';overflow:hidden;margin-top:12px}',
    '.bar__fill{height:100%;border-radius:99px;background:' + c.success + '}',
    'table{width:100%;border-collapse:collapse;font-size:14px}',
    'th,td{text-align:left;padding:8px 6px;border-bottom:1px solid ' + c.border + ';vertical-align:top}',
    'th{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:' + c.muted + ';font-weight:650}',
    'td.num,th.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
    'tr.total td{font-weight:700;border-top:2px solid ' + c.border + ';border-bottom:none}',
    '.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}',
    '.badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600}',
    '.badge--calc{background:' + c.primarySoft + ';color:' + c.primary + '}',
    '.badge--work{background:' + c.accentSoft + ';color:' + c.warning + '}',
    '.badge--closed{background:' + c.successSoft + ';color:' + c.success + '}',
    '.badge--dup{background:' + c.dangerSoft + ';color:' + c.danger + '}',
    '.empty{color:' + c.muted + ';font-size:14px;padding:8px 0}',
    '.buy{border:1px solid ' + c.border + ';border-radius:12px;padding:12px;margin-bottom:10px;background:' + c.surface2 + '}',
    '.buy__head{display:flex;justify-content:space-between;gap:10px;align-items:baseline}',
    '.buy__name{font-weight:600}',
    '.buy__sum{font-weight:700;white-space:nowrap}',
    '.buy__meta{font-size:13px;color:' + c.muted + ';margin-top:4px}',
    '.buy__photo{margin-top:10px}',
    '.buy__photo img{max-width:100%;border-radius:10px;border:1px solid ' + c.border + ';display:block}',
    '.buy__photo a{font-size:13px;color:' + c.primary + ';text-decoration:none}',
    '.btn{display:inline-block;border:0;border-radius:10px;padding:9px 14px;font-size:14px;font-weight:600;',
    'cursor:pointer;background:rgba(255,255,255,.16);color:#fff}',
    '.btn--ghost:hover{background:rgba(255,255,255,.28)}',
    '.note{font-size:13px;color:' + c.muted + ';margin-top:10px}',
    '@media print{body{background:#fff}.top{background:#fff;color:#000;border-bottom:2px solid #000}',
    '.top__brand,.top__sub{color:#444}.no-print{display:none!important}',
    '.card{box-shadow:none;break-inside:avoid}.buy{break-inside:avoid}}'
  ].join('');
}

/**
 * Бейдж статуса объекта.
 * @param {string} status
 * @return {string}
 */
function htmlStatusBadge_(status) {
  const s = str_(status);
  if (s === CONFIG.STATUS_CLOSED) return '<span class="badge badge--closed">работы закрыты</span>';
  if (s === CONFIG.STATUS_WORK) return '<span class="badge badge--work">в работе</span>';
  return '<span class="badge badge--calc">расчёт</span>';
}

/**
 * Блок «итоги» — одинаковый в кабинете и отчёте.
 * @param {Object} data — результат reportData_
 * @return {string}
 */
function htmlTotalsCard_(data) {
  const estimate = data.estimate;
  const totals = data.totals;
  const share = estimate.total > 0 ? Math.min(100, Math.round(totals.purchases / estimate.total * 100)) : 0;

  let html = '<section class="card"><h2 class="card__title">Итоги</h2><div class="stats">' +
    '<div class="stat"><div class="stat__v">' + htmlMoney_(estimate.total) + '</div>' +
    '<div class="stat__k">Итог расчёта</div></div>' +
    '<div class="stat"><div class="stat__v">' + htmlMoney_(totals.purchases) + '</div>' +
    '<div class="stat__k">Закуплено материалов</div></div>' +
    '<div class="stat"><div class="stat__v">' + htmlHours_(totals.hours) + '</div>' +
    '<div class="stat__k">Отработано часов</div></div>' +
    '</div>';

  if (estimate.total > 0) {
    html += '<div class="bar"><div class="bar__fill" style="width:' + share + '%"></div></div>' +
      '<div class="note">Материалы покрывают ' + share + '% суммы расчёта.</div>';
  }
  return html + '</section>';
}

/**
 * Блок «расчёт» — позиции и начисления.
 * @param {Object} estimate
 * @return {string}
 */
function htmlEstimateCard_(estimate) {
  let html = '<section class="card"><h2 class="card__title">Расчёт стоимости работ</h2>';

  if (!estimate.rows.length) {
    return html + '<div class="empty">Позиции расчёта пока не заполнены.</div></section>';
  }

  html += '<div class="scroll"><table><thead><tr>' +
    '<th>№</th><th>Наименование</th><th>Ед.</th><th class="num">Кол-во</th>' +
    '<th class="num">Коэф.</th><th class="num">Цена</th><th class="num">Сумма</th>' +
    '</tr></thead><tbody>';

  estimate.rows.forEach(function (row, index) {
    html += '<tr>' +
      '<td>' + (index + 1) + '</td>' +
      '<td>' + escapeHtml_(row.name || '—') + '</td>' +
      '<td>' + escapeHtml_(row.unit || '') + '</td>' +
      '<td class="num">' + (Number(row.qty) || 0) + '</td>' +
      '<td class="num">' + (Number(row.coeff) || 0) + '</td>' +
      '<td class="num">' + htmlMoney_(row.price) + '</td>' +
      '<td class="num">' + htmlMoney_(row.sum) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';

  html += '<div class="scroll" style="margin-top:12px"><table><tbody>' +
    '<tr><td>Работы (подытог)</td><td class="num">' + htmlMoney_(estimate.subtotal) + '</td></tr>';
  if (estimate.supply > 0) {
    html += '<tr><td>Снабжение материалом</td><td class="num">' + htmlMoney_(estimate.supply) + '</td></tr>';
  }
  if (estimate.commissioning > 0) {
    html += '<tr><td>Пусконаладка</td><td class="num">' + htmlMoney_(estimate.commissioning) + '</td></tr>';
  }
  if (estimate.discount > 0) {
    html += '<tr><td>Скидка</td><td class="num">−' + htmlMoney_(estimate.discount) + '</td></tr>';
  }
  html += '<tr class="total"><td>ИТОГО</td><td class="num">' + htmlMoney_(estimate.total) + '</td></tr>' +
    '</tbody></table></div></section>';

  return html;
}

/**
 * Блок «журнал работ».
 * @param {Object} data
 * @return {string}
 */
function htmlDaysCard_(data) {
  let html = '<section class="card"><h2 class="card__title">Журнал работ</h2>';
  if (!data.days.length) {
    return html + '<div class="empty">Записи журнала отсутствуют.</div></section>';
  }

  html += '<div class="scroll"><table><thead><tr>' +
    '<th>Дата</th><th>Исполнитель</th><th class="num">Часы</th><th>Что сделано</th>' +
    '</tr></thead><tbody>';

  data.days.forEach(function (day) {
    html += '<tr>' +
      '<td>' + htmlDate_(day.date) + '</td>' +
      '<td>' + escapeHtml_(day.executor || '—') + '</td>' +
      '<td class="num">' + htmlHours_(day.hours) + '</td>' +
      '<td>' + escapeHtml_(day.work || '') +
      (day.duplicate ? ' <span class="badge badge--dup">дубль</span>' : '') + '</td>' +
      '</tr>';
  });

  html += '</tbody><tfoot><tr class="total"><td colspan="2">Всего</td>' +
    '<td class="num">' + htmlHours_(data.totals.hours) + '</td><td></td></tr></tfoot></table></div></section>';
  return html;
}

/**
 * Блок «закупки» — с фотографиями накладных.
 * @param {Object} data
 * @return {string}
 */
function htmlPurchasesCard_(data) {
  let html = '<section class="card"><h2 class="card__title">Закупки материалов</h2>';
  if (!data.purchases.length) {
    return html + '<div class="empty">Закупки пока не зафиксированы.</div></section>';
  }

  data.purchases.forEach(function (item) {
    html += '<div class="buy">' +
      '<div class="buy__head">' +
      '<div class="buy__name">' + escapeHtml_(item.material || '—') + '</div>' +
      '<div class="buy__sum">' + htmlMoney_(item.sum) + '</div>' +
      '</div>' +
      '<div class="buy__meta">' + htmlDate_(item.date) + ' · ' +
      (Number(item.qty) || 0) + ' ' + escapeHtml_(item.unit || '') +
      ' × ' + htmlMoney_(item.price) + '</div>' +
      (item.comment ? '<div class="buy__meta">' + escapeHtml_(item.comment) + '</div>' : '');

    // Накладных может быть несколько — показываем все.
    const photos = Array.isArray(item.photos) && item.photos.length
      ? item.photos
      : (item.photo ? [{ link: item.photo, id: item.photoId }] : []);

    photos.forEach(function (photo) {
      const imageUrl = driveImageUrl_(photo.id) || str_(photo.link);
      if (!imageUrl) return;
      html += '<div class="buy__photo">' +
        '<a href="' + escapeHtml_(imageUrl) + '" target="_blank" rel="noopener">' +
        '<img src="' + escapeHtml_(imageUrl) + '" alt="Фото накладной" loading="lazy">' +
        '</a></div>';
    });

    html += '</div>';
  });

  html += '<div class="scroll"><table><tbody><tr class="total"><td>Всего закуплено</td>' +
    '<td class="num">' + htmlMoney_(data.totals.purchases) + '</td></tr></tbody></table></div></section>';
  return html;
}

/**
 * Блок с реквизитами объекта.
 * @param {Object} view — objectView_
 * @return {string}
 */
function htmlObjectCard_(view) {
  const rows = [
    ['Объект', escapeHtml_('№ ' + view.numberLabel + ' ' + (view.title || ''))],
    ['Клиент', escapeHtml_(view.client || '—')],
    ['Адрес', escapeHtml_(view.address || '—')],
    ['Телефон', escapeHtml_(view.phone || '—')],
    ['Статус', htmlStatusBadge_(view.status)],
    ['Начат', htmlDate_(view.created)],
    ['Закрыт', view.closed ? htmlDate_(view.closed) : '—']
  ];

  let html = '<section class="card"><h2 class="card__title">Объект</h2><div class="grid">';
  rows.forEach(function (pair) {
    html += '<div class="kv"><div class="kv__k">' + escapeHtml_(pair[0]) + '</div>' +
      '<div class="kv__v">' + pair[1] + '</div></div>';
  });
  return html + '</div></section>';
}

/**
 * Полная страница кабинета клиента.
 * @param {Object} data — результат reportData_
 * @param {Object=} options — { revoke }
 * @return {string}
 */
function cabinetHtml_(data, options) {
  const o = options || {};
  const view = data.object;

  const body = htmlObjectCard_(view) +
    htmlTotalsCard_(data) +
    htmlEstimateCard_(data.estimate) +
    htmlDaysCard_(data) +
    htmlPurchasesCard_(data);

  return htmlShell_('Объект № ' + view.numberLabel, body, {
    subtitle: view.title || '',
    printable: true,
    footer: o.revoke
      ? 'Ссылка на кабинет действует ' + o.revoke + '. Вопросы — по телефону бригады.'
      : null
  });
}

/**
 * Полная страница отчёта — та же информация, но с акцентом на печать.
 * @param {Object} data — результат reportData_
 * @param {boolean=} printable — показывать кнопку сохранения в PDF
 * @return {string}
 */
function reportHtml_(data, printable) {
  const view = data.object;
  const body = htmlObjectCard_(view) +
    htmlTotalsCard_(data) +
    htmlEstimateCard_(data.estimate) +
    htmlDaysCard_(data) +
    htmlPurchasesCard_(data);

  return htmlShell_('Отчёт по объекту № ' + view.numberLabel, body, {
    subtitle: view.title || '',
    printable: printable !== false,
    footer: 'Фотографии накладных хранятся на Google Диске и доступны по ссылке в кабинете.'
  });
}

/**
 * Страница «ссылка недействительна» — для кабинета и отчёта.
 * @param {string} reason
 * @return {string}
 */
function deadLinkPage_(reason) {
  return htmlShell_('Ссылка недоступна',
    '<section class="card"><div class="empty">' +
    escapeHtml_(reason || 'Эта ссылка больше не действует.') +
    '</div></section>',
    { footer: 'Братство Электриков' });
}
