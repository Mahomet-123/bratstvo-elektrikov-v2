/**
 * ============================================================================
 * Модуль: icons
 * Ответственность: набор контурных иконок интерфейса в виде SVG-разметки.
 *                  Только собственные строки — внешние файлы не загружаются,
 *                  поэтому приложение работает офлайн.
 * Зависимости: нет
 * ============================================================================
 */

const PATHS = {
  objects: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  calc: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 7h8"/><path d="M8 12h2M14 12h2M8 16.5h2M14 16.5h2"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.6 12h11l2-8H6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5"/>',
  team: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20.5c0-3.6 2.9-5.6 6.5-5.6s6.5 2 6.5 5.6"/><path d="M16.5 5.4a3.4 3.4 0 0 1 0 6.6"/><path d="M18 15.3c2.2.5 3.5 2 3.5 4.2"/>',
  back: '<path d="M15 5.5 8.5 12 15 18.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M3.5 8.5h3l1.6-2.4h7.8L17.5 8.5h3v11h-17z"/><circle cx="12" cy="14" r="3.6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4.5 17 4.5-4.5 4 4 2.5-2.5 4 4"/>',
  sync: '<path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M17 3v3.6h-3.6"/><path d="M7 21v-3.6h3.6"/>',
  cloud: '<path d="M7 18.5h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.7-1.2A3.9 3.9 0 0 0 7 18.5Z"/>',
  cloudOff: '<path d="M7 18.5h9"/><path d="M7.4 10.3A3.9 3.9 0 0 0 7 18.5"/><path d="M17.4 11.5a3.5 3.5 0 0 1 .3 6.9"/><path d="m3.5 3.5 17 17"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  alert: '<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4.5M12 17.4v.2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
  doc: '<path d="M6 3.5h7.5L19 9v11.5H6z"/><path d="M13 3.5V9h5.5"/><path d="M9 13h6M9 16.5h4"/>',
  edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="M15.5 4.5 19.5 8.5"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.5h6v2"/><path d="M6.5 6.5 7.5 20h9l1-13.5"/>',
  download: '<path d="M12 4v10.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
  share: '<path d="M12 3.5v11"/><path d="m8 7.5 4-4 4 4"/><path d="M5 13v7.5h14V13"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3c0 1.1-.9 2-2 2A16.5 16.5 0 0 1 4.5 5.5c0-1.1.9-2 2-2Z"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 20v-6M12.5 20V8M17 20v-9"/>',
  logout: '<path d="M14 4.5H6v15h8"/><path d="M11 12h9"/><path d="m17 8.5 3.5 3.5-3.5 3.5"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21"/><path d="M17.5 12v3M20 12v2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 8v.2"/>',
  eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  filter: '<path d="M3.5 5.5h17l-6.5 8v6l-4 2v-8z"/>',
  reopen: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
  archive: '<rect x="3" y="4.5" width="18" height="4.5" rx="1.5"/><path d="M5 9v10.5h14V9"/><path d="M9.5 13h5"/>'
};

/**
 * Разметка иконки.
 * @param {string} name — ключ из набора
 * @param {number=} size — размер в пикселях
 * @param {string=} className
 * @return {string}
 */
export function iconSvg(name, size = 22, className = '') {
  const body = PATHS[name] || PATHS.info;
  const cls = className ? ' class="' + className + '"' : '';
  return '<svg' + cls + ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

/**
 * Элемент-иконка.
 * @param {string} name
 * @param {number=} size
 * @param {string=} className
 * @return {HTMLElement}
 */
export function icon(name, size = 22, className = '') {
  const span = document.createElement('span');
  span.className = 'icon' + (className ? ' ' + className : '');
  span.innerHTML = iconSvg(name, size);
  return span;
}

/** Есть ли такая иконка в наборе. */
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

export default icon;
