/**
 * ============================================================================
 * Модуль: modal
 * Ответственность: всплывающие окна и подтверждения на русском языке.
 *                  Системные alert/confirm/prompt не используются намеренно —
 *                  их текст зависит от языка браузера и пугает пользователя.
 * Зависимости: core/dom
 * ============================================================================
 */

import { h, qs } from './dom.js';

/** Открытые окна — чтобы закрывать их по Esc и по клику на фон. */
const openStack = [];

/**
 * Открыть модальное окно.
 * @param {Object} options
 * @param {string} options.title — заголовок
 * @param {string=} options.text — пояснение под заголовком
 * @param {HTMLElement|Array=} options.body — содержимое
 * @param {Array<Object>=} options.actions — кнопки: { label, variant, value, keep }
 * @return {Promise<*>} значение нажатой кнопки либо null при закрытии
 */
export function openModal(options) {
  const root = qs('#modal-root');
  if (!root) return Promise.resolve(null);

  const config = options || {};

  return new Promise((resolve) => {
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      const index = openStack.indexOf(instance);
      if (index !== -1) openStack.splice(index, 1);
      if (!openStack.length) document.body.style.overflow = '';
      if (typeof config.onClose === 'function') config.onClose(value);
      resolve(value);
    };

    const actions = (config.actions || [{ label: 'Понятно', variant: 'primary', value: true }]).map((action) => {
      return h('button.btn', {
        class: 'btn--' + (action.variant || 'ghost'),
        type: 'button',
        onclick: () => finish(action.value === undefined ? true : action.value)
      }, action.label);
    });

    const box = h('div.modal__box', { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal__head',
        h('div.modal__title', { text: config.title || '' }),
        config.text ? h('div.modal__text', { text: config.text }) : null
      ),
      config.body ? h('div.modal__body', config.body) : null,
      h('div.modal__actions', actions)
    );

    const overlay = h('div.modal', {
      onclick: (event) => {
        if (event.target === overlay && config.dismissible !== false) finish(null);
      }
    }, box);

    const instance = { finish };
    openStack.push(instance);
    document.body.style.overflow = 'hidden';

    root.appendChild(overlay);

    // Фокус на первую кнопку — важно для клавиатуры.
    const first = box.querySelector('.btn');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

/**
 * Подтверждение действия. Заменяет системный confirm.
 * @param {Object} options
 * @param {string} options.title
 * @param {string=} options.text
 * @param {string=} options.confirmText
 * @param {string=} options.cancelText
 * @param {boolean=} options.danger — красная кнопка подтверждения
 * @return {Promise<boolean>}
 */
export function confirmDialog(options) {
  const config = options || {};
  return openModal({
    title: config.title || 'Подтвердите действие',
    text: config.text || '',
    body: config.body || null,
    actions: [
      { label: config.cancelText || 'Отмена', variant: 'ghost', value: false },
      {
        label: config.confirmText || 'Подтвердить',
        variant: config.danger ? 'danger' : 'primary',
        value: true
      }
    ]
  }).then((value) => value === true);
}

/**
 * Окно с одним полем ввода. Заменяет системный prompt.
 * @param {Object} options
 * @param {string} options.title
 * @param {string=} options.text
 * @param {string=} options.label
 * @param {string=} options.value
 * @param {string=} options.placeholder
 * @param {string=} options.inputmode
 * @param {string=} options.confirmText
 * @return {Promise<string|null>}
 */
export function promptDialog(options) {
  const config = options || {};
  let input = null;

  const field = h('label.field',
    config.label ? h('span.field__label', { text: config.label }) : null,
    h('input.input', {
      type: 'text',
      value: config.value || '',
      placeholder: config.placeholder || '',
      inputmode: config.inputmode || 'text',
      autocomplete: 'off'
    })
  );
  input = field.querySelector('input');

  const promise = openModal({
    title: config.title || 'Введите значение',
    text: config.text || '',
    body: field,
    actions: [
      { label: 'Отмена', variant: 'ghost', value: null },
      { label: config.confirmText || 'Сохранить', variant: 'primary', value: '__submit__' }
    ]
  });

  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = String(input.value || '').trim();
        const top = openStack[openStack.length - 1];
        if (top) top.finish(value || null);
      }
    });
    setTimeout(() => input.focus(), 40);
  }

  return promise.then((value) => {
    if (value !== '__submit__') return null;
    return String(input ? input.value : '').trim() || null;
  });
}

/**
 * Закрыть последнее открытое окно.
 * @param {*} value
 */
export function closeTopModal(value) {
  const top = openStack[openStack.length - 1];
  if (top) top.finish(value === undefined ? null : value);
}

/** Закрыть все окна. */
export function closeAllModals() {
  while (openStack.length) closeTopModal(null);
}

// Esc закрывает верхнее окно — привычное поведение.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openStack.length) {
    event.preventDefault();
    closeTopModal(null);
  }
});
