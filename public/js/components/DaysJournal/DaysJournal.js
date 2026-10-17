/**
 * ============================================================================
 * Компонент: DaysJournal
 * Ответственность: журнал дней объекта — кто, когда, сколько часов и что сделал.
 *                  Повтор за ту же дату сохраняется и помечается, но не блокируется.
 * Зависимости: core/dom, core/styles, core/store, core/toast, core/modal,
 *              core/format, api/*, components/common/badges
 * ============================================================================
 */

import { h, setContent, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store } from '../../core/store.js';
import { toastSuccess, toastError, toastWarning } from '../../core/toast.js';
import { confirmDialog } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { hours, dateWithWeekday, today, countLabel } from '../../core/format.js';
import { runBusy } from '../../core/busy.js';
import objectCache from '../../core/objectCache.js';
import { sendNow, enqueue, isOfflineError } from '../../core/sync.js';
import { duplicateBadge } from '../common/badges.js';

/**
 * Создание экрана журнала дней.
 * @param {Object} props
 * @param {string} props.id — идентификатор объекта
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, destroy }
 */
export function createDaysJournal(props) {
  const options = props || {};
  const id = options.id;
  const state = store.get();
  const currentUser = (state.user && state.user.name) || '';

  let days = [];
  let summary = { hours: 0, count: 0 };
  let loading = true;

  /* --------------------------------------------------------------------------
   * Форма добавления
   * ------------------------------------------------------------------------ */

  const dateInput = h('input.input', {
    type: 'date',
    value: today()
  });
  const hoursInput = h('input.input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: 'Например: 7,5',
    autocomplete: 'off'
  });
  const workInput = h('textarea.textarea', {
    placeholder: 'Что сделали за день',
    rows: '3'
  });
  const executorInput = h('input.input', {
    type: 'text',
    value: currentUser,
    placeholder: 'Исполнитель',
    autocomplete: 'off'
  });

  const submitBtn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, 'Записать день');

  const form = h('form.card.day-form', {
    onsubmit: async (event) => {
      event.preventDefault();
      await addDay();
    }
  },
    h('div.card__head', h('div.card__title', { text: 'Записать день' })),
    h('div.card__body',
      h('label.field',
        h('span.field__label', { text: 'Дата' }),
        dateInput
      ),
      h('label.field',
        h('span.field__label', { text: 'Часы' }),
        hoursInput
      ),
      h('label.field',
        h('span.field__label', { text: 'Что сделано' }),
        workInput
      ),
      h('label.field',
        h('span.field__label', { text: 'Исполнитель' }),
        executorInput,
        h('span.field__hint', { text: 'По умолчанию — вы. Можно указать другого мастера.' })
      ),
      submitBtn
    )
  );

  /* --------------------------------------------------------------------------
   * Список и итог
   * ------------------------------------------------------------------------ */

  const summaryBox = h('div.day-journal__summary');
  const listBox = h('div.day-journal__list');

  const el = h('div.page.day-journal',
    summaryBox,
    form,
    h('div.day-journal__section',
      h('div.page__section-title', { text: 'Записи' }),
      listBox
    )
  );

  /** Итог по журналу. */
  function renderSummary() {
    setContent(summaryBox,
      h('div.stats',
        h('div.stat',
          h('div.stat__label', { text: 'Всего часов' }),
          h('div.stat__value', { text: hours(summary.hours || 0) })
        ),
        h('div.stat',
          h('div.stat__label', { text: 'Записей' }),
          h('div.stat__value', { text: String(summary.count || 0) })
        )
      )
    );
  }

  /** Список записей. */
  function renderList() {
    clear(listBox);

    if (loading && !days.length) {
      listBox.appendChild(h('div.loading-block', h('div.spinner'), h('div', { text: 'Загружаем записи…' })));
      return;
    }

    if (!days.length) {
      listBox.appendChild(h('div.empty',
        h('div.empty__icon.day-journal__empty-icon', { html: iconSvg('clock', 26) }),
        h('div.empty__title', { text: 'Записей пока нет' }),
        h('div.empty__text', { text: 'Заполняйте журнал каждый день — руководитель видит часы по объекту.' })
      ));
      return;
    }

    const list = h('div.rows.day-journal__rows');
    days.forEach((day) => list.appendChild(renderRecord(day)));
    listBox.appendChild(list);
  }

  /** Одна запись журнала. */
  function renderRecord(day) {
    return h('div.row.day-record',
      h('span.day-record__main.row__main',
        h('span.day-record__top',
          h('span.day-record__date', { text: dateWithWeekday(day.date) }),
          day.duplicate ? duplicateBadge() : null,
          // Запись ещё не ушла на сервер — говорим об этом прямо.
          day.pending
            ? h('span.badge.badge--muted', { text: 'ждёт отправки' })
            : null
        ),
        day.work
          ? h('span.day-record__work', { text: day.work })
          : null,
        h('span.day-record__meta', {
          text: [day.executor || 'без исполнителя', hours(day.hours)].join(' · ')
        })
      ),
      h('span.row__side',
        day.pending
          ? null
          : h('button.day-record__remove', {
            type: 'button',
            'aria-label': 'Удалить запись',
            onclick: (event) => removeDay(day, event.currentTarget)
          }, h('span', { html: iconSvg('trash', 18) }))
      )
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Загрузка журнала. */
  async function load() {
    // Сохранённый журнал показываем сразу — экран открывается без ожидания.
    const cached = objectCache.part(id, 'days');
    if (cached) applyDays(cached);

    loading = !cached;
    if (!cached) renderList();

    try {
      const data = await api.daysList(id);
      objectCache.put(id, 'days', data);
      applyDays(data);
    } catch (error) {
      loading = false;
      // Журнал уже показан из сохранённого — молчим, чтобы не мешать.
      if (cached) return;

      clear(listBox);
      listBox.appendChild(h('div.empty',
        h('div.empty__icon.day-journal__empty-icon', { html: iconSvg('alert', 26) }),
        h('div.empty__title', { text: 'Не удалось загрузить журнал' }),
        h('div.empty__text', { text: describeError(error) }),
        h('div', { style: { marginTop: '16px' } },
          h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
        )
      ));
    }
  }

  /**
   * Показать журнал: сохранённый и свежий приходят одной формы.
   * К записям с сервера добавляем те, что ещё ждут отправки, — иначе они
   * пропадали бы с экрана после каждого обновления.
   */
  function applyDays(data) {
    days = mergePending((data && data.days) || []);
    const total = days.reduce((acc, day) => acc + (Number(day.hours) || 0), 0);
    summary = { hours: Math.round(total * 100) / 100, count: days.length };
    loading = false;
    renderSummary();
    renderList();

    if (typeof options.onTitle === 'function') {
      options.onTitle('Журнал дней', summary.count ? countLabel(summary.count, ['запись', 'записи', 'записей']) : '');
    }

    // Держим сохранённое на устройстве в согласии с экраном. Без этого после
    // добавления записи кэш оставался прежним, и следующий заход показывал
    // пустой журнал, пока не придёт ответ сервера.
    // Записи, ждущие отправки, в кэш не кладём: они хранятся отдельно
    // и подмешиваются заново — иначе после отправки они задвоятся.
    const saved = days.filter((day) => !day.pending);
    objectCache.put(id, 'days', { days: saved, hours: summary.hours, count: saved.length });
  }

  /** Добавить к списку с сервера записи, которые ещё ждут отправки. */
  function mergePending(list) {
    const pend = objectCache.pending(id, 'day');
    const known = {};
    list.forEach((day) => { known[day.id] = true; });

    const merged = list.concat(pend.filter((day) => !known[day.id]));
    merged.sort((a, b) => {
      if (a.date === b.date) return String(a.created || '') < String(b.created || '') ? 1 : -1;
      return a.date < b.date ? 1 : -1;
    });
    return merged;
  }

  /**
   * Добавить запись в список на экране, не перечитывая журнал с сервера.
   * Так после сохранения не появляется ни ожидания, ни мигания списка.
   */
  function appendLocal(record) {
    if (!record) return;
    applyDays({ days: days.concat([record]) });
  }

  /** Добавление записи. */
  async function addDay() {
    const value = String(hoursInput.value || '').replace(',', '.');
    const parsed = Number(value);

    if (!isFinite(parsed) || parsed <= 0) {
      toastError('Укажите количество часов больше нуля');
      hoursInput.focus();
      return;
    }
    if (parsed > 24) {
      toastError('За день не может быть больше 24 часов');
      hoursInput.focus();
      return;
    }
    if (!workInput.value.trim()) {
      toastError('Опишите, что сделано за день');
      workInput.focus();
      return;
    }

    const payload = {
      objectId: id,
      day: {
        date: dateInput.value || today(),
        hours: parsed,
        work: workInput.value.trim(),
        executor: executorInput.value.trim()
      }
    };

    await runBusy(submitBtn, 'Сохраняем…', async () => {
      try {
        let result = null;
        try {
          result = await sendNow('day', payload);
        } catch (error) {
          if (!isOfflineError(error)) throw error;
          // Связи нет — запись остаётся на телефоне и уйдёт сама, когда связь
          // вернётся. Показываем её сразу: человек должен видеть свою работу.
          const queueId = await enqueue('day', payload, 'День: ' + dateWithWeekday(payload.day.date));
          const local = Object.assign({}, payload.day, {
            id: 'pending-' + queueId,
            queueId: queueId,
            created: new Date().toISOString(),
            pending: true
          });
          objectCache.addPending(id, 'day', local);
          appendLocal(local);
          toastWarning('Нет сети — запись сохранена на телефоне и отправится сама', 6000);
          workInput.value = '';
          hoursInput.value = '';
          hoursInput.focus();
          return;
        }

        if (result.duplicate) {
          toastWarning('Запись сохранена и помечена как повторная — за эту дату у этого исполнителя уже есть часы', 5000);
        } else {
          toastSuccess('Запись добавлена');
        }

        // Очищаем только описание: дату и исполнителя оставляем — удобно вводить подряд.
        workInput.value = '';
        hoursInput.value = '';
        hoursInput.focus();

        // Запись уже пришла с сервера — добавляем её на экран без перезагрузки.
        if (result.day) appendLocal(result.day);
        else await load();
      } catch (error) {
        toastError(describeError(error));
      }
    });
  }

  /** Удаление записи. */
  async function removeDay(day, button) {
    const confirmed = await confirmDialog({
      title: 'Удалить запись?',
      text: 'Запись за ' + dateWithWeekday(day.date) + ' будет удалена из журнала.',
      confirmText: 'Удалить',
      danger: true
    });
    if (!confirmed) return;

    await runBusy(button, 'Удаляем…', async () => {
      try {
        await api.daysRemove(id, day.id);
        toastSuccess('Запись удалена');
        objectCache.markStale(id);
        await load();
      } catch (error) {
        toastError(describeError(error));
      }
    });
  }

  loadStyles('js/components/DaysJournal/styles/DaysJournal.css');

  renderSummary();
  renderList();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createDaysJournal;
