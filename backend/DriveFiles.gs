/**
 * ============================================================================
 * Модуль: DriveFiles
 * Ответственность: работа с Google Диском — корневые папки приложения,
 *                  сохранение файлов (фото накладных, PDF-отчёты), поиск и перенос.
 * Зависимости: Config, Utils
 * ============================================================================
 */

// Кэш папок в пределах одного выполнения.
let FOLDER_CACHE_ = {};

/**
 * Получить или создать папку в корне «Мой диск».
 * @param {string} name
 * @return {Folder}
 */
function rootFolder_(name) {
  const key = str_(name);
  if (FOLDER_CACHE_[key]) return FOLDER_CACHE_[key];

  const it = DriveApp.getFoldersByName(key);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(key);
  FOLDER_CACHE_[key] = folder;
  return folder;
}

/** @return {Folder} папка фото накладных */
function photoFolder_() {
  return rootFolder_(CONFIG.DRIVE_PHOTO_FOLDER);
}

/** @return {Folder} папка архивов закрытых объектов */
function archiveFolder_() {
  return rootFolder_(CONFIG.DRIVE_ARCHIVE_FOLDER);
}

/** @return {Folder} папка PDF-отчётов */
function reportFolder_() {
  return rootFolder_(CONFIG.DRIVE_REPORT_FOLDER);
}

/**
 * Подпапка объекта — чтобы фото разных объектов не смешивались.
 * @param {string} objectName
 * @return {Folder}
 */
function objectPhotoFolder_(objectName) {
  const safe = sheetSafeName_(objectName) || 'Без имени';
  const parent = photoFolder_();
  const it = parent.getFoldersByName(safe);
  return it.hasNext() ? it.next() : parent.createFolder(safe);
}

/**
 * Сохранение файла в папку.
 * @param {Folder} folder
 * @param {string} fileName
 * @param {Blob} blob
 * @return {{id: string, name: string, url: string, size: number}}
 */
function saveBlobToFolder_(folder, fileName, blob) {
  const file = folder.createFile(blob.setName(str_(fileName)));
  return {
    id: file.getId(),
    name: file.getName(),
    url: file.getUrl(),
    size: blob.getBytes().length
  };
}

/**
 * Сохранение фото накладной.
 * @param {string} objectName
 * @param {string} fileName
 * @param {Blob} blob
 * @return {{id: string, name: string, url: string, size: number}}
 */
function savePhoto_(objectName, fileName, blob) {
  const folder = objectPhotoFolder_(objectName);
  return saveBlobToFolder_(folder, fileName, blob);
}

/**
 * Файл по идентификатору или null.
 * @param {string} id
 * @return {File|null}
 */
function fileById_(id) {
  const key = str_(id);
  if (!key) return null;
  try {
    return DriveApp.getFileById(key);
  } catch (e) {
    return null;
  }
}

/**
 * Прямая ссылка на просмотр файла.
 * @param {string} id
 * @return {string}
 */
function fileViewUrl_(id) {
  const key = str_(id);
  return key ? 'https://drive.google.com/uc?id=' + key + '&export=view' : '';
}

/**
 * Перемещение файла в другую папку (для архивации).
 * @param {string} fileId
 * @param {Folder} targetFolder
 * @return {boolean}
 */
function moveFileToFolder_(fileId, targetFolder) {
  const file = fileById_(fileId);
  if (!file || !targetFolder) return false;
  targetFolder.addFile(file);
  // Из «Моего диска» файл убираем, чтобы не дублировался.
  try {
    DriveApp.getRootFolder().removeFile(file);
  } catch (e) {
    // Файл может лежать в другой папке — это не ошибка.
  }
  return true;
}

/**
 * Помещение файла в корзину (без необратимого удаления).
 * @param {string} fileId
 * @return {boolean}
 */
function trashFile_(fileId) {
  const file = fileById_(fileId);
  if (!file) return false;
  file.setTrashed(true);
  return true;
}

