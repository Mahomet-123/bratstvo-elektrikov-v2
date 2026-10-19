/**
 * ============================================================================
 * Модуль: files
 * Ответственность: сохранение файла, пришедшего с сервера, прямо на устройство —
 *                  без Google Диска, без промежуточных просмотрщиков.
 *
 *                  На компьютере файл просто скачивается. На телефоне (особенно
 *                  на iPhone) браузер охотнее отдаёт файл через системное окно
 *                  «Поделиться» — оттуда его кладут в «Файлы». Поэтому на
 *                  сенсорных устройствах сначала пробуем поделиться, а если
 *                  браузер не умеет — скачиваем ссылкой.
 * Зависимости: нет
 * ============================================================================
 */

/**
 * Base64 → Blob.
 * @param {string} base64
 * @param {string=} mime
 * @return {Blob}
 */
export function base64ToBlob(base64, mime) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/**
 * Устройство с сенсорным вводом — телефон или планшет.
 * @return {boolean}
 */
export function isTouchDevice() {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch (error) {
    return false;
  }
}

/**
 * Скачивание файла ссылкой с признаком загрузки.
 * @param {Blob} blob
 * @param {string} name
 */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'файл';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Ссылку отпускаем не сразу: браузер ещё читает файл из памяти.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Сохранить файл на устройство.
 * @param {Blob} blob
 * @param {string} name
 * @param {Object=} options — { share: boolean } — пробовать «Поделиться»
 * @return {Promise<'share'|'download'|'cancel'>}
 */
export async function saveFile(blob, name, options) {
  const config = options || {};
  const file = typeof File === 'function'
    ? new File([blob], name, { type: blob.type })
    : null;

  if (config.share && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'share';
    } catch (error) {
      // Отказ от окна «Поделиться» — это не ошибка: человек передумал.
      if (error && error.name === 'AbortError') return 'cancel';
      // Всё остальное (в том числе «нет действия человека») — повод просто
      // скачать файл ссылкой.
    }
  }

  downloadBlob(blob, name);
  return 'download';
}

export default { base64ToBlob, downloadBlob, saveFile, isTouchDevice };
