/**
 * ============================================================================
 * Компонент: Prices
 * Ответственность: просмотр всего прайса по разделам — только чтение.
 *                  Показываем работы, коэффициенты и служебные строки: человеку
 *                  нужно видеть весь справочник, а не только то, что попадает
 *                  в смету.
 *                  Данные берутся из прайса, уже сохранённого на устройстве,
 *                  поэтому экран открывается мгновенно.
 * Зависимости: core/dom, core/styles, core/store, core/toast, core/format, api/*
 * ============================================================================
 */

import { h, clear, setContent, debounce } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store, cachePrices, readCachedPrices } from '../../core/store.js';
import { toastError } from '../../core/toast.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { money, countLabel } from '../../core/format.js';

/** Название вида строки прайса. */
const KIND_LABEL = {
  work: 'работа',
  coefficient: 'коэффициент',
  percent: 'процент',
  note: 'примечание'
};

/**
 * Создание экрана прайса.
 * @param {Object} props
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createPrices(props) {
  const options = props || {};

  let prices = readCachedPrices(true) || store.get().prices || null;
  let query = '';

  const searchInput = h('input.input.prices__search', {
    type: 'search',
    placeholder: 'Поиск по названию',
    autocomplete: 'off',
    oninput: debounce(() => {
      query = searchInput.value.trim().toLowerCase();
      renderList();
    }, 180)
  });

  const summaryBox = h('div.prices__summary');
  const listBox = h('div.prices__list');

  const el = h('div.page.prices',
    summaryBox,
    h('div.card.card--flat',
      h('div.card__body',
        searchInput,
        h('span.prices__hint', {
          text: 'Справочник цен. Чтобы добавить работу в смету, откройте расчёт объекта.'
        })
      )
    ),
    listBox
  );

  /** Строки раздела, прошедшие поиск. */
  function itemsOf(section) {
    const items = (section.items || []);
    if (!query) return items;
    return items.filter((item) => {
      const haystack = [item.name, item.unit, item.section].filter(Boolean).join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
  }

  /** Итоги по прайсу. */
  function renderSummary() {
    const total = prices ? (prices.total || 0) : 0;
    const sections = prices ? (prices.sections || []).length : 0;

    setContent(summaryBox,
      h('div.stats',
        h('div.stat',
          h('div.stat__label', { text: 'Позиций' }),
          h('div.stat__value', { text: String(total) })
        ),
        h('div.stat',
          h('div.stat__label', { text: 'Разделов' }),
          h('div.stat__value', { text: String(sections) })
        )
      )
    );
  }

  /** Одна строка прайса. */
  function renderItem(item) {
    const kind = item.kind && item.kind !== 'work' ? KIND_LABEL[item.kind] : '';

    return h('div.row.prices__row',
      h('span.prices__num', { text: item.n === undefined || item.n === null ? '' : String(item.n) }),
      h('span.row__main',
        h('span.row__title', { text: item.name || '—' }),
        h('span.row__sub', {
          text: [item.unit || '', kind].filter(Boolean).join(' · ')
        })
      ),
      h('span.row__side',
        h('span.prices__price', {
          text: typeof item.price === 'number' ? money(item.price) : (item.price || '')
        })
      )
    );
  }

  /** Список разделов. */
  function renderList() {
    clear(listBox);

    if (!prices) {
      listBox.appendChild(h('div.empty',
        h('div.empty__icon.prices__empty-icon', { html: iconSvg('alert', 26) }),
        h('div.empty__title', { text: 'Прайс ещё не загружен' }),
        h('div.empty__text', { text: 'Проверьте связь и попробуйте снова.' }),
        h('div', { style: { marginTop: '16px' } },
          h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
        )
      ));
      return;
    }

    let shown = 0;

    (prices.sections || []).forEach((section) => {
      const items = itemsOf(section);
      if (!items.length) return;
      shown += items.length;

      const rows = h('div.rows.prices__rows', items.map(renderItem));

      listBox.appendChild(h('div.prices__section',
        h('div.prices__section-head',
          h('span.prices__section-name', { text: section.name || 'Без названия' }),
          h('span.prices__section-count', {
            text: countLabel(items.length, ['позиция', 'позиции', 'позиций'])
          })
        ),
        rows
      ));
    });

    if (!shown) {
      listBox.appendChild(h('div.empty',
        h('div.empty__icon.prices__empty-icon', { html: iconSvg('search', 26) }),
        h('div.empty__title', { text: 'Ничего не найдено' }),
        h('div.empty__text', { text: 'Попробуйте другое название.' })
      ));
    }

    if (typeof options.onTitle === 'function') {
      options.onTitle('Прайс', countLabel(shown, ['позиция', 'позиции', 'позиций']));
    }
  }

  /** Загрузка прайса: сохранённый показываем сразу, свежий — следом. */
  async function load() {
    const cached = readCachedPrices(true) || store.get().prices;
    if (cached && !prices) {
      prices = cached;
      renderSummary();
      renderList();
    }

    try {
      const fresh = await api.pricesList();
      prices = fresh;
      cachePrices(fresh);
      renderSummary();
      renderList();
    } catch (error) {
      // Сохранённый прайс уже показан — сообщаем, только если показывать нечего.
      if (!prices) toastError(describeError(error));
    }
  }

  loadStyles('js/components/Prices/styles/Prices.css');

  renderSummary();
  renderList();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createPrices;
