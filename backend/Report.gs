/**
 * ============================================================================
 * Модуль: Report
 * Ответственность: отчёт клиенту — сбор данных объекта (расчёт, журнал дней,
 *                  закупки), ссылка на HTML-страницу отчёта, PDF-файл на Диске
 *                  и отправка письмом.
 *
 *                  PDF собирается в отдельной временной Google Таблице и
 *                  экспортируется в PDF. Так отчёт обходится уже выданными
 *                  разрешениями (Таблицы + Диск) и не требует дополнительного
 *                  согласия на доступ к Google Документам.
 *
 * Зависимости: Config, Utils, Sheets, Objects, Calc, Sessions, DriveFiles,
 *              Cabinet, Pages
 * ============================================================================
 */

/**
 * Сбор данных отчёта по объекту.
 * @param {Object} object — строка листа «Объекты»
 * @return {Object}
 */
function reportData_(object) {
  const view = objectView_(object);
  const estimate = getEstimateOf_(object);
  const sheetName = str_(object['лист']);

  const days = withObjectSheet_(object, function () {
    return sheetName ? readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.DAY).map(dayView_) : [];
  });
  days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  const purchases = withObjectSheet_(object, function () {
    return sheetName ? readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE).map(purchaseView_) : [];
  });
  purchases.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  const hours = round2_(days.reduce(function (acc, d) { return acc + num_(d.hours, 0); }, 0));
  const purchasesSum = round2_(purchases.reduce(function (acc, p) { return acc + num_(p.sum, 0); }, 0));

  // Клиент платит за материалы с наценкой: без неё итог в отчёте был меньше,
  // чем в приложении. Считаем от суммы строк листа, а не от колонки реестра.
  const markup = markupOf_(object, purchasesSum);
  const materials = round2_(purchasesSum + markup);
  const estimateTotal = round2_(num_(estimate.total, 0));

  return {
    object: view,
    estimate: estimate,
    days: days,
    purchases: purchases,
    totals: {
      hours: hours,
      // purchases — «голые» закупки, materials — они же с наценкой.
      purchases: purchasesSum,
      markup: markup,
      materials: materials,
      estimate: estimateTotal,
      // Столько клиент платит всего: работы по смете + материалы с наценкой.
      grand: round2_(estimateTotal + materials),
      positions: estimate.positions
    },
    generated: nowIso_()
  };
}

/**
 * Ссылка на отчёт по объекту.
 * @param {string} token
 * @param {string} id
 * @return {Object} { url, cabinetUrl, token }
 */
function reportLink_(token, id) {
  requireSession_(token);
  const object = requireObject_(id);
  return {
    // Отчёт открывается на сайте так же, как кабинет: короткий адрес с токеном.
    url: reportUrl_(object),
    cabinetUrl: cabinetUrl_(object),
    token: str_(object['токен'])
  };
}

/**
 * Данные страницы отчёта для сайта — без входа, по одному токену.
 * Набор тот же, что у кабинета: отчёт и кабинет показывают одни и те же
 * смету, дни и закупки, разница только в заголовке экрана.
 * @param {string} token
 * @return {Object}
 */
function reportPublicData_(token) {
  const object = cabinetRequireByToken_(token);
  const data = reportData_(object);
  data.validity = cabinetValidityText_(object);
  return data;
}

/* --------------------------------------------------------------------------
 * Оформление отчёта
 * ------------------------------------------------------------------------ */

/** Оформление строк отчёта. Один набор — и в PDF, и в предпросмотре. */
const REPORT_STYLE_ = {
  title: { size: 18, bold: true, color: '#16202e' },
  subtitle: { size: 13, bold: true, color: '#1657c4' },
  meta: { size: 9, color: '#6b7688' },
  section: { size: 11, bold: true, color: '#1657c4', bg: '#e8effc' },
  head: { size: 9, bold: true, color: '#ffffff', bg: '#1657c4' },
  cell: { size: 9.5, color: '#16202e', border: '#e2e7ef', wrap: true },
  strong: { size: 9.5, bold: true, color: '#16202e', border: '#e2e7ef' },
  total: { size: 10, bold: true, color: '#16202e', bg: '#f8fafc' },
  note: { size: 8.5, italic: true, color: '#6b7688' },
  gap: { size: 6 }
};

