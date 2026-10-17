/**
 * ============================================================================
 * Компонент: AppShell
 * Ответственность: каркас рабочей области — верхняя панель с заголовком и
 *                  индикатором отправки, область экрана, нижняя навигация,
 *                  сопоставление адресов с экранами.
 * Зависимости: core/dom, core/router, core/store, core/styles, core/icons,
 *              components/SyncIndicator
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { createRouter } from '../../core/router.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store } from '../../core/store.js';
import { createSyncIndicator } from '../SyncIndicator/SyncIndicator.js';
import { CONFIG } from '../../config.js';

/**
 * Создание каркаса.
 * @param {Object} props
 * @param {Function} props.onLogout
 * @param {Function=} props.onManualSend
 * @return {Object} { el, router, register, setTitle, destroy }
 */
export function createAppShell(props) {
  const options = props || {};
  const state = store.get();
  const user = state.user || {};
  const isLeader = user.role === CONFIG.ROLE_LEADER || user.isLeader;

  /** Реестр экранов: путь → функция создания. */
  const screens = new Map();

  /** Текущий смонтированный экран (для корректного освобождения ресурсов). */
  let mounted = null;

  /* --- Пункты навигации --- */
  // Навигацию собираем до шапки: на широких экранах она живёт прямо в шапке,
  // а на телефоне те же самые кнопки уезжают вниз экрана средствами стилей.

  const navItems = [
    { path: '/objects', label: 'Объекты', icon: 'objects' },
    isLeader ? { path: '/analytics', label: 'Аналитика', icon: 'chart' } : null,
    isLeader ? { path: '/brigade', label: 'Бригада', icon: 'team' } : null,
    { path: '/profile', label: 'Профиль', icon: 'user' }
  ].filter(Boolean);

  const navButtons = navItems.map((item) => {
    const button = h('button.app-nav__item', {
      type: 'button',
      dataset: { path: item.path },
      // Подпись нужна и как подсказка: на средних экранах остаётся только значок.
      title: item.label,
      onclick: () => router.go(item.path)
    },
      h('span.app-nav__icon', { html: iconSvg(item.icon, 22) }),
      h('span.app-nav__label', { text: item.label })
    );
    return button;
  });

  const nav = h('nav.app-nav', { 'aria-label': 'Основные разделы' }, navButtons);

  /* --- Верхняя панель --- */

  const backBtn = h('button.app-header__back.hidden', {
    type: 'button',
    'aria-label': 'Назад',
    onclick: () => window.history.back()
  }, h('span', { html: iconSvg('back', 22) }));

  const titleNode = h('div.app-header__title', { text: CONFIG.APP_NAME });
  const subNode = h('div.app-header__sub', { text: '' });

  const syncIndicator = createSyncIndicator({
    onTap: options.onManualSend,
    onRefresh: options.onRefreshData
  });

  const header = h('header.app-header',
    backBtn,
    h('div.app-header__titles', titleNode, subNode),
    nav,
    h('div.app-header__actions', syncIndicator.el)
  );

  /* --- Область экрана --- */

  const main = h('main.app-main.shell__main');

  /* --- Роутер --- */

  const router = createRouter({
    routes: [
      { path: '/objects', handler: () => renderScreen('/objects', { title: 'Объекты' }) },
      { path: '/object/new', handler: () => renderScreen('/object/new', { title: 'Новый объект', back: true }) },
      { path: '/object/:id/calc', handler: (params) => renderScreen('/object/:id/calc', { title: 'Расчёт', back: true, params: params }) },
      { path: '/object/:id/days', handler: (params) => renderScreen('/object/:id/days', { title: 'Журнал дней', back: true, params: params }) },
      { path: '/object/:id/purchases', handler: (params) => renderScreen('/object/:id/purchases', { title: 'Закупки', back: true, params: params }) },
      { path: '/object/:id/report', handler: (params) => renderScreen('/object/:id/report', { title: 'Отчёт клиенту', back: true, params: params }) },
      { path: '/object/:id', handler: (params) => renderScreen('/object/:id', { title: 'Объект', back: true, params: params }) },
      { path: '/profile', handler: () => renderScreen('/profile', { title: 'Профиль' }) },
      { path: '/brigade', handler: () => renderScreen('/brigade', { title: 'Бригада' }) },
      { path: '/visits', handler: () => renderScreen('/visits', { title: 'Посещения', back: true }) },
      { path: '/prices', handler: () => renderScreen('/prices', { title: 'Прайс', back: true }) },
      { path: '/analytics', handler: () => renderScreen('/analytics', { title: 'Аналитика' }) },
      { path: '/archive', handler: () => renderScreen('/archive', { title: 'Архив' }) },
      { path: '/cabinet/:id', handler: (params) => renderScreen('/cabinet/:id', { title: 'Кабинет клиента', back: true, params: params }) }
    ]
  });

  /* --- Сборка --- */

  // Навигация — часть шапки: на телефоне стили уводят её вниз экрана.
  const el = h('div.shell', header, main);

  /**
   * Регистрация экрана.
   * @param {string} path — ключ, совпадающий с путём в таблице маршрутов
   * @param {Function} factory — (params) => { el, destroy }
   */
  function register(path, factory) {
    screens.set(path, factory);
  }

  /**
   * Обновление заголовка панели.
   * @param {string} title
   * @param {string=} subtitle
   */
  function setTitle(title, subtitle) {
    titleNode.textContent = title || CONFIG.APP_NAME;
    subNode.textContent = subtitle || '';
    subNode.classList.toggle('hidden', !subtitle);
  }

  /**
   * Показ экрана по ключу.
   * @param {string} key
   * @param {Object} meta — { title, back, params }
   */
  function renderScreen(key, meta) {
    const info = meta || {};

    // Освобождаем предыдущий экран.
    if (mounted && typeof mounted.destroy === 'function') {
      try {
        mounted.destroy();
      } catch (error) {
        console.warn('Ошибка при освобождении экрана:', error);
      }
    }
    mounted = null;

    backBtn.classList.toggle('hidden', !info.back);
    setTitle(info.title, info.subtitle);

    // Подсветка активного пункта навигации.
    const basePath = '/' + String(key).split('/')[1];
    navButtons.forEach((button) => {
      const active = button.dataset.path === basePath;
      button.classList.toggle('app-nav__item--active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    const factory = screens.get(key);
    setContent(main);

    if (!factory) {
      main.appendChild(renderSoon_(info.title));
      return;
    }

    // Экранам передаём не только параметры адреса, но и инструменты каркаса:
    // так они могут сами уточнить заголовок и перейти на другой экран.
    const screen = factory(info.params || {}, {
      setTitle: setTitle,
      navigate: (path, replace) => router.go(path, replace)
    });
    if (screen && screen.el) {
      main.appendChild(screen.el);
      mounted = screen;
    }
  }

  /** Заглушка для разделов, которые ещё собираются. */
  function renderSoon_(title) {
    return h('div.shell__soon',
      h('div.shell__soon-mark', { html: iconSvg('clock', 26) }),
      h('div.shell__soon-title', { text: title || 'Раздел' }),
      h('div.shell__soon-text', { text: 'Раздел собирается и появится в ближайшем обновлении приложения.' })
    );
  }

  loadStyles('js/components/AppShell/styles/AppShell.css');

  return {
    el: el,
    router: router,
    register: register,
    setTitle: setTitle,
    render: renderScreen,
    destroy: () => {
      if (mounted && typeof mounted.destroy === 'function') mounted.destroy();
      syncIndicator.destroy();
    }
  };
}
