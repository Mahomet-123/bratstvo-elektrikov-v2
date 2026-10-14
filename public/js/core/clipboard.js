/**
 * ============================================================================
 * Модуль: clipboard
 * Ответственность: копирование текста в буфер обмена. Ссылку на кабинет
 *                  клиента удобнее отправить в мессенджер, чем диктовать.
 *                  Основной путь — современный Clipboard API; если он
 *                  недоступен (http, старый браузер), работает запасной
 *                  через временное поле ввода.
 * Зависимости: нет
 * ============================================================================
 */

/**
 * Скопировать текст в буфер обмена.
 * @param {string} text
 * @return {Promise<boolean>} получилось ли
 */
export async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      // Браузер отказал (например, страница не в фокусе) — пробуем запасной путь.
    }
  }

  return copyFallback(value);
}

/**
 * Запасное копирование через временное поле ввода.
 * @param {string} value
 * @return {boolean}
 */
function copyFallback(value) {
  try {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    field.style.opacity = '0';
    document.body.appendChild(field);

    field.select();
    field.setSelectionRange(0, value.length);
    const done = document.execCommand('copy');
    document.body.removeChild(field);
    return done;
  } catch (error) {
    return false;
  }
}

export default copyText;
