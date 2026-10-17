/**
 * ============================================================================
 * Компонент: Purchases
 * Ответственность: закупки объекта — материал, количество, цена, комментарий
 *                  и фото накладной. Сумма строки считается на сервере.
 *                  Если сети нет, запись вместе с фотографией уходит в
 *                  офлайн-очередь и отправится сама, когда связь появится.
 * Зависимости: core/dom, core/styles, core/store, core/toast, core/modal,
 *              core/format, core/sync, api/*, components/PhotoUploader
 * ============================================================================
 */

import { h, setContent, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { toastSuccess, toastError, toastWarning } from '../../core/toast.js';
import { confirmDialog, openModal } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import {
  money, moneyShort, num, dateShort, dateWithWeekday, today, countLabel
} from '../../core/format.js';
import { runBusy } from '../../core/busy.js';
import objectCache from '../../core/objectCache.js';
import { sendNow, enqueue, isOfflineError } from '../../core/sync.js';
import { createPhotoUploader } from '../PhotoUploader/PhotoUploader.js';

/** Наценка на материал: процент от суммы закупок и её минимум (как на сервере). */
const MARKUP_PERCENT = 10;
const MARKUP_MIN = 1500;

/** Единицы измерения, принятые в бригаде. */
const UNITS = ['шт', 'м', 'м²', 'кг', 'л', 'упак', 'рул', 'компл', 'пач'];

/**
 * Создание экрана закупок.
 * @param {Object} props
 * @param {string} props.id — идентификатор объекта
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createPurchases(props) {
  const options = props || {};
  const id = options.id;

  let items = [];
  let summary = { sum: 0, total: 0, markup: false, markupSum: 0 };
  let loading = true;

  /* --------------------------------------------------------------------------
   * Форма
   * ------------------------------------------------------------------------ */

  /** Сколько строк показываем сразу: за один заход обычно берут несколько. */
  const DEFAULT_ROWS = 3;

  /** Режим ввода: 'material' — материал или товар, 'invoice' — целая накладная. */
  let mode = 'material';

  /** Строки формы: у каждой свои поля, чтобы значения не путались. */
  const rows = [];
  let rowSeq = 0;

  const dateInput = h('input.input', { type: 'date', value: today() });

  const commentInput = h('textarea.textarea', {
    placeholder: 'Комментарий: где куплено, номер накладной',
    rows: '2'
  });

  const uploader = createPhotoUploader({
    hint: 'Фото накладной уменьшится до ~300 КБ'
  });

  const previewNode = h('div.purchase-form__preview');
  const rowsBox = h('div.purchase-form__rows');
  const rowsHint = h('div.purchase-form__rows-hint');

  const modeButtons = {
    material: h('button.purchase-form__mode', {
      type: 'button',
      onclick: () => setMode('material')
    }, 'Материал или товар'),
    invoice: h('button.purchase-form__mode', {
      type: 'button',
      onclick: () => setMode('invoice')
    }, 'По накладной')
  };

  const markupInput = h('input.purchase-form__check', {
    type: 'checkbox',
    checked: false,
    onchange: updatePreview
  });

  const submitBtn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, 'Записать закупку');

  const form = h('form.card.purchase-form', {
    onsubmit: (event) => {
      event.preventDefault();
      submit();
    }
  },
    h('div.card__head', h('div.card__title', { text: 'Новая закупка' })),
    h('div.card__body',
      h('label.field',
        h('span.field__label', { text: 'Дата' }),
        dateInput
      ),
      h('div.field',
        h('span.field__label', { text: 'Что записываем' }),
        h('div.purchase-form__modes', modeButtons.material, modeButtons.invoice),
        h('span.field__hint', { text: 'По накладной: количество не нужно, единица — ЧЕК.' })
      ),
      h('div.field',
        h('span.field__label', { text: 'Позиции' }),
        rowsBox,
        h('div.purchase-form__add',
          h('button.btn.btn--ghost.btn--block', {
            type: 'button',
            onclick: () => { addRow(); updatePreview(); }
          },
            h('span.btn__icon', { html: iconSvg('plus', 18) }),
            'Добавить строку'
          )
        ),
        rowsHint
      ),
      previewNode,
      h('label.field',
        h('span.field__label', { text: 'Комментарий' }),
        commentInput
      ),
      h('div.field',
        h('span.field__label', { text: 'Фото накладной' }),
        uploader.el
      ),
      h('label.purchase-form__markup',
        markupInput,
        h('span.purchase-form__markup-text',
          h('span.purchase-form__markup-title', {
            text: 'Наценка на материал (+' + MARKUP_PERCENT + '%, мин. ' + moneyShort(MARKUP_MIN) + ')'
          }),
          h('span.purchase-form__markup-hint', {
            text: 'Считается от суммы закупок по объекту. Включить или обнулить можно и в итогах ниже.'
          })
        )
      ),
      submitBtn
    )
  );

  /** Переключение режима ввода. */
  function setMode(next) {
    if (mode === next) return;
    mode = next;

    modeButtons.material.classList.toggle('purchase-form__mode--active', mode === 'material');
    modeButtons.invoice.classList.toggle('purchase-form__mode--active', mode === 'invoice');

    // Перерисовываем строки: в режиме накладной у них другие подписи.
    clearRows();
    for (let i = 0; i < DEFAULT_ROWS; i++) addRow();
    updatePreview();
  }

  /** Новая строка ввода. */
  function addRow() {
    const id = ++rowSeq;
    const isInvoice = mode === 'invoice';

    const nameInput = h('input.input.purchase-form__name', {
      type: 'text',
      autocomplete: 'off',
      placeholder: isInvoice ? 'Номер или название накладной' : 'Кабель, автомат…',
      oninput: updatePreview
    });

    const qtyInput = h('input.input.purchase-form__qty', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: isInvoice ? '1' : '0',
      autocomplete: 'off',
      disabled: isInvoice,
      oninput: updatePreview
    });
    if (isInvoice) qtyInput.value = '1';

    const unitSelect = h('select.select.purchase-form__unit', {},
      UNITS.map((unit) => h('option', { value: unit, text: unit }))
    );
    unitSelect.value = 'шт';

    const priceInput = h('input.input.purchase-form__price', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: isInvoice ? 'сумма' : '0,00',
      autocomplete: 'off',
      oninput: updatePreview
    });

    const qtyGroup = h('div.purchase-form__qty-group',
      qtyInput,
      isInvoice
        ? h('span.purchase-form__unit-fixed', { text: 'ЧЕК' })
        : unitSelect
    );

    const removeBtn = h('button.purchase-form__remove', {
      type: 'button',
      'aria-label': 'Убрать строку',
      title: 'Убрать строку',
      onclick: () => { removeRow(id); updatePreview(); }
    }, h('span', { html: iconSvg('close', 15) }));

    const el = h('div.purchase-form__row', nameInput, qtyGroup, priceInput, removeBtn);

    rows.push({
      id: id,
      el: el,
      nameInput: nameInput,
      qtyInput: qtyInput,
      unitSelect: unitSelect,
      priceInput: priceInput
    });

    rowsBox.appendChild(el);
  }

  /** Убрать все строки разом (при смене режима). */
  function clearRows() {
    rows.forEach((row) => row.el.remove());
    rows.length = 0;
  }

  /** Удаление строки. Последнюю не убираем: вводить будет некуда. */
  function removeRow(id, silent) {
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return;
    if (rows.length <= 1) {
      if (!silent) toastWarning('Хотя бы одна строка должна остаться');
      return;
    }

    rows[index].el.remove();
    rows.splice(index, 1);
  }

  /** Заполненные строки — пустые при отправке просто пропускаются. */
  function filledRows() {
    const out = [];

    rows.forEach((row, index) => {
      const name = row.nameInput.value.trim();
      const priceRaw = row.priceInput.value.trim();
      // В режиме накладной количество всегда «1», поэтому пустоту определяем
      // по названию и сумме: иначе все строки считались бы заполненными.
      const qtyRaw = mode === 'invoice' ? '' : row.qtyInput.value.trim();

      // Строка пустая — её не записываем и место в таблице не занимаем.
      if (!name && !qtyRaw && !priceRaw) return;

      out.push({
        index: index,
        name: name,
        qty: mode === 'invoice' ? 1 : parseNumber(qtyRaw),
        price: parseNumber(priceRaw),
        unit: mode === 'invoice' ? 'ЧЕК' : row.unitSelect.value
      });
    });

    return out;
  }

  /** Предварительная сумма по введённым строкам. */
  function updatePreview() {
    const list = filledRows();
    const sum = list.reduce((acc, row) => acc + (row.qty > 0 && row.price >= 0 ? row.qty * row.price : 0), 0);

    setContent(previewNode, sum > 0
      ? h('div.purchase-form__sum',
        h('span.purchase-form__sum-label', {
          text: list.length > 1 ? 'Сумма по строкам' : 'Сумма строки'
        }),
        h('span.purchase-form__sum-value', { text: money(sum) })
      )
      : null);

    rowsHint.textContent = list.length
      ? 'К записи: ' + countLabel(list.length, ['строка', 'строки', 'строк'])
      : 'Пустые строки не записываются';
  }

  /* --------------------------------------------------------------------------
   * Итог и список
   * ------------------------------------------------------------------------ */

  const summaryBox = h('div.purchases__summary');
  const listBox = h('div.purchases__list');

  const el = h('div.page.purchases',
    summaryBox,
    form,
    h('div.purchases__section',
      h('div.page__section-title', { text: 'Закупки по объекту' }),
      listBox
    )
  );

  /**
   * Итог по всем закупкам.
   *
   * Средний блок — наценка на материал. Он же переключатель: нажатие включает
   * наценку от общей суммы закупок, повторное — обнуляет.
   */
  function renderSummary() {
    const sum = summary.sum || 0;
    const markup = summary.markupSum || 0;

    setContent(summaryBox,
      h('div.stats.purchases__stats',
        h('div.stat',
          h('div.stat__label', { text: 'Закуплено' }),
          h('div.stat__value', { text: moneyShort(sum) })
        ),
        h('button.stat.purchases__markup', {
          type: 'button',
          class: summary.markup ? 'purchases__markup--on' : '',
          'aria-pressed': summary.markup ? 'true' : 'false',
          title: summary.markup
            ? 'Наценка включена. Нажмите, чтобы обнулить'
            : 'Нажмите, чтобы начислить наценку на материал',
          onclick: (event) => toggleMarkup(event.currentTarget)
        },
          h('div.stat__label', { text: 'Итог закупки' }),
          h('div.stat__value', { text: moneyShort(sum + markup) }),
          h('div.purchases__markup-hint', {
            text: markup > 0 ? 'наценка ' + moneyShort(markup) : 'наценка 0'
          })
        ),
        h('div.stat',
          h('div.stat__label', { text: 'Записей' }),
          h('div.stat__value', { text: String(summary.total || 0) })
        )
      )
    );
  }

  /** Включить или обнулить наценку на материал по объекту. */
  async function toggleMarkup(button) {
    const next = !summary.markup;

    await runBusy(button, next ? 'Начисляем…' : 'Обнуляем…', async () => {
      try {
        const result = await api.objectSetMarkup(id, next);
        summary.markup = next;
        summary.markupSum = result && result.object && result.object.totals
          ? result.object.totals.markupSum
          : 0;

        markupInput.checked = next;
        objectCache.markStale(id);
        renderSummary();
        toastSuccess(next
          ? 'Наценка на материал: ' + moneyShort(summary.markupSum)
          : 'Наценка на материал обнулена');
      } catch (error) {
        toastError(describeError(error));
      }
    });
  }

  /** Список закупок. */
  function renderList() {
    clear(listBox);

    if (loading && !items.length) {
      listBox.appendChild(h('div.loading-block', h('div.spinner'), h('div', { text: 'Загружаем закупки…' })));
      return;
    }

    if (!items.length) {
      listBox.appendChild(h('div.empty',
        h('div.empty__icon.purchases__empty-icon', { html: iconSvg('cart', 26) }),
        h('div.empty__title', { text: 'Закупок пока нет' }),
        h('div.empty__text', { text: 'Записывайте материал сразу на объекте — фото накладной пригодится в отчёте клиенту.' })
      ));
      return;
    }

    const rows = h('div.rows.purchases__rows');
    items.forEach((item) => rows.appendChild(renderItem(item)));
    listBox.appendChild(rows);
  }

  /** Одна закупка. */
  function renderItem(item) {
    const photos = itemPhotos(item);

    const photo = h(photos.length ? 'button.purchase__photo.purchase__photo--filled' : 'span.purchase__photo', {
      type: photos.length ? 'button' : undefined,
      'aria-label': photos.length ? 'Открыть фото накладной' : undefined,
      onclick: photos.length ? () => showPhoto(item, photos) : undefined
    }, photos.length
      ? h('img.purchase__thumb', { src: photos[0].link, alt: 'Накладная', loading: 'lazy' })
      : h('span.purchase__thumb-empty', { html: iconSvg('cart', 18) }));

    // Накладных может быть несколько — показываем, сколько их.
    if (photos.length > 1) {
      photo.appendChild(h('span.purchase__photo-count', { text: String(photos.length) }));
    }

    const qtyLine = [
      num(item.qty, item.qty % 1 ? 2 : 0) + (item.unit ? ' ' + item.unit : ''),
      '× ' + money(item.price)
    ].join(' ');

    return h('div.row.purchase',
      photo,
      h('span.purchase__main.row__main',
        h('span.purchase__top',
          h('span.purchase__material', { text: item.material || 'Материал' })
        ),
        h('span.purchase__meta', { text: dateWithWeekday(item.date) + ' · ' + qtyLine }),
        item.comment ? h('span.purchase__comment', { text: item.comment }) : null,
        // Закупка ещё не ушла на сервер — говорим об этом прямо.
        item.pending ? h('span.badge.badge--muted', { text: 'ждёт отправки' }) : null
      ),
      h('span.row__side.purchase__side',
        h('span.purchase__sum', { text: moneyShort(item.sum) }),
        item.pending ? null : h('button.purchase__remove', {
          type: 'button',
          'aria-label': 'Удалить закупку',
          onclick: (event) => removeItem(item, event.currentTarget)
        }, h('span', { html: iconSvg('trash', 18) }))
      )
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Загрузка списка. */
  async function load() {
    // Сохранённые закупки показываем сразу — экран открывается без ожидания.
    const cached = objectCache.part(id, 'purchases');
    if (cached) applyPurchases(cached);

    loading = !cached;
    if (!cached) renderList();

    try {
      const data = await api.purchasesList(id);
      objectCache.put(id, 'purchases', data);
      applyPurchases(data);
    } catch (error) {
      loading = false;
      // Закупки уже показаны из сохранённого — молчим, чтобы не мешать.
      if (cached) return;

      clear(listBox);
      listBox.appendChild(h('div.empty',
        h('div.empty__icon.purchases__empty-icon', { html: iconSvg('alert', 26) }),
        h('div.empty__title', { text: 'Не удалось загрузить закупки' }),
        h('div.empty__text', { text: describeError(error) }),
        h('div', { style: { marginTop: '16px' } },
          h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
        )
      ));
    }
  }

  /**
   * Показать закупки: сохранённые и свежие приходят одной формы.
   * К записям с сервера добавляем те, что ещё ждут отправки, — иначе они
   * пропадали бы с экрана после каждого обновления.
   */
  function applyPurchases(data) {
    items = mergePending((data && data.purchases) || []);
    const sum = items.reduce((acc, item) => acc + (Number(item.sum) || 0), 0);
    const markup = Boolean(data && data.markup);
    summary = {
      sum: Math.round(sum * 100) / 100,
      total: items.length,
      markup: markup,
      // Сумму наценки берём с сервера: правило должно считаться в одном месте.
      markupSum: Number(data && data.markupSum) || (markup ? calcMarkup(sum) : 0)
    };
    markupInput.checked = markup;
    loading = false;
    renderSummary();
    renderList();

    if (typeof options.onTitle === 'function') {
      options.onTitle('Закупки', summary.total
        ? countLabel(summary.total, ['закупка', 'закупки', 'закупок']) + ' · ' + moneyShort(summary.sum)
        : '');
    }

    // Держим сохранённое на устройстве в согласии с экраном. Без этого после
    // добавления закупки кэш оставался прежним, и следующий заход показывал
    // пустой список, пока не придёт ответ сервера.
    // Закупки, ждущие отправки, в кэш не кладём: они хранятся отдельно
    // и подмешиваются заново — иначе после отправки они задвоятся.
    const saved = items.filter((item) => !item.pending);
    objectCache.put(id, 'purchases', {
      purchases: saved,
      sum: summary.sum,
      total: saved.length,
      markup: summary.markup,
      markupSum: summary.markupSum
    });
  }

  /** Добавить к списку с сервера закупки, которые ещё ждут отправки. */
  function mergePending(list) {
    const pend = objectCache.pending(id, 'purchase');
    const known = {};
    list.forEach((item) => { known[item.id] = true; });

    const merged = list.concat(pend.filter((item) => !known[item.id]));
    merged.sort((a, b) => {
      if (a.date === b.date) return String(a.created || '') < String(b.created || '') ? 1 : -1;
      return a.date < b.date ? 1 : -1;
    });
    return merged;
  }

  /**
   * Добавить закупку в список на экране, не перечитывая его с сервера.
   * Так после сохранения не появляется ни ожидания, ни мигания списка.
   */
  function appendLocal(record) {
    if (!record) return;
    applyPurchases({ purchases: items.concat([record]) });
  }

  /** Запись закупки. */
  /** Запись закупки: несколько строк одной операцией. */
  async function submit() {
    const list = filledRows();

    if (!list.length) {
      toastError('Заполните хотя бы одну строку');
      return;
    }

    // Проверяем всё до отправки. Пустые строки уже отброшены — они не станут
    // лишними строками в таблице.
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const rowNode = rows[row.index];

      if (!row.name) {
        toastError('Строка ' + (row.index + 1) + ': укажите ' +
          (mode === 'invoice' ? 'номер или название накладной' : 'материал'));
        rowNode.nameInput.focus();
        return;
      }
      if (mode === 'material' && !(row.qty > 0)) {
        toastError('Строка ' + (row.index + 1) + ': количество должно быть больше нуля');
        rowNode.qtyInput.focus();
        return;
      }
      if (!(row.price >= 0)) {
        toastError('Строка ' + (row.index + 1) + ': укажите цену');
        rowNode.priceInput.focus();
        return;
      }
    }

    const photos = uploader.getPhotos();
    const comment = commentInput.value.trim();
    const date = dateInput.value || today();
    const markup = markupInput.checked;

    const payload = {
      objectId: id,
      items: list.map((row) => ({
        purchase: {
          date: date,
          material: row.name,
          qty: row.qty,
          unit: row.unit,
          price: row.price,
          comment: comment
        },
        photos: photos.map((photo) => ({
          name: photo.name,
          mime: photo.mime,
          data: photo.data
        }))
      })),
      markup: markup
    };

    const busyLabel = photos.length
      ? (photos.length > 1 ? 'Загружаем ' + photos.length + ' фото…' : 'Загружаем фото…')
      : 'Сохраняем…';

    await runBusy(submitBtn, busyLabel, async () => {
      try {
        const result = await sendNow('purchase', payload);
        const saved = (result && result.purchases) || [];
        const total = saved.reduce((acc, item) => acc + (Number(item.sum) || 0), 0);

        toastSuccess(saved.length > 1
          ? 'Записано строк: ' + saved.length + ' на ' + moneyShort(total)
          : 'Закупка записана: ' + moneyShort(total));

        resetForm();

        if (saved.length) {
          saved.forEach((item) => appendLocal(item));
          if (markup) {
            summary.markup = true;
            summary.markupSum = calcMarkup(summary.sum);
          }
          renderSummary();
        } else {
          await load();
        }
      } catch (error) {
        if (isOfflineError(error)) {
          // Связи нет — закупки вместе с фото остаются на телефоне и уйдут сами.
          const queueId = await enqueue('purchase', payload,
            'Закупки: ' + list.length + ' шт.');
          const created = new Date().toISOString();

          list.forEach((row) => {
            const local = {
              id: 'pending-' + queueId + '-' + row.index,
              queueId: queueId,
              date: date,
              material: row.name,
              qty: row.qty,
              unit: row.unit,
              price: row.price,
              sum: Math.round(row.qty * row.price * 100) / 100,
              comment: comment,
              photos: [],
              photoCount: photos.length,
              pending: true,
              created: created
            };
            objectCache.addPending(id, 'purchase', local);
            appendLocal(local);
          });

          toastWarning('Нет сети — закупки сохранены на телефоне и отправятся сами', 6000);
          resetForm();
        } else {
          toastError(describeError(error));
        }
      }
    });
  }

  /** Наценка на материал от суммы закупок — как считает сервер. */
  function calcMarkup(base) {
    const sum = Number(base) || 0;
    if (!(sum > 0)) return 0;
    return Math.max(Math.round(sum * MARKUP_PERCENT) / 100, MARKUP_MIN);
  }

  /** Очистка формы: дату оставляем — удобно вводить подряд. */
  function resetForm() {
    rows.forEach((row) => {
      row.nameInput.value = '';
      row.qtyInput.value = mode === 'invoice' ? '1' : '';
      row.priceInput.value = '';
    });

    // Лишние строки убираем, недостающие возвращаем: форма снова как при входе.
    while (rows.length > DEFAULT_ROWS) removeRow(rows[rows.length - 1].id, true);
    while (rows.length < DEFAULT_ROWS) addRow();

    commentInput.value = '';
    uploader.clear();
    updatePreview();
    if (rows.length) rows[0].nameInput.focus();
  }

  /** Удаление закупки. */
  async function removeItem(item, button) {
    const confirmed = await confirmDialog({
      title: 'Удалить закупку?',
      text: 'Запись «' + (item.material || 'материал') + '» от ' + dateShort(item.date) +
        ' исчезнет из закупок. Фото накладной останется на Google Диске.',
      confirmText: 'Удалить',
      danger: true
    });
    if (!confirmed) return;

    await runBusy(button, 'Удаляем…', async () => {
      try {
        const result = await api.purchasesRemove(id, item.id);
        toastSuccess(result && result.photoKept
          ? 'Закупка удалена. Фото накладной сохранено на Диске'
          : 'Закупка удалена');
        await load();
      } catch (error) {
        toastError(describeError(error));
      }
    });
  }

  /** Показ фото накладной крупно. */
  /**
   * Фотографии закупки одним списком.
   * Новые записи приходят списком `photos`; у прежних есть только `photo`.
   */
  function itemPhotos(item) {
    if (item.photos && item.photos.length) return item.photos;
    if (item.photo) return [{ link: item.photo, id: item.photoId || '' }];
    return [];
  }

  function showPhoto(item, photos) {
    const list = photos && photos.length ? photos : [];

    const body = h('div.purchase-view',
      h('div.purchase-view__list',
        list.map((photo) => h('img.purchase-view__image', {
          src: photo.link,
          alt: 'Накладная',
          loading: 'lazy'
        }))
      ),
      list.length === 1 && list[0].id
        ? h('a.purchase-view__link', {
          href: 'https://drive.google.com/file/d/' + encodeURIComponent(list[0].id) + '/view',
          target: '_blank',
          rel: 'noopener'
        }, 'Открыть файл на Google Диске')
        : null
    );

    openModal({
      title: (list.length > 1 ? 'Накладные' : 'Накладная') + ' · ' + dateShort(item.date),
      body: body,
      actions: [{ label: 'Закрыть', variant: 'ghost', value: null }]
    });
  }

  /**
   * Разбор числа: принимаем и «7,5», и «7.5», и пробелы между разрядами.
   * @param {string} value
   * @return {number}
   */
  function parseNumber(value) {
    const text = String(value || '').replace(/\s|\u2009/g, '').replace(',', '.');
    const parsed = Number(text);
    return isFinite(parsed) ? parsed : 0;
  }

  loadStyles('js/components/Purchases/styles/Purchases.css');

  // Режим по умолчанию и три готовые строки: обычно за заход берут несколько.
  modeButtons.material.classList.add('purchase-form__mode--active');
  for (let i = 0; i < DEFAULT_ROWS; i++) addRow();

  renderSummary();
  renderList();
  updatePreview();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {
      uploader.destroy();
    }
  };
}

export default createPurchases;
