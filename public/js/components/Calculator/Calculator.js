/**
 * ============================================================================
 * Компонент: Calculator
 * Ответственность: расчёт стоимости работ по объекту — подбор позиций из прайса,
 *                  количество, коэффициенты, снабжение материалом, пусконаладка
 *                  и скидка. Итог считается сразу, окончательные числа — с сервера.
 * Зависимости: core/dom, core/styles, core/store, core/toast, core/format,
 *              core/estimate, api/*, components/Calculator/CalcPicker
 * ============================================================================
 */

import { h, setContent, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store, cachePrices, readCachedPrices } from '../../core/store.js';
import { toastSuccess, toastError } from '../../core/toast.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { money, moneyShort, num, percent, countLabel } from '../../core/format.js';
import { computeEstimate, ESTIMATE_RULES } from '../../core/estimate.js';
import { openCalcPicker } from './CalcPicker.js';
import { CONFIG } from '../../config.js';

/**
 * Разбор числа из поля ввода: запятая как десятичный разделитель.
 * @param {*} value
 * @return {number}
 */
function parseNum(value) {
  const n = Number(String(value === undefined || value === null ? '' : value).replace(',', '.'));
  return isFinite(n) ? n : 0;
}

/**
 * Создание экрана расчёта.
 * @param {Object} props
 * @param {string} props.id — идентификатор объекта
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, destroy }
 */
