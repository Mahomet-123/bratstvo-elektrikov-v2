/**
 * ============================================================================
 * Модуль: Archive
 * Ответственность: закрытие объекта с переносом его листа в таблицу-архив
 *                  за год («Архив 2026»), возврат объекта в работу и список
 *                  архивов для руководителя.
 *                  Данные не удаляются: лист переезжает целиком, а в реестре
 *                  объектов остаётся идентификатор архива — по нему приложение
 *                  находит лист и продолжает читать расчёт, дни и закупки.
 * Зависимости: Config, Utils, Sheets, Objects, Sessions, DriveFiles
 * ============================================================================
 */

/**
 * Закрытие объекта: статус «закрыт» + перенос листа в архив за текущий год.
 * @param {string} token
 * @param {string} id
 * @return {Object}
 */
function closeObject_(token, id) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const view = objectView_(object);

  assert_(view.status !== CONFIG.STATUS_CLOSED, 'Объект уже закрыт.', 'VALIDATION');

  const sheetName = str_(object['лист']);
  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');

  return withLock_(function () {
    const stamp = nowIso_();
    let archiveId = str_(object['архив']);
    let archiveName = '';
    let sheetField = sheetName;

    // Лист переезжает в архив только один раз: повторное закрытие
    // (например, после возврата в работу) лишний раз ничего не двигает.
    if (!archiveId) {
      const archive = archiveSpreadsheet_(currentYear_());
      archiveId = archive.getId();
      archiveName = archive.getName();
      // Имя в архиве может отличаться: Google добавляет «(копия)», если лист
      // с таким именем там уже был. Записываем фактическое — иначе объект
      // откроется «пустым», потому что лист будет искаться по старому имени.
      sheetField = moveSheetTo_(sheetName, archive);
    } else {
      const existing = openArchiveSpreadsheet_(archiveId);
      archiveName = existing ? existing.getName() : '';
    }

    updateRow_(CONFIG.SHEETS.OBJECTS, object._row, {
      'статус': CONFIG.STATUS_CLOSED,
      'закрыт': stamp,
      'обновлён': stamp,
      'архив': archiveId,
      'лист': sheetField
    });

    logVisit_(session.name, session.role,
      'закрыл объект ' + view.title + (archiveName ? ' → ' + archiveName : ''), {});

    return {
      ok: true,
      object: objectView_(requireObject_(id), true),
      archive: { id: archiveId, name: archiveName },
      message: archiveName
        ? 'Объект закрыт. Лист перенесён в таблицу «' + archiveName + '» на Google Диске.'
        : 'Объект закрыт.'
    };
  });
}

/**
 * Возврат объекта в работу: лист возвращается из архива в основную таблицу.
 * @param {string} token
 * @param {string} id
 * @return {Object}
 */
function restoreObject_(token, id) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const sheetName = str_(object['лист']);
  const archiveRef = str_(object['архив']);

  assert_(sheetName, 'У объекта не задан лист.', 'NOT_FOUND');
  assert_(archiveRef || str_(object['статус']) === CONFIG.STATUS_CLOSED,
    'Объект не в архиве — возвращать нечего.', 'VALIDATION');

  return withLock_(function () {
    let sheetField = sheetName;

    if (archiveRef) {
      const archive = openArchiveSpreadsheet_(archiveRef);
      assert_(archive, 'Таблица-архив недоступна: файл переименован или удалён.', 'NOT_FOUND');

      const sh = archive.getSheetByName(sheetName);
      assert_(sh, 'В архиве не найден лист «' + sheetName + '».', 'NOT_FOUND');

      // Обратный перенос: копия проверяется, оригинал в архиве удаляется
      // только после успеха. Фактическое имя возвращаем в реестр.
      sheetField = moveSheetBetween_(archive, ss_(), sheetName);
    }

    updateRow_(CONFIG.SHEETS.OBJECTS, object._row, {
      'статус': CONFIG.STATUS_WORK,
      'закрыт': '',
      'архив': '',
      'кабинет': 'да',
      'лист': sheetField,
      'обновлён': nowIso_()
    });

    const fresh = requireObject_(id);
    logVisit_(session.name, session.role, 'вернул объект в работу ' + objectView_(fresh).title, {});

    return {
      ok: true,
      object: objectView_(fresh, true),
      cabinetUrl: cabinetUrl_(fresh),
      message: 'Объект снова в работе. Лист возвращён в основную таблицу.'
    };
  });
}

