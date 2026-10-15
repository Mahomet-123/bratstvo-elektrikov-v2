/**
 * ============================================================================
 * Компонент: Analytics
 * Ответственность: сводка для руководителя — итоги по всем объектам и
 *                  часы по дням. Две вкладки: «Объекты» и «Дни».
 *                  Данные берутся из реестра объектов, поэтому экран
 *                  открывается быстро даже при большой базе.
 * Зависимости: core/dom, core/styles, core/toast, core/format, api/*,
 *              components/common/badges
 * ============================================================================
 */

import { h, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import bundle from '../../core/bundle.js';
import { toastError } from '../../core/toast.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { moneyShort, hours, num, dateWithWeekday, percent, countLabel } from '../../core/format.js';
import { statusBadge } from '../common/badges.js';

/** Периоды для вкладки «Дни», дней. */
const PERIODS = [7, 30, 90];

/**
 * Создание экрана аналитики.
 * @param {Object} props
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createAnalytics(props) {
  const options = props || {};

  let tab = 'objects';        // 'objects' | 'days'
  let summary = null;         // ответ analytics.summary
  let days = null;            // ответ analytics.days
  let period = 30;
  let includeClosed = true;
  let loading = true;

  const bodyBox = h('div.analytics__body');
  const el = h('div.page.analytics', bodyBox);

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка. */
  function render() {
    clear(bodyBox);
    bodyBox.appendChild(renderTabs());

    if (loading) {
      bodyBox.appendChild(h('div.loading-block', h('div.spinner'), h('div', { text: 'Считаем…' })));
      return;
    }

    if (tab === 'objects') renderObjects();
    else renderDays();
  }

  /** Переключатель вкладок. */
  function renderTabs() {
    const items = [
      { key: 'objects', label: 'Объекты' },
      { key: 'days', label: 'Дни' }
    ];

    return h('div.tabs.analytics__tabs',
      items.map((item) => h('button.tabs__item', {
        type: 'button',
        class: tab === item.key ? 'tabs__item--active' : '',
        onclick: () => {
          if (tab === item.key) return;
          tab = item.key;
          if (tab === 'days' && !days) loadDays();
          else render();
        }
      }, item.label))
    );
  }

  /* --- Вкладка «Объекты» -------------------------------------------------- */

  /** Итоги и список объектов. */
  function renderObjects() {
    if (!summary) {
      bodyBox.appendChild(renderEmpty('Не удалось получить сводку', loadSummary));
      return;
    }

    const totals = summary.totals || {};

    bodyBox.appendChild(h('div.stats.analytics__stats',
      h('div.stat.stat--wide',
        h('div.stat__label', { text: 'Смета по всем объектам' }),
        h('div.stat__value', { text: moneyShort(totals.estimate || 0) })
      ),
      h('div.stat.stat--wide',
        h('div.stat__label', { text: 'Закуплено материалов' }),
        h('div.stat__value', { text: moneyShort(totals.purchases || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Остаток работ' }),
        h('div.stat__value', { text: moneyShort(totals.remaining || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Часы' }),
        h('div.stat__value', { text: hours(totals.hours || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'В работе' }),
        h('div.stat__value', { text: String(totals.open || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Закрыто' }),
        h('div.stat__value', { text: String(totals.closed || 0) })
      )
    ));

    bodyBox.appendChild(h('div.analytics__filter',
      h('label.check',
        h('input.check__input', {
          type: 'checkbox',
          checked: includeClosed,
          onchange: (event) => {
            includeClosed = event.target.checked;
            loadSummary();
          }
        }),
        h('span', { text: 'Учитывать закрытые объекты' })
      )
    ));

    const list = summary.objects || [];
    if (!list.length) {
      bodyBox.appendChild(renderEmpty('Объектов пока нет', null));
      return;
    }

    bodyBox.appendChild(h('div.analytics__section',
      h('div.page__section-title', { text: 'Объекты по стоимости работ' }),
      h('div.rows.analytics__rows',
        list.map((item) => renderObjectRow(item))
      )
    ));
  }

  /** Строка объекта с долей закупок. */
  function renderObjectRow(item) {
    const estimate = Number(item.estimate) || 0;
    const purchases = Number(item.purchases) || 0;
    const share = estimate > 0 ? Math.min(100, (purchases / estimate) * 100) : 0;

    return h('button.row.row--tap.analytics__row', {
      type: 'button',
      onclick: () => navigate('/object/' + encodeURIComponent(item.id))
    },
      h('span.row__main',
        h('span.analytics__row-top',
          h('span.analytics__row-num', { text: '№ ' + item.numberLabel }),
          statusBadge(item.status)
        ),
        h('span.analytics__row-title', { text: item.title || 'Без названия' }),
        item.client ? h('span.analytics__row-client', { text: item.client }) : null,
        h('span.progress.analytics__progress',
          h('span.progress__bar', {
            class: share >= 100 ? 'progress__bar--success' : '',
            style: { width: share.toFixed(1) + '%' }
          })
        ),
        h('span.analytics__row-meta', {
          text: 'Закупки ' + moneyShort(purchases) + ' · ' + percent(share) +
            ' · часов ' + num(item.hours || 0)
        })
      ),
      h('span.row__side.analytics__row-side',
        h('span.analytics__row-sum', { text: moneyShort(estimate) })
      )
    );
  }

  /* --- Вкладка «Дни» ------------------------------------------------------ */

  /** Часы по дням и по мастерам. */
  function renderDays() {
    bodyBox.appendChild(h('div.tabs.analytics__periods',
      PERIODS.map((value) => h('button.tabs__item', {
        type: 'button',
        class: period === value ? 'tabs__item--active' : '',
        onclick: () => {
          if (period === value) return;
          period = value;
          loadDays();
        }
      }, value + ' дней'))
    ));

    if (!days) {
      bodyBox.appendChild(renderEmpty('Не удалось получить сводку по дням', loadDays));
      return;
    }

    const totals = days.totals || {};

    bodyBox.appendChild(h('div.stats.analytics__stats',
      h('div.stat',
        h('div.stat__label', { text: 'Часов за период' }),
        h('div.stat__value', { text: hours(totals.hours || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Рабочих дней' }),
        h('div.stat__value', { text: String(totals.workDays || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Записей' }),
        h('div.stat__value', { text: String(totals.records || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'В среднем за день' }),
        h('div.stat__value', { text: hours(totals.average || 0) })
      )
    ));

    const executors = days.byExecutor || [];
    if (executors.length) {
      bodyBox.appendChild(h('div.analytics__section',
        h('div.page__section-title', { text: 'Часы по мастерам' }),
        h('div.rows.analytics__rows',
          executors.map((item) => h('div.row.analytics__executor',
            h('span.row__main',
              h('span.row__title', { text: item.name }),
              h('span.row__sub', { text: hours(item.hours) })
            )
          ))
        )
      ));
    }

    const list = days.days || [];
    bodyBox.appendChild(h('div.analytics__section',
      h('div.page__section-title', { text: 'Часы по дням' }),
      list.length
        ? h('div.rows.analytics__rows',
          list.map((item) => h('div.row.analytics__day',
            h('span.row__main',
              h('span.row__title', { text: dateWithWeekday(item.date) }),
              h('span.row__sub', {
                text: countLabel(item.records, ['запись', 'записи', 'записей']) +
                  (item.duplicates ? ' · повторов: ' + item.duplicates : '') +
                  (item.objects && item.objects.length ? ' · ' + item.objects.length + ' об.' : '')
              })
            ),
            h('span.row__side',
              h('span.analytics__row-sum', { text: hours(item.hours) })
            )
          ))
        )
        : renderEmpty('За выбранный период записей нет', null)
    ));
  }

  /** Заглушка с возможностью повтора. */
  function renderEmpty(title, retry) {
    return h('div.empty',
      h('div.empty__icon.analytics__empty-icon', { html: iconSvg('chart', 26) }),
      h('div.empty__title', { text: title }),
      retry
        ? h('div', { style: { marginTop: '16px' } },
          h('button.btn.btn--ghost', { type: 'button', onclick: retry }, 'Повторить'))
        : null
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Заголовок экрана с числом объектов. */
  function applyTitle() {
    if (typeof options.onTitle === 'function') {
      const totals = (summary && summary.totals) || {};
      options.onTitle('Аналитика', countLabel(totals.objects || 0, ['объект', 'объекта', 'объектов']));
    }
  }

  /**
   * Загрузка сводки по объектам.
   *
   * Обычная сводка (с закрытыми объектами) уже лежит в пакете данных, поэтому
   * вкладка открывается мгновенно. Отдельный запрос нужен только когда
   * руководитель сам меняет отбор — такой сводки в пакете нет.
   */
  async function loadSummary() {
    const packed = bundle.get();
    const fromBundle = packed && packed.analytics;

    if (fromBundle && includeClosed) {
      summary = fromBundle;
      loading = false;
      applyTitle();
      render();

      // Пакет мог устареть: ensure вернёт свежий, а если он ещё годен —
      // в сеть никто не пойдёт.
      try {
        const fresh = await bundle.ensure();
        if (fresh && fresh.analytics) {
          summary = fresh.analytics;
          applyTitle();
          render();
        }
      } catch (error) {
        // Сводка уже показана — сообщать не о чем.
      }
      return;
    }

    loading = true;
    render();
    try {
      summary = await api.analyticsSummary({ includeClosed: includeClosed });
      loading = false;
      render();
      applyTitle();
    } catch (error) {
      loading = false;
      summary = null;
      render();
      toastError(describeError(error));
    }
  }

  /** Загрузка сводки по дням. */
  async function loadDays() {
    loading = true;
    render();
    try {
      days = await api.analyticsDays({ limit: period });
    } catch (error) {
      days = null;
      toastError(describeError(error));
    } finally {
      loading = false;
      render();
    }
  }

  /** Переход на другой экран. */
  function navigate(path) {
    if (typeof options.onNavigate === 'function') options.onNavigate(path);
    else window.location.hash = '#' + path;
  }

  loadStyles('js/components/Analytics/styles/Analytics.css');

  render();
  loadSummary();

  return {
    el: el,
    refresh: () => (tab === 'objects' ? loadSummary() : loadDays()),
    destroy: () => {}
  };
}

export default createAnalytics;
