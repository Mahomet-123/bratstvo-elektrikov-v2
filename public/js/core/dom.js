/**
 * ============================================================================
 * Модуль: dom
 * Ответственность: создание и изменение элементов без innerHTML — сборка
 *                  интерфейса через безопасные DOM-операции.
 * Зависимости: нет
 * ============================================================================
 */

/**
 * Создание элемента.
 * Поддерживает: строку-класс, объект атрибутов, обработчики on*,
 * вложенные узлы, строки и массивы.
 *
 * @param {string} tag — тег, допускается «div.cls.cls2»
 * @param {Object|Array|string|Node=} attrs — атрибуты или сразу дети
 * @param {...*} children — дочерние узлы
 * @return {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const parts = String(tag).split('.');
  const el = document.createElement(parts[0] || 'div');

  if (parts.length > 1) {
    el.className = parts.slice(1).join(' ');
  }

  let kids = children;

  if (attrs && typeof attrs === 'object' && !isNode(attrs) && !Array.isArray(attrs)) {
    applyAttrs(el, attrs);
  } else if (attrs !== undefined && attrs !== null) {
    kids = [attrs, ...children];
  }

  append(el, kids);
  return el;
}

/** Применение атрибутов к элементу. */
function applyAttrs(el, attrs) {
  Object.keys(attrs).forEach((key) => {
    const value = attrs[key];
    if (value === undefined || value === null || value === false) return;

    if (key === 'class' || key === 'className') {
      const extra = String(value);
      el.className = el.className ? el.className + ' ' + extra : extra;
      return;
    }
    if (key === 'text') {
      el.textContent = String(value);
      return;
    }
    if (key === 'html') {
      // Осознанное исключение: только для собственных проверенных строк (иконки).
      el.innerHTML = String(value);
      return;
    }
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
      return;
    }
    if (key === 'dataset' && typeof value === 'object') {
      Object.assign(el.dataset, value);
      return;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
      return;
    }
    if (key === 'value') {
      el.value = value;
      return;
    }
    if (key === 'checked' || key === 'disabled' || key === 'selected') {
      el[key] = Boolean(value);
      if (value === true) el.setAttribute(key, '');
      return;
    }
    el.setAttribute(key, String(value));
  });
}

/** Добавление детей в элемент. */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  list.forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      append(parent, child);
      return;
    }
    if (isNode(child)) {
      parent.appendChild(child);
      return;
    }
    parent.appendChild(document.createTextNode(String(child)));
  });
  return parent;
}

/** Проверка, что значение — узел DOM. */
export function isNode(value) {
  return value instanceof Node;
}

/** Первый элемент по селектору. */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** Все элементы по селектору (массив). */
export function qsa(selector, root = document) {
  return Array.prototype.slice.call(root.querySelectorAll(selector));
}

/** Полная замена содержимого элемента. */
export function setContent(el, ...children) {
  if (!el) return el;
  el.textContent = '';
  append(el, children);
  return el;
}

/** Удаление всех детей. */
export function clear(el) {
  if (!el) return el;
  el.textContent = '';
  return el;
}

/** Навешивание обработчика с возвратом функции отписки. */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/**
 * Делегирование событий: обработчик срабатывает на ближайшем предке,
 * подходящем под селектор.
 */
export function delegate(root, type, selector, handler) {
  const listener = (event) => {
    const match = event.target.closest(selector);
    if (match && root.contains(match)) handler(event, match);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

/** Ближайший родитель по селектору. */
export function closest(el, selector) {
  return el ? el.closest(selector) : null;
}

/** Показ и скрытие элемента. */
export function toggle(el, visible) {
  if (!el) return el;
  el.classList.toggle('hidden', !visible);
  return el;
}

/** Короткая задержка для debounce/throttle. */
export function debounce(fn, ms = 250) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