/** Ширина колонок отчёта, px. Сумма подобрана под лист A4 в портретной ориентации. */
const REPORT_COLUMNS_ = [40, 230, 62, 72, 60, 96, 106];

/**
 * Нанесение оформления на диапазон.
 * @param {Range} range
 * @param {Object} style
 */
function applySheetStyle_(range, style) {
  if (!style) return;
  if (style.size) range.setFontSize(style.size);
  range.setFontWeight(style.bold ? 'bold' : 'normal');
  range.setFontStyle(style.italic ? 'italic' : 'normal');
  range.setFontColor(style.color || '#16202e');
  if (style.bg) range.setBackground(style.bg);
  range.setVerticalAlignment('middle');
  if (style.align) range.setHorizontalAlignment(style.align);
  if (style.wrap) range.setWrap(true);
  if (style.border) {
    range.setBorder(null, null, true, null, null, null, style.border, SpreadsheetApp.BorderStyle.SOLID);
  }
}

/**
 * Запись строки отчёта.
 * @param {Sheet} sh
 * @param {number} row
 * @param {Array<*>} values — значения слева направо
 * @param {Object=} style
 * @param {Array<number>=} spans — сколько колонок занимает каждое значение
 * @return {number} номер следующей свободной строки
 */
function sheetPut_(sh, row, values, style, spans) {
  const widths = spans || values.map(function () { return 1; });
  let col = 1;

  values.forEach(function (value, index) {
    const span = widths[index] || 1;
    const range = sh.getRange(row, col, 1, span);
    const text = value === undefined || value === null ? '' : value;

    // Текст, начинающийся с «=», «+», «-» или «@», Google принимает
    // за формулу и пишет #ERROR! — записываем через общий помощник.
    range.setValue(cellValue_(text));
    applySheetStyle_(range, style);
    if (span > 1) range.merge();
    col += span;
  });

  // Хвост строки тоже получает фон — иначе полоса выглядит обрезанной.
  if (col <= REPORT_COLUMNS_.length && style && style.bg) {
    sh.getRange(row, col, 1, REPORT_COLUMNS_.length - col + 1).setBackground(style.bg);
  }
  return row + 1;
}

/**
 * Денежный формат для ячейки листа.
 * @param {number} value
 * @return {string}
 */
function sheetMoney_(value) {
  const n = Math.round((Number(value) || 0) * 100) / 100;
  return n.toFixed(2).replace('.', ',') + ' ₽';
}

/**
 * Наполнение листа отчёта.
 * @param {Sheet} sh
 * @param {Object} data — результат reportData_
 */
