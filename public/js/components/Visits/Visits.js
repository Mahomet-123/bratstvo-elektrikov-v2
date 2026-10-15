/**
 * ============================================================================
 * Компонент: Visits
 * Ответственность: журнал посещений для руководителя — кто, когда и что
 *                  делал в приложении, с какого устройства. Нужен, чтобы
 *                  понимать, пользуется ли бригада приложением и где
 *                  возникают сбои (ошибки клиента тоже пишутся сюда).
 * Зависимости: core/dom, core/styles, core/toast, core/format, api/*
 * ============================================================================
 */

import { h, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import bundle from '../../core/bundle.js';
import { toastError } from '../../core/toast.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { dateShort, countLabel } from '../../core/format.js';

/** Сколько записей показывать. */
const LIMITS = [50, 150, 400];

/** Объём по умолчанию — ровно он лежит в пакете данных разделов. */
const DEFAULT_LIMIT = LIMITS[1];

/**
 * Создание экрана журнала посещений.
 * @param {Object} props
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createVisits(props) {
  const options = props || {};

  let data = null;
  let summary = null;
  let limit = DEFAULT_LIMIT;
  let loading = true;

  const bodyBox = h('div.visits__body');
  const el = h('div.page.visits', bodyBox);

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка. */
  function render() {
    clear(bodyBox);

    if (loading && !data) {
      bodyBox.appendChild(h('div.loading-block', h('div.spinner'), h('div', { text: 'Читаем журнал…' })));
      return;
    }

    if (!data) {
      bodyBox.appendChild(h('div.empty',
        h('div.empty__icon.visits__empty-icon', { html: iconSvg('alert', 26) }),
        h('div.empty__title', { text: 'Не удалось открыть журнал' }),
        h('div.empty__text', { text: 'Проверьте связь и попробуйте снова.' }),
        h('div', { style: { marginTop: '16px' } },
          h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить'))
      ));
      return;
    }

    bodyBox.appendChild(renderStats());
    bodyBox.appendChild(renderLimits());
    bodyBox.appendChild(renderList());
  }

  /** Итоги: сколько записей всего и кто активнее всех. */
  function renderStats() {
    const users = (summary && summary.users) || [];
    const top = users.length ? users[0] : null;

    return h('div.stats.visits__stats',
      h('div.stat',
        h('div.stat__label', { text: 'Записей всего' }),
        h('div.stat__value', { text: String((data && data.total) || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Показано' }),
        h('div.stat__value', { text: String((data && data.visits ? data.visits.length : 0)) })
      ),
      top
        ? h('div.stat.stat--wide',
          h('div.stat__label', { text: 'Активнее всех' }),
          h('div.stat__value', { text: top.user + ' · ' + countLabel(top.count, ['заход', 'захода', 'заходов']) })
        )
        : null
    );
  }

  /** Выбор глубины журнала. */
  function renderLimits() {
    return h('div.tabs.visits__limits',
      LIMITS.map((value) => h('button.tabs__item', {
        type: 'button',
        class: limit === value ? 'tabs__item--active' : '',
        onclick: () => {
          if (limit === value) return;
          limit = value;
          load();
        }
      }, value + ' записей'))
    );
  }

  /** Список посещений. */
  function renderList() {
    const list = (data && data.visits) || [];

    if (!list.length) {
      return h('div.empty',
        h('div.empty__icon.visits__empty-icon', { html: iconSvg('eye', 26) }),
        h('div.empty__title', { text: 'Записей пока нет' }),
        h('div.empty__text', { text: 'Как только бригада начнёт работать в приложении, здесь появится журнал.' })
      );
    }

    return h('div.rows.visits__rows', list.map((item) => renderRow(item)));
  }

  /** Одна запись журнала. */
  function renderRow(item) {
    const isError = String(item.action || '').indexOf('ошибка') !== -1;

    return h('div.row.visit',
      h('span.row__main',
        h('span.visit__top',
          h('span.visit__user', { text: item.user || 'гость' }),
          isError ? h('span.badge.badge--danger', { text: 'сбой' }) : null
        ),
        h('span.visit__action', { text: item.action || '—' }),
        h('span.visit__meta', {
          text: [
            dateShort(item.date) + (item.time ? ' ' + item.time : ''),
            item.role === 'leader' ? 'руководитель' : 'мастер',
            item.device ? shortDevice(item.device) : ''
          ].filter(Boolean).join(' · ')
        })
      )
    );
  }

  /**
   * Короткое имя устройства из строки User-Agent.
   * @param {string} device
   * @return {string}
   */
  function shortDevice(device) {
    const text = String(device);
    const platform = ['Android', 'iPhone', 'iPad', 'Windows', 'Macintosh', 'Linux']
      .filter((name) => text.indexOf(name) !== -1)[0];
    const browser = text.indexOf('YaBrowser') !== -1 ? 'Яндекс'
      : text.indexOf('Edg/') !== -1 ? 'Edge'
        : text.indexOf('Firefox') !== -1 ? 'Firefox'
          : text.indexOf('Chrome') !== -1 ? 'Chrome'
            : text.indexOf('Safari') !== -1 ? 'Safari' : '';
    const label = [platform, browser].filter(Boolean).join(' · ');
    return label || 'устройство не определено';
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Заголовок экрана с числом записей. */
  function applyTitle() {
    if (typeof options.onTitle === 'function') {
      const total = (data && data.total) || 0;
      options.onTitle('Посещения', total ? countLabel(total, ['запись', 'записи', 'записей']) : '');
    }
  }

  /**
   * Загрузка журнала и сводки.
   *
   * Обычная выборка (150 записей) и сводка уже лежат в пакете данных, поэтому
   * экран открывается мгновенно. Отдельный запрос нужен только когда
   * руководитель выбирает другой объём — 50 или 400 записей.
   */
  async function load() {
    const packed = bundle.get();
    const packedVisits = packed && packed.visits;

    if (packedVisits && limit === DEFAULT_LIMIT) {
      data = packedVisits.list;
      summary = packedVisits.summary;
      loading = false;
      applyTitle();
      render();
    }

    const hadData = Boolean(data);
    loading = !hadData;
    if (!hadData) render();

    try {
      if (limit === DEFAULT_LIMIT) {
        const fresh = await bundle.ensure();
        const visits = fresh && fresh.visits;
        if (visits) {
          data = visits.list;
          summary = visits.summary;
        }
      } else {
        data = await api.visitsList(limit);
      }
      loading = false;
      applyTitle();
      render();
    } catch (error) {
      loading = false;
      render();
      // Журнал уже показан — обновление не удалось молча.
      if (!hadData) toastError(describeError(error));
    }
  }

  loadStyles('js/components/Visits/styles/Visits.css');

  render();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createVisits;
