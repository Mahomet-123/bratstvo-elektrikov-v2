/**
 * ============================================================================
 * Компонент: CalcPicker
 * Ответственность: окно выбора позиций прайса для расчёта — поиск по разделам
 *                  и добавление работ в смету. Можно добавить несколько позиций
 *                  подряд, не закрывая окно.
 * Зависимости: core/dom, core/modal, core/format, core/icons
 * ============================================================================
 */

import { h, clear, debounce } from '../../core/dom.js';
import { openModal } from '../../core/modal.js';
import { iconSvg } from '../../core/icons.js';
import { money } from '../../core/format.js';

/**
 * Открыть окно выбора позиций.
 * @param {Object} options
 * @param {Object} options.prices — полный прайс с разделами
 * @param {Function} options.onPick — (item) => void, вызывается при выборе позиции
 * @param {Set<string>=} options.addedIds — уже добавленные позиции
 * @return {Promise<void>}
 */
export function openCalcPicker(options) {
  const config = options || {};
  const prices = config.prices || { sections: [], rules: {} };
  const added = config.addedIds instanceof Set ? config.addedIds : new Set();
  const onPick = typeof config.onPick === 'function' ? config.onPick : () => {};

  let query = '';
  const expanded = {};

  const searchInput = h('input.input.calc-picker__search', {
    type: 'search',
    placeholder: 'Поиск работы по названию',
    autocomplete: 'off',
    oninput: debounce(() => {
      query = searchInput.value.trim().toLowerCase();
      renderSections();
    }, 180)
  });

  const listBox = h('div.calc-picker__list');
  const counterBox = h('div.calc-picker__counter');

  /** Обновление счётчика добавленных. */
  function renderCounter() {
    const total = added.size;
    counterBox.textContent = total
      ? 'В смете: ' + total
      : 'Выберите работы из прайса';
  }

  /** Список разделов с позициями. */
  function renderSections() {
    clear(listBox);

    const searching = query.length > 0;
    let shown = 0;

    (prices.sections || []).forEach((section) => {
      // В расчёт берём только работы: коэффициенты, проценты и примечания — служебные.
      const works = (section.items || []).filter((item) => item.kind === 'work');
      const items = searching
        ? works.filter((item) => item.name.toLowerCase().indexOf(query) !== -1)
        : works;

      if (!items.length) return;
      shown += items.length;

      const isOpen = searching || expanded[section.name];

      const head = h('button.calc-picker__section-head', {
        type: 'button',
        onclick: () => {
          expanded[section.name] = !expanded[section.name];
          renderSections();
        }
      },
        h('span.calc-picker__section-name', { text: section.name }),
        h('span.calc-picker__section-count', { text: String(items.length) }),
        h('span.calc-picker__section-arrow', {
          class: isOpen ? 'calc-picker__section-arrow--open' : '',
          html: iconSvg('back', 16)
        })
      );

      const group = h('div.calc-picker__section', head);

      if (isOpen) {
        const rows = h('div.calc-picker__items');
        items.forEach((item) => rows.appendChild(renderItem(item)));
        group.appendChild(rows);
      }

      listBox.appendChild(group);
    });

    if (!shown) {
      listBox.appendChild(h('div.empty',
        h('div.empty__title', { text: searching ? 'Ничего не найдено' : 'Прайс пуст' }),
        h('div.empty__text', {
          text: searching
            ? 'Попробуйте другое название работы.'
            : 'Загляните позже — прайс ещё не загружен.'
        })
      ));
    }
  }

  /** Строка позиции прайса. */
  function renderItem(item) {
    const isAdded = added.has(item.id);
    return h('button.calc-picker__item', {
      type: 'button',
      class: isAdded ? 'calc-picker__item--added' : '',
      onclick: () => {
        if (added.has(item.id)) return;
        added.add(item.id);
        onPick(item);
        renderItemState(item.id);
        renderCounter();
      },
      dataset: { itemId: item.id }
    },
      h('span.calc-picker__item-main',
        h('span.calc-picker__item-name', { text: item.name }),
        h('span.calc-picker__item-meta', {
          text: [item.unit, money(item.price)].filter(Boolean).join(' · ')
        })
      ),
      h('span.calc-picker__item-side', {
        html: iconSvg(isAdded ? 'check' : 'plus', 18)
      })
    );
  }

  /** Точечное обновление вида строки после добавления. */
  function renderItemState(itemId) {
    const node = listBox.querySelector('[data-item-id="' + itemId + '"]');
    if (!node) return;
    node.classList.add('calc-picker__item--added');
    const side = node.querySelector('.calc-picker__item-side');
    if (side) side.innerHTML = iconSvg('check', 18);
  }

  const body = h('div.calc-picker',
    searchInput,
    counterBox,
    listBox
  );

  renderSections();
  renderCounter();

  return openModal({
    title: 'Позиции прайса',
    body: body,
    actions: [{ label: 'Готово', variant: 'primary', value: true }]
  });
}

export default openCalcPicker;