/**
 * Таблица в папке архивов: найти по имени или создать.
 *
 * Важная деталь: после `SpreadsheetApp.create` файл нужно открыть заново.
 * Ссылка, полученная сразу после создания, в Apps Script ненадёжна — запись
 * через неё может потеряться. Поэтому всегда возвращаем свежий объект.
 *
 * @param {string} name
 * @param {Folder=} folder — куда положить созданный файл
 * @return {Spreadsheet}
 */
function ensureSpreadsheetInFolder_(name, folder) {
  const target = folder || archiveFolder_();
  const existing = target.getFilesByName(name);
  if (existing.hasNext()) return SpreadsheetApp.openById(existing.next().getId());

  const createdId = SpreadsheetApp.create(name).getId();
  const file = fileById_(createdId);
  if (file) {
    target.addFile(file);
    try {
      DriveApp.getRootFolder().removeFile(file);
    } catch (e) {
      // Файл может быть уже не в корне — это не ошибка.
    }
  }
  return SpreadsheetApp.openById(createdId);
}

/**
 * Таблица-архив за год: «Архив 2026». Создаётся при первом закрытии объекта.
 * @param {number} year
 * @return {Spreadsheet}
 */
function archiveSpreadsheet_(year) {
  return ensureSpreadsheetInFolder_(CONFIG.ARCHIVE_PREFIX + ' ' + int_(year, currentYear_()));
}

/**
 * Таблица-корзина: сюда переезжают листы ошибочно созданных объектов.
 * Данные не удаляются, а сохраняются — при необходимости их можно вернуть.
 * @return {Spreadsheet}
 */
function trashSpreadsheet_() {
  return ensureSpreadsheetInFolder_(CONFIG.TRASH_SPREADSHEET);
}

/**
 * Открыть файл для просмотра по ссылке.
 * Нужно для фото накладных: кабинет клиента открывается без входа в Google,
 * поэтому картинка должна быть доступна любому, у кого есть ссылка.
 * @param {string} fileId
 * @return {boolean}
 */
function makeFileViewable_(fileId) {
  const file = fileById_(fileId);
  if (!file) return false;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (e) {
    // Организация может запрещать публикацию — фото просто останется приватным.
    logError_('DriveFiles.makeFileViewable_', e, { fileId: str_(fileId) });
    return false;
  }
}

/**
 * Открытие таблицы-архива по ссылке из реестра объектов.
 * В колонке «архив» хранится идентификатор файла — он не меняется при
 * переименовании. Если файла по id нет, пробуем найти его по имени в папке
 * архивов: так восстанавливается доступ, если таблицу пересоздали.
 * @param {string} ref — идентификатор или имя таблицы-архива
 * @return {Spreadsheet|null}
 */
function openArchiveSpreadsheet_(ref) {
  const key = str_(ref);
  if (!key) return null;

  try {
    return SpreadsheetApp.openById(key);
  } catch (e) {
    // Не идентификатор — ищем по имени.
  }

  try {
    const it = archiveFolder_().getFilesByName(key);
    if (it.hasNext()) return SpreadsheetApp.openById(it.next().getId());
  } catch (e) {
    // Файл недоступен.
  }
  return null;
}

/**
 * Отчёт о доступе к Диску — для проверки разрешений.
 * @return {Object}
 */
function driveReport_() {
  const photos = photoFolder_();
  const archives = archiveFolder_();
  const reports = reportFolder_();
  return {
    photos: { id: photos.getId(), name: photos.getName() },
    archives: { id: archives.getId(), name: archives.getName() },
    reports: { id: reports.getId(), name: reports.getName() },
    quotaTotalMb: Math.round(DriveApp.getStorageLimit() / 1024 / 1024),
    quotaUsedMb: Math.round(DriveApp.getStorageUsed() / 1024 / 1024)
  };
}