function fillReportSheet_(sh, data) {
  const view = data.object;
  const estimate = data.estimate;

  sh.setHiddenGridlines(true);
  REPORT_COLUMNS_.forEach(function (width, index) {
    sh.setColumnWidth(index + 1, width);
  });

  const full = [REPORT_COLUMNS_.length];
  let row = 1;

  /* --- Шапка --- */
  sh.setRowHeight(row, 30);
  row = sheetPut_(sh, row, ['Братство Электриков'], REPORT_STYLE_.title, full);

  sh.setRowHeight(row, 22);
  row = sheetPut_(sh, row,
    ['Отчёт по объекту № ' + view.numberLabel + (view.title ? ' — ' + view.title : '')],
    REPORT_STYLE_.subtitle, full);

  row = sheetPut_(sh, row, ['Сформирован ' + htmlDate_(nowIso_()) + ' · ' + CONFIG.APP_TITLE],
    REPORT_STYLE_.meta, full);
  row = sheetPut_(sh, row, [''], REPORT_STYLE_.gap, full);

  /* --- Реквизиты --- */
  row = sheetPut_(sh, row, ['ОБЪЕКТ'], REPORT_STYLE_.section, full);
  // Реквизиты выравниваем по левому краю: даты и суммы Google иначе
  // прижимает вправо, и строки выглядят рвано.
  const cellLeft = Object.assign({}, REPORT_STYLE_.cell, { align: 'left' });
  [
    ['Клиент', view.client || '—'],
    ['Адрес', view.address || '—'],
    ['Телефон', view.phone || '—'],
    ['Статус', view.status === CONFIG.STATUS_CLOSED ? 'работы закрыты'
      : (view.status === CONFIG.STATUS_WORK ? 'в работе' : 'расчёт')],
    ['Начат', htmlDate_(view.created)],
    ['Закрыт', view.closed ? htmlDate_(view.closed) : '—']
  ].forEach(function (pair) {
    row = sheetPut_(sh, row, [pair[0], pair[1]], cellLeft, [2, 5]);
  });
  row = sheetPut_(sh, row, [''], REPORT_STYLE_.gap, full);

  /* --- Расчёт --- */
  row = sheetPut_(sh, row, ['РАСЧЁТ СТОИМОСТИ РАБОТ'], REPORT_STYLE_.section, full);

  if (estimate.rows.length) {
    row = sheetPut_(sh, row,
      ['№', 'Наименование', 'Ед.', 'Кол-во', 'Коэф.', 'Цена', 'Сумма'],
      REPORT_STYLE_.head, [1, 1, 1, 1, 1, 1, 1]);

    estimate.rows.forEach(function (item, index) {
      row = sheetPut_(sh, row, [
        String(index + 1),
        item.name || '—',
        item.unit || '',
        String(item.qty),
        String(item.coeff),
        sheetMoney_(item.price),
        sheetMoney_(item.sum)
      ], REPORT_STYLE_.cell, [1, 1, 1, 1, 1, 1, 1]);
    });

    row = sheetPut_(sh, row, ['Работы (подытог)', sheetMoney_(estimate.subtotal)],
      REPORT_STYLE_.total, [6, 1]);
    if (estimate.supply > 0) {
      row = sheetPut_(sh, row, ['Снабжение материалом', sheetMoney_(estimate.supply)],
        REPORT_STYLE_.total, [6, 1]);
    }
    if (estimate.commissioning > 0) {
      row = sheetPut_(sh, row, ['Пусконаладка', sheetMoney_(estimate.commissioning)],
        REPORT_STYLE_.total, [6, 1]);
    }
    if (estimate.discount > 0) {
      row = sheetPut_(sh, row, ['Скидка', '−' + sheetMoney_(estimate.discount)],
        REPORT_STYLE_.total, [6, 1]);
    }
    row = sheetPut_(sh, row, ['ИТОГО', sheetMoney_(estimate.total)],
      REPORT_STYLE_.head, [6, 1]);
  } else {
    row = sheetPut_(sh, row, ['Позиции расчёта не заполнены.'], REPORT_STYLE_.cell, full);
  }
  row = sheetPut_(sh, row, [''], REPORT_STYLE_.gap, full);

  /* --- Журнал работ --- */
  row = sheetPut_(sh, row, ['ЖУРНАЛ РАБОТ'], REPORT_STYLE_.section, full);

  if (data.days.length) {
    row = sheetPut_(sh, row, ['Дата', 'Исполнитель', 'Часы', 'Что сделано'],
      REPORT_STYLE_.head, [1, 2, 1, 3]);

    data.days.forEach(function (day) {
      row = sheetPut_(sh, row, [
        htmlDate_(day.date),
        day.executor || '—',
        htmlHours_(day.hours),
        (day.work || '') + (day.duplicate ? '  (повторная запись)' : '')
      ], REPORT_STYLE_.cell, [1, 2, 1, 3]);
    });

    row = sheetPut_(sh, row, ['Всего часов', htmlHours_(data.totals.hours)],
      REPORT_STYLE_.total, [6, 1]);
  } else {
    row = sheetPut_(sh, row, ['Записи журнала отсутствуют.'], REPORT_STYLE_.cell, full);
  }
  row = sheetPut_(sh, row, [''], REPORT_STYLE_.gap, full);

  /* --- Закупки --- */
  row = sheetPut_(sh, row, ['ЗАКУПКИ МАТЕРИАЛОВ'], REPORT_STYLE_.section, full);

  if (data.purchases.length) {
    row = sheetPut_(sh, row, ['Дата', 'Материал', 'Ед.', 'Кол-во', '', 'Цена', 'Сумма'],
      REPORT_STYLE_.head, [1, 1, 1, 1, 1, 1, 1]);

    data.purchases.forEach(function (item) {
      row = sheetPut_(sh, row, [
        htmlDate_(item.date),
        (item.material || '—') + (item.comment ? ' · ' + item.comment : ''),
        item.unit || '',
        String(item.qty),
        '',
        sheetMoney_(item.price),
        sheetMoney_(item.sum)
      ], REPORT_STYLE_.cell, [1, 1, 1, 1, 1, 1, 1]);
    });

    row = sheetPut_(sh, row, ['Всего закуплено', sheetMoney_(data.totals.purchases)],
      REPORT_STYLE_.total, [6, 1]);
    if (data.totals.markup > 0) {
      row = sheetPut_(sh, row, ['Наценка на материал', sheetMoney_(data.totals.markup)],
        REPORT_STYLE_.total, [6, 1]);
      row = sheetPut_(sh, row, ['Итого за материалы', sheetMoney_(data.totals.materials)],
        REPORT_STYLE_.total, [6, 1]);
    }
  } else {
    row = sheetPut_(sh, row, ['Закупки не зафиксированы.'], REPORT_STYLE_.cell, full);
  }

  row = sheetPut_(sh, row, [''], REPORT_STYLE_.gap, full);

  /* --- Итоги для клиента --- */
  row = sheetPut_(sh, row, ['ИТОГИ'], REPORT_STYLE_.section, full);
  row = sheetPut_(sh, row, ['Итого по смете', sheetMoney_(data.totals.estimate)],
    REPORT_STYLE_.total, [6, 1]);
  row = sheetPut_(sh, row, ['Итого за материалы (с наценкой)', sheetMoney_(data.totals.materials)],
    REPORT_STYLE_.total, [6, 1]);
  row = sheetPut_(sh, row, ['ВСЕГО К ОПЛАТЕ', sheetMoney_(data.totals.grand)],
    REPORT_STYLE_.head, [6, 1]);

  row = sheetPut_(sh, row, [''], REPORT_STYLE_.gap, full);
  row = sheetPut_(sh, row,
    ['Фотографии накладных хранятся на Google Диске и доступны в кабинете клиента по персональной ссылке.'],
    REPORT_STYLE_.note, full);
}

