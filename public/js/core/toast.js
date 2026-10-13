/**
 * ============================================================================
 * Модуль: toast
 * Ответственность: короткие всплывающие уведомления внизу экрана.
 *                  Никогда не использует системные alert/confirm.
 * Зависимости: config, core/dom
 * ============================================================================
 */

import { h, qs } from './dom.js';
import { CONFIG } from '../config.js';

/**
 * Показать уведомление.
 * @param {string} text
 * @param {'info'|'success'|'error'|'warning'} type
 * @param {number=} ms — сколько держать на экране
 * @return {HTMLElement}
 */
export function toast(text, type = 'info', ms) {
  const root = qs('#toasts');
  if (!root) return null;

  const node = h('div.toast', { class: type !== 'info' ? 'toast--' + type : '' },
    h('span.toast__text', { text: String(text) })
  );

  root.appendChild(node);

  const lifetime = ms || (type === 'error' ? CONFIG.TOAST_MS + 1600 : CONFIG.TOAST_MS);
  setTimeout(() => {
    node.style.transition = 'opacity .2s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, lifetime);

  return node;
}

/** Успешное уведомление. */
export function toastSuccess(text, ms) {
  return toast(text, 'success', ms);
}

/** Уведомление об ошибке. */
export function toastError(text, ms) {
  return toast(text, 'error', ms);
}

/** Предупреждение. */
export function toastWarning(text, ms) {
  return toast(text, 'warning', ms);
}
