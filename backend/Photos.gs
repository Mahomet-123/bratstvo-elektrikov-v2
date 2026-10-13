/**
 * ============================================================================
 * Модуль: Photos
 * Ответственность: приём фото накладных с телефона и сохранение их на Диск
 *                  в подпапку объекта. Фото приходит уже сжатым на телефоне
 *                  (WebP, около 300 КБ), но сервер всё равно проверяет размер.
 * Зависимости: Config, Utils, Sessions, Objects, DriveFiles
 * ============================================================================
 */

/** Допустимые типы изображений. */
const PHOTO_MIME_ = ['image/webp', 'image/jpeg', 'image/jpg', 'image/png'];

/**
 * Определение типа файла по началу данных — если телефон не сообщил MIME.
 * @param {Byte[]} bytes
 * @return {string}
 */
function guessMime_(bytes) {
  if (!bytes || bytes.length < 4) return 'image/jpeg';
  const b0 = (bytes[0] + 256) % 256;
  const b1 = (bytes[1] + 256) % 256;
  const b2 = (bytes[2] + 256) % 256;
  const b3 = (bytes[3] + 256) % 256;
  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) return 'image/png';
  // WebP: RIFF....WEBP
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Расширение файла для типа.
 * @param {string} mime
 * @return {string}
 */
function extensionFor_(mime) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/png') return 'png';
  return 'jpg';
}

/**
 * Загрузка фото накладной.
 * @param {string} token
 * @param {Object} payload — { id — объект, name, mime, data — base64, size }
 * @return {Object} { fileId, url, size, mime, name }
 */
function photoUpload_(token, payload) {
  const session = requireSession_(token);
  const p = payload || {};
  const object = requireObject_(p.id);

  const data = str_(p.data);
  assert_(data, 'Не переданы данные фотографии.', 'VALIDATION');

  // Отсекаем префикс data-url, если он пришёл.
  const base64 = data.indexOf(',') !== -1 && data.indexOf('base64') !== -1
    ? data.split(',').pop()
    : data;

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (e) {
    assert_(false, 'Не удалось прочитать изображение.', 'VALIDATION');
  }

  assert_(bytes.length > 0, 'Пустой файл изображения.', 'VALIDATION');
  assert_(bytes.length <= CONFIG.MAX_PHOTO_BYTES,
    'Фото больше ' + Math.round(CONFIG.MAX_PHOTO_BYTES / 1024) + ' КБ. Уменьшите снимок.', 'VALIDATION');

  const declared = str_(p.mime).toLowerCase();
  const mime = PHOTO_MIME_.indexOf(declared) !== -1 ? declared : guessMime_(bytes);

  const stamp = nowIso_().replace(/[:.]/g, '-');
  const baseName = sheetSafeName_(p.name) || 'Накладная';
  const fileName = baseName + ' ' + stamp + '.' + extensionFor_(mime);

  const saved = savePhoto_(objectView_(object).title, fileName, Utilities.newBlob(bytes, mime, fileName));

  // Кабинет клиента открывается без входа в Google, поэтому фото должно быть
  // доступно по ссылке. Если политика организации это запрещает — не страшно.
  const shared = makeFileViewable_(saved.id);

  logVisit_(session.name, session.role,
    'загрузил фото накладной по объекту ' + objectView_(object).title +
    ' (' + Math.round(saved.size / 1024) + ' КБ)', {});

  return {
    fileId: saved.id,
    url: fileViewUrl_(saved.id),
    driveUrl: saved.url,
    name: saved.name,
    size: saved.size,
    mime: mime,
    shared: shared
  };
}