/* --------------------------------------------------------------------------
 * Сборка PDF
 * ------------------------------------------------------------------------ */

/**
 * Сборка PDF-отчёта: временная таблица → экспорт в PDF → файл на Диске.
 * @param {Object} object
 * @param {boolean=} wantBytes — вернуть и содержимое файла (для скачивания
 *                              прямо в приложении, без похода на Диск)
 * @return {Object} { fileId, url, name, size, mime?, base64? }
 */
function buildReportPdf_(object, wantBytes) {
  const data = reportData_(object);
  const view = data.object;
  const baseName = 'Отчёт ' + view.numberLabel + ' ' + (view.title || 'объект') + ' ' + todayIso_();

  // Ссылку после создания нужно получить заново: запись через только что
  // созданный объект Spreadsheet в Apps Script ненадёжна.
  const tmpId = SpreadsheetApp.create(baseName).getId();
  const tmp = SpreadsheetApp.openById(tmpId);

  fillReportSheet_(tmp.getSheets()[0].setName('Отчёт'), data);
  SpreadsheetApp.flush();

  const pdfBlob = DriveApp.getFileById(tmpId).getAs(MimeType.PDF);
  // Содержимое снимаем до уборки временной таблицы: дальше оно не нужно.
  const bytes = wantBytes ? pdfBlob.getBytes() : null;
  const saved = saveBlobToFolder_(reportFolder_(), baseName + '.pdf', pdfBlob);

  // Временную таблицу убираем в корзину — она больше не нужна.
  try {
    DriveApp.getFileById(tmpId).setTrashed(true);
  } catch (e) {
    // Не критично: лишний файл в корзине не мешает.
  }

  const result = {
    fileId: saved.id,
    url: saved.url,
    name: saved.name,
    size: saved.size,
    // Итоги отдаём вместе с файлом: письмо и экран берут их отсюда,
    // чтобы не перечитывать лист объекта второй раз.
    totals: data.totals
  };
  if (bytes) {
    result.mime = 'application/pdf';
    result.base64 = Utilities.base64Encode(bytes);
  }
  return result;
}