/**
 * Уборка таблицы-архива: удаляются листы, на которые не ссылается ни один
 * объект. Такие листы остаются, если объект убрали из реестра, а лист в архиве
 * уже лежал, или если копия получила имя «(копия)».
 *
 * Удаляются только файлы внутри таблицы-архива и только те, что не нужны
 * приложению. Последний лист не удаляем: Google не оставляет таблицу без листов.
 *
 * @param {string} token — сессия руководителя
 * @param {string} archiveId — таблица-архив
 * @return {Object} { ok, removed, kept }
 */
function archiveCleanup_(token, archiveId) {
  const session = requireLeader_(token);
  const archive = openArchiveSpreadsheet_(archiveId);
  assert_(archive, 'Таблица-архив недоступна: файл переименован или удалён.', 'NOT_FOUND');

  // Какие листы нужны приложению — по реестру объектов.
  const referenced = {};
  readRows_(CONFIG.SHEETS.OBJECTS).forEach(function (row) {
    if (str_(row['архив']) === str_(archiveId)) referenced[str_(row['лист'])] = true;
  });

  const names = archive.getSheets().map(function (sh) { return sh.getName(); });
  const removed = [];
  const kept = [];

  names.forEach(function (name) {
    if (referenced[name]) {
      kept.push(name);
      return;
    }
    // Оставляем хотя бы один лист: Google не позволяет таблице без листов.
    if (archive.getSheets().length <= 1) return;
    archive.deleteSheet(archive.getSheetByName(name));
    removed.push(name);
  });

  // Если нужных листов в архиве не осталось, последний превращаем в служебную
  // заглушку. Иначе он «занимает» имя, и Google начнёт добавлять к копиям
  // листов объектов приписку «(копия)» — это ломает поиск листа по имени.
  let service = '';
  if (!kept.length && archive.getSheets().length === 1) {
    const last = archive.getSheets()[0];
    last.clear();
    if (last.getName() !== CONFIG.ARCHIVE_SERVICE_SHEET) {
      last.setName(CONFIG.ARCHIVE_SERVICE_SHEET);
    }
    service = last.getName();
    kept.push(service);
  }

  logVisit_(session.name, session.role,
    'убрал из архива «' + archive.getName() + '» лишних листов: ' + removed.length, {});

  return {
    ok: true,
    archive: archive.getName(),
    removed: removed,
    kept: kept,
    service: service,
    message: removed.length
      ? 'Убрано листов: ' + removed.length + '. Осталось: ' + kept.length + '.'
      : (service ? 'Архив пуст, оставлен служебный лист.' : 'Лишних листов не было.')
  };
}

/**
 * Имена листов внутри таблицы-архива — для панели руководителя.
 * Заодно показывает, что реально лежит в архиве, а не только что записано
 * в реестре объектов.
 * @param {string} archiveId
 * @return {Array<string>}
 */
function archiveSheetNames_(archiveId) {
  const ss = openArchiveSpreadsheet_(archiveId);
  if (!ss) return [];
  return ss.getSheets().map(function (sh) { return sh.getName(); });
}

/**
 * Список архивов за годы с объектами внутри — для панели руководителя.
 * @param {string} token
 * @return {Object}
 */
function archivesList_(token) {
  requireLeader_(token);

  const objects = readRows_(CONFIG.SHEETS.OBJECTS);
  const byArchive = {};
  objects.forEach(function (row) {
    const ref = str_(row['архив']);
    if (!ref) return;
    if (!byArchive[ref]) byArchive[ref] = [];
    const view = objectView_(row);
    byArchive[ref].push({
      id: view.id,
      numberLabel: view.numberLabel,
      title: view.title,
      client: view.client,
      status: view.status,
      closed: view.closed,
      estimate: view.totals.estimate
    });
  });

  const archives = [];
  try {
    const files = archiveFolder_().getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      const file = files.next();
      const id = file.getId();
      // Таблица-корзина лежит в той же папке, но архивом не является.
      if (file.getName() === CONFIG.TRASH_SPREADSHEET) continue;

      const list = byArchive[id] || [];
      archives.push({
        id: id,
        name: file.getName(),
        url: file.getUrl(),
        updated: isoDate_(file.getLastUpdated()),
        sheets: archiveSheetNames_(id),
        objects: list.sort(function (a, b) { return b.numberLabel < a.numberLabel ? -1 : 1; }),
        count: list.length
      });
    }
  } catch (e) {
    logError_('Archive.archivesList_', e, {});
  }

  archives.sort(function (a, b) { return String(b.name).localeCompare(String(a.name), 'ru'); });

  return {
    archives: archives,
    totals: {
      archives: archives.length,
      objects: archives.reduce(function (acc, a) { return acc + a.count; }, 0)
    }
  };
}
