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
  let summary = { sum: 0, total: 0 };
  let loading = true;

  /* --------------------------------------------------------------------------
   * Форма
   * ------------------------------------------------------------------------ */

  const dateInput = h('input.input', { type: 'date', value: today() });

  const materialInput = h('input.input', {
    type: 'text',
    placeholder: 'Кабель, автомат, гофра…',
    autocomplete: 'off'
  });

  const qtyInput = h('input.input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: '0',
    autocomplete: 'off',
    oninput: updatePreview
  });

  const unitSelect = h('select.select', {},
    UNITS.map((unit) => h('option', { value: unit, text: unit }))
  );

  const priceInput = h('input.input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: '0,00',
    autocomplete: 'off',
    oninput: updatePreview
  });

  const commentInput = h('textarea.textarea', {
    placeholder: 'Комментарий: где куплено, номер накладной',
    rows: '2'
  });

  const uploader = createPhotoUploader({
    hint: 'Фото накладной уменьшится до ~300 КБ'
  });

  const previewNode = h('div.purchase-form__preview');

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
      h('label.field',
        h('span.field__label', { text: 'Материал или товар' }),
        materialInput
      ),
      h('div.purchase-form__pair',
        h('label.field',
          h('span.field__label', { text: 'Количество' }),
          qtyInput
        ),
        h('label.field',
          h('span.field__label', { text: 'Единица' }),
          unitSelect
        )
      ),
      h('label.field',
        h('span.field__label', { text: 'Цена за единицу' }),
        priceInput
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
      submitBtn
    )
  );

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

  /** Предварительная сумма по введённым числам. */
  function updatePreview() {
    const qty = parseNumber(qtyInput.value);
    const price = parseNumber(priceInput.value);
    const sum = qty > 0 && price >= 0 ? qty * price : 0;

    setContent(previewNode, sum > 0
      ? h('div.purchase-form__sum',
        h('span.purchase-form__sum-label', { text: 'Сумма строки' }),
        h('span.purchase-form__sum-value', { text: money(sum) })
      )
      : null);
  }

  /** Итог по всем закупкам. */
  function renderSummary() {
    setContent(summaryBox,
      h('div.stats',
        h('div.stat',
          h('div.stat__label', { text: 'Закуплено' }),
          h('div.stat__value', { text: moneyShort(summary.sum || 0) })
        ),
        h('div.stat',
          h('div.stat__label', { text: 'Записей' }),
          h('div.stat__value', { text: String(summary.total || 0) })
        )
      )
    );
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
    summary = { sum: Math.round(sum * 100) / 100, total: items.length };
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
    objectCache.put(id, 'purchases', { purchases: saved, sum: summary.sum, total: saved.length });
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
  async function submit() {
    const material = materialInput.value.trim();
    const qty = parseNumber(qtyInput.value);
    const price = parseNumber(priceInput.value);

    if (!material) {
      toastError('Укажите материал или товар');
      materialInput.focus();
      return;
    }
    if (!(qty > 0)) {
      toastError('Количество должно быть больше нуля');
      qtyInput.focus();
      return;
    }
    if (!(price >= 0)) {
      toastError('Укажите цену за единицу');
      priceInput.focus();
      return;
    }

    const photos = uploader.getPhotos();
    const payload = {
      objectId: id,
      purchase: {
        date: dateInput.value || today(),
        material: material,
        qty: qty,
        unit: unitSelect.value,
        price: price,
        comment: commentInput.value.trim()
      },
      photos: photos.map((photo) => ({
        name: photo.name,
        mime: photo.mime,
        data: photo.data
      }))
    };

    const busyLabel = photos.length
      ? (photos.length > 1 ? 'Загружаем ' + photos.length + ' фото…' : 'Загружаем фото…')
      : 'Сохраняем…';

    await runBusy(submitBtn, busyLabel, async () => {
      try {
        const result = await sendNow('purchase', payload);
        const sum = result && result.purchase ? result.purchase.sum : qty * price;
        toastSuccess('Закупка записана: ' + moneyShort(sum));
        resetForm();

        // Закупка уже пришла с сервера — показываем её без перезагрузки списка.
        if (result && result.purchase) appendLocal(result.purchase);
        else await load();
      } catch (error) {
        if (isOfflineError(error)) {
          // Связи нет — закупка вместе с фото остаётся на телефоне и уйдёт сама.
          // Показываем её сразу: человек должен видеть свою работу.
          const queueId = await enqueue('purchase', payload, 'Закупка: ' + material);
          const local = {
            id: 'pending-' + queueId,
            queueId: queueId,
            date: payload.purchase.date,
            material: material,
            qty: qty,
            unit: payload.purchase.unit,
            price: price,
            sum: Math.round(qty * price * 100) / 100,
            comment: payload.purchase.comment,
            photos: [],
            photoCount: photos.length,
            pending: true,
            created: new Date().toISOString()
          };
          objectCache.addPending(id, 'purchase', local);
          appendLocal(local);
          toastWarning('Нет сети — закупка сохранена на телефоне и отправится сама, когда появится связь', 6000);
          resetForm();
        } else {
          toastError(describeError(error));
        }
      }
    });
  }

  /** Очистка формы: дату и единицу оставляем — удобно вводить подряд. */
  function resetForm() {
    materialInput.value = '';
    qtyInput.value = '';
    priceInput.value = '';
    commentInput.value = '';
    uploader.clear();
    updatePreview();
    materialInput.focus();
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