/**
 * PDF для скачивания из приложения: файл приходит целиком, а не ссылкой
 * на Диск. На телефоне ссылка на Диск открывала просмотрщик вместо
 * сохранения файла.
 * @param {string} token
 * @param {string} id
 * @return {Object} { name, size, mime, base64, url }
 */
function reportPdf_(token, id) {
  requireSession_(token);
  const object = requireObject_(id);
  return buildReportPdf_(object, true);
}

/**
 * Отправка отчёта клиенту письмом.
 * @param {string} token
 * @param {string} id
 * @param {string} contact — адрес электронной почты
 * @return {Object}
 */
function reportSend_(token, id, contact) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const email = str_(contact);

  assert_(email.indexOf('@') !== -1 && email.indexOf('.') !== -1,
    'Укажите адрес электронной почты клиента.', 'VALIDATION');

  const pdf = buildReportPdf_(object);
  const view = objectView_(object);
  const link = cabinetUrl_(object);

  const subject = 'Отчёт по объекту № ' + view.numberLabel + ' — ' + (view.title || 'объект');
  const totals = pdf.totals || {};
  const text = [
    'Здравствуйте!',
    '',
    'Направляем отчёт по объекту «' + (view.title || '') + '».',
    view.address ? 'Адрес: ' + view.address : '',
    '',
    'Итого по смете: ' + sheetMoney_(totals.estimate),
    'Материалы: ' + sheetMoney_(totals.purchases),
    (totals.markup > 0 ? 'Наценка на материал: ' + sheetMoney_(totals.markup) : ''),
    (totals.markup > 0 ? 'Итого за материалы: ' + sheetMoney_(totals.materials) : ''),
    'Всего к оплате: ' + sheetMoney_(totals.grand),
    '',
    'Открыть кабинет с полной историей работ:',
    link,
    '',
    'С уважением,',
    session.name
  ].filter(function (line) { return line !== ''; }).join('\n');

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: text,
    attachments: [DriveApp.getFileById(pdf.fileId).getBlob()]
  });

  logVisit_(session.name, session.role, 'отправил отчёт клиенту по объекту ' + view.title, {});

  return { ok: true, sent: email, report: pdf.url, cabinet: link };
}

/**
 * HTML-страница отчёта — открывается по ссылке без входа.
 * @param {Object} params — { id, token }
 * @return {HtmlOutput}
 */
function reportPage_(params) {
  let object = null;
  try {
    object = cabinetRequireObject_(params);
  } catch (err) {
    return htmlOut_(deadLinkPage_(err && err.message), { title: 'Ссылка недоступна' });
  }

  const data = reportData_(object);
  return htmlOut_(reportHtml_(data, true), { title: 'Отчёт по объекту № ' + data.object.numberLabel });
}
