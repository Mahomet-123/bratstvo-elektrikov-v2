/**
 * ============================================================================
 * Модуль: badges (общие элементы компонентов)
 * Ответственность: небольшие повторяемые кусочки разметки, нужные сразу
 *                  нескольким экранам — метка статуса объекта и метка
 *                  «повтор» для записей журнала.
 * Зависимости: core/dom, config
 * ============================================================================
 */

import { h } from '../../core/dom.js';
import { CONFIG } from '../../config.js';

/**
 * Метка статуса объекта.
 * @param {string} status — «расчёт» | «в работе» | «закрыт»
 * @return {HTMLElement}
 */
export function statusBadge(status) {
  const label = CONFIG.STATUS_LABEL[status] || status || '—';
  const modifier = CONFIG.STATUS_BADGE[status] || 'badge--muted';
  return h('span.badge', { class: modifier, text: label });
}

/**
 * Метка «повтор» — повторная запись дня за ту же дату у того же исполнителя.
 * @return {HTMLElement}
 */
export function duplicateBadge() {
  return h('span.badge.badge--danger', { text: 'повтор' });
}

export default statusBadge;
