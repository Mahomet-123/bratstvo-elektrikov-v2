/**
 * ============================================================================
 * Компонент: ObjectsList
 * Ответственность: экран «Объекты» — поиск, отбор по статусу, список карточек
 *                  объектов и кнопка создания нового объекта.
 * Зависимости: core/dom, core/styles, core/store, core/toast, core/format,
 *              api/*, components/common/badges
 * ============================================================================
 */

import { h, setContent, clear, debounce } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store } from '../../core/store.js';
import bundle from '../../core/bundle.js';
import { toastError } from '../../core/toast.js';
import { describeError } from '../../api/apiClient.js';
import { moneyShort, hours, dateShort } from '../../core/format.js';
import { statusBadge } from '../common/badges.js';
import { CONFIG } from '../../config.js';

/** Отборы по статусу, доступные на экране. */
const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'расчёт', label: 'Расчёт' },
  { key: 'в работе', label: 'В работе' },
  { key: 'закрыт', label: 'Закрыты' }
];

/**
 * Создание экрана списка объектов.
 * @param {Object} props
 * @param {Function=} props.onNavigate — переход на другой экран
 * @return {Object} { el, destroy }
 */
export function createObjectsList(props) {
  const options = props || {};

  let objects = [];
  let activeFilter = 'all';
  let search = '';
  let loading = false;

  /* --- Верхняя часть: поиск --- */

  const searchInput = h('input.input.objects__search-input', {
    type: 'search',
    placeholder: 'Название, клиент, адрес или номер',
    autocomplete: 'off',
    oninput: debounce(() => {
      search = searchInput.value.trim().toLowerCase();
      renderList();
    }, 200)
  });

  const searchBox = h('div.objects__search',
    h('span.objects__search-icon', { html: iconSvg('search', 18) }),
    searchInput
  );

  /* --- Отбор по статусу --- */

  const tabsBox = h('div.tabs.objects__tabs');

  /* --- Список --- */

  const listBox = h('div.objects__list');

  /* --- Кнопка создания --- */

  const addBtn = h('button.btn.btn--primary.btn--block.objects__add', {
    type: 'button',
    onclick: () => navigate('/object/new')
  },
    h('span.btn__icon', { html: iconSvg('plus', 18) }),
    'Новый объект'
  );

  const el = h('div.page.objects',
    searchBox,
    tabsBox,
    listBox,
    h('div.objects__foot', addBtn)
  );

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Перерисовка вкладок с учётом количества объектов. */
  function renderTabs() {
    const counts = countByStatus();
    setContent(tabsBox, FILTERS.map((filter) => {
      const count = filter.key === 'all' ? objects.length : (counts[filter.key] || 0);
      const button = h('button.tabs__item', {
        type: 'button',
        class: activeFilter === filter.key ? 'tabs__item--active' : '',
        onclick: () => {
          activeFilter = filter.key;
          renderTabs();
          renderList();
        }
      },
        filter.label,
        count ? h('span.tabs__count', { text: String(count) }) : null
      );
      return button;
    }));
  }

  /** Количество объектов по статусам. */
  function countByStatus() {
    const counts = {};
    objects.forEach((item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
    });
    return counts;
  }

  /** Объекты, прошедшие отбор и поиск. */
  function visibleObjects() {
    let list = objects.slice();
    if (activeFilter !== 'all') {
      list = list.filter((item) => item.status === activeFilter);
    }
    if (search) {
      list = list.filter((item) => {
        const haystack = (item.title + ' ' + item.client + ' ' + item.address + ' ' + item.numberLabel)
          .toLowerCase();
        return haystack.indexOf(search) !== -1;
      });
    }
    return list;
  }

  /** Перерисовка списка. */
  function renderList() {
    clear(listBox);

    if (loading && !objects.length) {
      listBox.appendChild(renderLoading());
      return;
    }

    const list = visibleObjects();

    if (!list.length) {
      listBox.appendChild(renderEmpty());
      return;
    }

    const container = h('div.rows.objects__rows');
    list.forEach((item) => container.appendChild(renderCard(item)));
    listBox.appendChild(container);
  }

  /** Карточка одного объекта. */
  function renderCard(item) {
    const totals = item.totals || {};
    return h('button.object-card.object-card--tap', {
      type: 'button',
      onclick: () => navigate('/object/' + encodeURIComponent(item.id))
    },
      h('div.object-card__top',
        h('span.object-card__num', { text: '№ ' + item.numberLabel }),
        statusBadge(item.status)
      ),
      h('div.object-card__title', { text: item.title || 'Без названия' }),
      item.client || item.address
        ? h('div.object-card__sub', { text: [item.client, item.address].filter(Boolean).join(' · ') })
        : null,
      h('div.object-card__totals',
        h('div.object-card__total',
          h('span.object-card__total-label', { text: 'Смета' }),
          h('span.object-card__total-value', { text: moneyShort(totals.estimate || 0) })
        ),
        h('div.object-card__total',
          h('span.object-card__total-label', { text: 'Закупки' }),
          h('span.object-card__total-value', { text: moneyShort(totals.purchases || 0) })
        ),
        h('div.object-card__total',
          h('span.object-card__total-label', { text: 'Часы' }),
          h('span.object-card__total-value', { text: hours(totals.hours || 0) })
        )
      ),
      item.updated
        ? h('div.object-card__foot', { text: 'Обновлён ' + dateShort(item.updated) })
        : null
    );
  }

  /** Пустое состояние. */
  function renderEmpty() {
    const searching = Boolean(search) || activeFilter !== 'all';
    return h('div.empty',
      h('div.empty__icon.objects__empty-icon', { html: iconSvg('objects', 26) }),
      h('div.empty__title', { text: searching ? 'Ничего не найдено' : 'Пока нет объектов' }),
      h('div.empty__text', {
        text: searching
          ? 'Измените условия поиска или выберите другой отбор.'
          : 'Создайте первый объект — появится лист с расчётом, журналом дней и закупками.'
      })
    );
  }

  /** Состояние загрузки. */
  function renderLoading() {
    return h('div.loading-block',
      h('div.spinner'),
      h('div', { text: 'Загружаем объекты…' })
    );
  }

  /* --------------------------------------------------------------------------
   * Данные
   * ------------------------------------------------------------------------ */

  /**
   * Загрузка списка объектов.
   *
   * Данные разделов лежат в пакете на устройстве (core/bundle.js), поэтому
   * экран рисуется сразу, без обращения к сети. Свежий пакет приходит
   * из ensure(): если он ещё годен, запроса не будет вовсе.
   */
  async function load() {
    const cached = bundle.get();
    if (cached) {
      objects = cached.objects || [];
      loading = false;
      renderTabs();
      renderList();
    }

    loading = true;
    if (!objects.length) renderList();

    try {
      const data = await bundle.ensure();
      objects = (data && data.objects) || [];
      loading = false;
      renderTabs();
      renderList();
    } catch (error) {
      loading = false;
      if (!objects.length) {
        clear(listBox);
        listBox.appendChild(renderError(describeError(error)));
      } else {
        toastError(describeError(error));
      }
    }
  }

  /** Состояние ошибки загрузки. */
  function renderError(message) {
    return h('div.empty',
      h('div.empty__icon.objects__empty-icon', { html: iconSvg('alert', 26) }),
      h('div.empty__title', { text: 'Не удалось загрузить объекты' }),
      h('div.empty__text', { text: message }),
      h('div', { style: { marginTop: '16px' } },
        h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
      )
    );
  }

  /** Переход на другой экран. */
  function navigate(path) {
    if (typeof options.onNavigate === 'function') {
      options.onNavigate(path);
    } else {
      window.location.hash = '#' + path;
    }
  }

  loadStyles('js/components/ObjectsList/styles/ObjectsList.css');

  renderTabs();
  renderList();
  load();

  // Обновляем список, когда он меняется извне (например, после создания объекта).
  const unsubscribe = store.subscribe(() => {
    const fresh = store.get().objects;
    if (Array.isArray(fresh) && fresh !== objects) {
      objects = fresh;
      renderTabs();
      renderList();
    }
  });

  return {
    el: el,
    refresh: load,
    destroy: unsubscribe
  };
}

export default createObjectsList;