export function createCalculator(props) {
  const options = props || {};
  const id = options.id;

  let object = null;
  let prices = null;
  let rows = [];
  let params = {
    coefficient: 1,
    materialCost: 0,
    equipmentCost: 0,
    discount: 0,
    discountType: 'sum'
  };
  let live = null;
  let saving = false;

  /** Правила расчёта: берём из прайса, иначе — значения по умолчанию. */
  function rules() {
    return (prices && prices.rules) ? prices.rules : ESTIMATE_RULES;
  }

  /* --------------------------------------------------------------------------
   * Разметка
   * ------------------------------------------------------------------------ */

  const summaryBox = h('div.calc__summary');
  const rowsBox = h('div.calc__rows');
  const paramsBox = h('div.calc__params');
  const errorBox = h('div.calc__error');

  const addBtn = h('button.btn.btn--ghost.btn--block', {
    type: 'button',
    onclick: () => openPicker()
  },
    h('span.btn__icon', { html: iconSvg('plus', 18) }),
    'Добавить позицию'
  );

  const saveBtn = h('button.btn.btn--primary.btn--block.calc__save', {
    type: 'button',
    onclick: () => save()
  }, 'Сохранить расчёт');

  const el = h('div.page.calc',
    summaryBox,
    errorBox,
    h('div.calc__section',
      h('div.page__section-title', { text: 'Позиции расчёта' }),
      rowsBox,
      h('div.calc__add', addBtn)
    ),
    h('div.calc__section',
      h('div.page__section-title', { text: 'Наценки и скидка' }),
      paramsBox
    ),
    saveBtn
  );

  /* --------------------------------------------------------------------------
   * Итог
   * ------------------------------------------------------------------------ */

  /** Перерисовка блока итога. */
  function renderSummary() {
    if (!live) return;

    const material = live.materialCost;
    const supplyHint = material > 0 && live.supply === live.supplyMin
      ? 'минимум ' + moneyShort(live.supplyMin)
      : percent(live.supplyPercent) + ' от материала';

    setContent(summaryBox,
      h('div.calc-summary',
        h('div.calc-summary__top',
          h('div.calc-summary__label', { text: 'Итого по расчёту' }),
          h('div.calc-summary__total', { text: money(live.total) })
        ),
        h('div.calc-summary__lines',
          summaryLine('Работы (подытог)', money(live.subtotal)),
          material > 0 ? summaryLine('Снабжение материалом', money(live.supply), supplyHint) : null,
          live.commissioning > 0
            ? summaryLine('Пусконаладка', money(live.commissioning), percent(live.commissioningPercent) + ' от оборудования')
            : null,
          live.discount > 0
            ? summaryLine('Скидка', '−' + money(live.discount),
              live.discountType === 'percent' ? num(live.discountValue) + '%' : 'фиксированная')
            : null
        ),
        h('div.calc-summary__positions', {
          text: live.positions
            ? countLabel(live.positions, ['позиция', 'позиции', 'позиций'])
            : 'Позиции не выбраны'
        })
      )
    );
  }

  /** Строка расшифровки итога. */
  function summaryLine(label, value, hint) {
    return h('div.calc-summary__line',
      h('span.calc-summary__line-label',
        label,
        hint ? h('span.calc-summary__line-hint', { text: hint }) : null
      ),
      h('span.calc-summary__line-value', { text: value })
    );
  }

  /* --------------------------------------------------------------------------
   * Позиции
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка списка позиций. */
  function renderRows() {
    clear(rowsBox);

    if (!rows.length) {
      rowsBox.appendChild(h('div.card.calc__empty',
        h('div.empty',
          h('div.empty__icon.calc__empty-icon', { html: iconSvg('calc', 26) }),
          h('div.empty__title', { text: 'Смета пуста' }),
          h('div.empty__text', { text: 'Добавьте работы из прайса — цены подставятся автоматически.' })
        )
      ));
      return;
    }

    const list = h('div.calc__list');
    rows.forEach((row) => list.appendChild(renderRow(row)));
    rowsBox.appendChild(list);
  }

  /** Строка позиции расчёта с полями количества и коэффициента. */
  function renderRow(row) {
    const sumNode = h('span.calc-row__sum', { text: money(rowSum(row)) });

    const qtyInput = h('input.input.input--sm.calc-row__input', {
      type: 'text',
      inputmode: 'decimal',
      value: formatInput(row.qty),
      'aria-label': 'Количество',
      oninput: () => {
        row.qty = parseNum(qtyInput.value);
        refreshNumbers();
      }
    });

    const coeffInput = h('input.input.input--sm.calc-row__input', {
      type: 'text',
      inputmode: 'decimal',
      value: formatInput(row.coeff),
      'aria-label': 'Коэффициент',
      oninput: () => {
        row.coeff = parseNum(coeffInput.value);
        refreshNumbers();
      }
    });

    const removeBtn = h('button.calc-row__remove', {
      type: 'button',
      'aria-label': 'Убрать позицию',
      onclick: () => {
        rows = rows.filter((item) => item !== row);
        renderRows();
        refreshNumbers();
      }
    }, h('span', { html: iconSvg('trash', 18) }));

    return h('div.card.calc-row',
      h('div.calc-row__head',
        h('div.calc-row__title', { text: row.name || 'Позиция' }),
        removeBtn
      ),
      h('div.calc-row__meta', {
        text: [row.section, row.unit, money(row.price)].filter(Boolean).join(' · ')
      }),
      h('div.calc-row__fields',
        h('label.calc-row__field',
          h('span.calc-row__field-label', { text: 'Кол-во' }),
          qtyInput
        ),
        h('label.calc-row__field',
          h('span.calc-row__field-label', { text: 'Коэф.' }),
          coeffInput
        ),
        h('div.calc-row__field.calc-row__field--sum',
          h('span.calc-row__field-label', { text: 'Сумма' }),
          sumNode
        )
      )
    );
  }

  /** Число для поля ввода: без лишних нулей. */
  function formatInput(value) {
    const n = Number(value) || 0;
    if (Number.isInteger(n)) return String(n);
    return String(n).replace('.', ',');
  }

  /** Сумма одной строки. */
  function rowSum(row) {
    const coeff = Number(row.coeff) > 0 ? Number(row.coeff) : (Number(params.coefficient) || 1);
    return Math.round((Number(row.price) || 0) * (Number(row.qty) || 0) * coeff * 100) / 100;
  }

  /** Обновление всех чисел без перерисовки полей ввода. */
  function refreshNumbers() {
    live = computeEstimate(rows, params, rules());
    renderSummary();
    const sums = rowsBox.querySelectorAll('.calc-row__sum');
    rows.forEach((row, index) => {
      if (sums[index]) sums[index].textContent = money(rowSum(row));
    });
  }

  /* --------------------------------------------------------------------------
   * Параметры
   * ------------------------------------------------------------------------ */

  /** Перерисовка блока наценок и скидки. */
  function renderParams() {
    const materialInput = h('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: params.materialCost ? formatInput(params.materialCost) : '',
      placeholder: '0',
      oninput: () => {
        params.materialCost = parseNum(materialInput.value);
        refreshNumbers();
      }
    });

    const equipmentInput = h('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: params.equipmentCost ? formatInput(params.equipmentCost) : '',
      placeholder: '0',
      oninput: () => {
        params.equipmentCost = parseNum(equipmentInput.value);
        refreshNumbers();
      }
    });

    const discountInput = h('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: params.discount ? formatInput(params.discount) : '',
      placeholder: '0',
      oninput: () => {
        params.discount = parseNum(discountInput.value);
        refreshNumbers();
      }
    });

    // Контейнер создаём отдельно: кнопки ссылаются на него при переключении вида.
    const typeTabs = h('div.tabs.calc__discount-tabs');
    typeTabs.appendChild(discountTypeButton('sum', 'Сумма, ₽', discountInput, typeTabs));
    typeTabs.appendChild(discountTypeButton('percent', 'Процент, %', discountInput, typeTabs));

    const rulesInfo = rules();

    setContent(paramsBox,
      h('div.card',
        h('div.card__body',
          h('label.field',
            h('span.field__label', { text: 'Стоимость материала, ₽' }),
            materialInput,
            h('span.field__hint', {
              text: 'Наценка за снабжение: ' + percent(rulesInfo.supplyPercent) +
                ', но не меньше ' + moneyShort(rulesInfo.supplyMin) + '.'
            })
          ),
          h('label.field',
            h('span.field__label', { text: 'Стоимость оборудования, ₽' }),
            equipmentInput,
            h('span.field__hint', {
              text: 'Пусконаладка: ' + percent(rulesInfo.commissioningPercent) + ' от стоимости оборудования.'
            })
          ),
          h('div.field',
            h('span.field__label', { text: 'Скидка' }),
            typeTabs,
            h('div', { style: { marginTop: '8px' } }, discountInput)
          )
        )
      )
    );
  }

  /** Кнопка переключения вида скидки. */
  function discountTypeButton(type, label, discountInput, container) {
    const button = h('button.tabs__item', {
      type: 'button',
      class: params.discountType === type ? 'tabs__item--active' : '',
      onclick: () => {
        params.discountType = type;
        // Перерисовываем только подписи вкладок, чтобы не потерять ввод.
        Array.prototype.forEach.call(container.children, (child, index) => {
          const isActive = (index === 0 ? 'sum' : 'percent') === type;
          child.classList.toggle('tabs__item--active', isActive);
        });
        discountInput.placeholder = type === 'percent' ? '% от суммы' : '₽ от суммы';
        refreshNumbers();
      }
    }, label);
    return button;
  }

  /* --------------------------------------------------------------------------
   * Выбор позиций
   * ------------------------------------------------------------------------ */

  /** Открыть окно выбора позиций прайса. */
  async function openPicker() {
    if (!prices) {
      toastError('Прайс ещё не загружен. Проверьте связь.');
      return;
    }

    const addedIds = new Set(rows.map((row) => row.id).filter(Boolean));

    await openCalcPicker({
      prices: prices,
      addedIds: addedIds,
      onPick: (item) => {
        rows.push({
          id: item.id,
          section: item.section,
          position: item.n,
          name: item.name,
          unit: item.unit,
          price: item.price,
          qty: 1,
          coeff: Number(params.coefficient) || 1,
          note: ''
        });
        renderRows();
        refreshNumbers();
      }
    });
  }

  /* --------------------------------------------------------------------------
   * Сохранение
   * ------------------------------------------------------------------------ */

  /** Сохранить расчёт на сервере. */
  async function save() {
    if (saving) return;

    if (!rows.length) {
      toastError('Добавьте хотя бы одну позицию');
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохраняем…';

    try {
      const payload = {
        rows: rows.map((row) => ({
          id: row.id,
          section: row.section,
          position: row.position,
          name: row.name,
          unit: row.unit,
          price: row.price,
          qty: row.qty,
          coeff: row.coeff,
          note: row.note || ''
        })),
        coefficient: params.coefficient,
        materialCost: params.materialCost,
        equipmentCost: params.equipmentCost,
        discount: params.discount,
        discountType: params.discountType
      };

      const result = await api.calcSave(id, payload);
      const estimate = result.estimate;

      // Переходим на числа, которые посчитал сервер.
      rows = estimate.rows.map((row) => ({
        id: row.id,
        section: row.section,
        position: row.position,
        name: row.name,
        unit: row.unit,
        price: row.price,
        qty: row.qty,
        coeff: row.coeff,
        note: row.note
      }));
      params = {
        coefficient: estimate.coefficient,
        materialCost: estimate.materialCost,
        equipmentCost: estimate.equipmentCost,
        discount: estimate.discountValue,
        discountType: estimate.discountType
      };

      renderRows();
      renderParams();
      refreshNumbers();
      toastSuccess('Расчёт сохранён: ' + money(estimate.total));
    } catch (error) {
      toastError(describeError(error));
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить расчёт';
    }
  }

  /* --------------------------------------------------------------------------
   * Загрузка
   * ------------------------------------------------------------------------ */

  /** Загрузка объекта, расчёта и прайса. */
  async function load() {
    // Прайс: сначала кэш, затем сервер.
    const cached = readCachedPrices(true) || store.get().prices;
    if (cached) prices = cached;

    try {
      const card = await api.calcGet(id);
      object = card.object;
      const estimate = card.estimate;

      rows = (estimate.rows || []).map((row) => ({
        id: row.id,
        section: row.section,
        position: row.position,
        name: row.name,
        unit: row.unit,
        price: row.price,
        qty: row.qty,
        coeff: row.coeff,
        note: row.note
      }));
      params = {
        coefficient: estimate.coefficient || 1,
        materialCost: estimate.materialCost || 0,
        equipmentCost: estimate.equipmentCost || 0,
        discount: estimate.discountValue || 0,
        discountType: estimate.discountType || 'sum'
      };

      clear(errorBox);
      renderRows();
      renderParams();
      refreshNumbers();

      if (typeof options.onTitle === 'function') {
        options.onTitle('Расчёт', object ? '№ ' + object.numberLabel : '');
      }
    } catch (error) {
      setContent(errorBox, h('div.empty',
        h('div.empty__icon.calc__empty-icon', { html: iconSvg('alert', 26) }),
        h('div.empty__title', { text: 'Не удалось загрузить расчёт' }),
        h('div.empty__text', { text: describeError(error) }),
        h('div', { style: { marginTop: '16px' } },
          h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
        )
      ));
      return;
    }

    // Прайс может прийти позже — обновляем и пересчитываем правила.
    if (!prices) {
      try {
        prices = await api.pricesList();
        cachePrices(prices);
        renderParams();
        refreshNumbers();
      } catch (error) {
        toastError('Прайс не загружен: ' + describeError(error));
      }
    }
  }

  loadStyles('js/components/Calculator/styles/Calculator.css');

  setContent(summaryBox, h('div.loading-block', h('div.spinner'), h('div', { text: 'Готовим расчёт…' })));
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createCalculator;
