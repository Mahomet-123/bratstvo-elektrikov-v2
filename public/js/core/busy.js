/**
 * ============================================================================
 * Модуль: busy
 * Ответственность: признак работы на кнопке. Пока действие выполняется, кнопка
 *                  показывает значок ожидания и подпись («Сохраняем…»), а
 *                  повторное нажатие не проходит. По завершении кнопка
 *                  возвращается к прежнему виду.
 *
 *                  Нужно, чтобы нажатие было видно: без этого человек решает,
 *                  что кнопка не сработала, и жмёт её ещё раз.
 * Зависимости: core/dom, core/icons
 * ============================================================================
 */

import { h, setContent } from './dom.js';
import { iconSvg } from './icons.js';

/**
 * Выполнить действие, показав занятость кнопки.
 *
 * @param {HTMLElement} button — кнопка, по которой нажали
 * @param {string} busyLabel — подпись на время работы («Сохраняем…»)
 * @param {Function} task — что выполнить; может быть асинхронным
 * @return {Promise<*>} результат task
 */
export async function runBusy(button, busyLabel, task) {
  // Повторное нажатие по уже занятой кнопке ничего не делает: иначе уйдёт
  // второй такой же запрос и появится вторая такая же запись.
  if (!button || button.dataset.busy === '1') return undefined;

  const saved = Array.prototype.slice.call(button.childNodes).map((node) => node.cloneNode(true));
  const wasDisabled = button.disabled;
  const wasClass = button.className;

  button.dataset.busy = '1';
  button.disabled = true;
  button.classList.add('btn--busy');
  setContent(button,
    h('span.btn__icon.btn__icon--spin', { html: iconSvg('sync', 18) }),
    busyLabel || 'Подождите…'
  );

  try {
    return await task();
  } finally {
    delete button.dataset.busy;
    button.disabled = wasDisabled;
    button.className = wasClass;
    setContent(button);
    saved.forEach((node) => button.appendChild(node));
  }
}

/**
 * Выполнить действие с занятостью кнопки и показом ошибки.
 * Ошибку показывает тот, кто вызвал, — здесь только снимаем занятость.
 *
 * @param {HTMLElement} button
 * @param {string} busyLabel
 * @param {Function} task
 * @return {Promise<{ok: boolean, result: *, error: Error|null}>}
 */
export async function tryBusy(button, busyLabel, task) {
  let error = null;
  const result = await runBusy(button, busyLabel, async () => {
    try {
      return await task();
    } catch (caught) {
      error = caught;
      return undefined;
    }
  });
  return { ok: !error, result: result, error: error };
}

export default { runBusy: runBusy, tryBusy: tryBusy };
