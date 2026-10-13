/**
 * ============================================================================
 * Модуль: styles
 * Ответственность: подключение CSS-файлов компонентов по требованию —
 *                  стили грузятся вместе с модулем, который их использует.
 * Зависимости: нет
 * ============================================================================
 */

/** Уже подключённые адреса, чтобы не дублировать теги link. */
const loaded = new Set();

/**
 * Подключить таблицу стилей.
 * @param {string} href — путь относительно корня приложения
 * @return {Promise<void>}
 */
export function loadStyles(href) {
  const url = new URL(href, document.baseURI).href;

  if (loaded.has(url)) return Promise.resolve();

  const existing = document.querySelector('link[rel="stylesheet"][href="' + url + '"]');
  if (existing) {
    loaded.add(url);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    // Даже при ошибке загрузки стилей интерфейс должен остаться рабочим.
    link.onload = () => {
      loaded.add(url);
      resolve();
    };
    link.onerror = () => {
      loaded.add(url);
      resolve();
    };
    document.head.appendChild(link);
  });
}

/**
 * Подключить стили для набора компонентов.
 * @param {Array<string>} hrefs
 * @return {Promise<Array<void>>}
 */
export function loadStylesAll(hrefs) {
  return Promise.all((hrefs || []).map(loadStyles));
}
