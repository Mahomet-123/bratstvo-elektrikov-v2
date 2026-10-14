/**
 * ============================================================================
 * Компонент: Archive
 * Ответственность: архив по годам — какие таблицы-архивы существуют, какие
 *                  объекты в них лежат, возврат объекта в работу и уборка
 *                  лишних листов, на которые уже не ссылается ни один объект.
 *                  Данные не удаляются: объект возвращается вместе со своим
 *                  листом — расчётом, днями и закупками.
 * Зависимости: core/dom, core/styles, core/toast, core/modal, core/format,
 *              api/*, components/common/badges
 * ============================================================================
 */

import { h, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { toastSuccess, toastError, toastWarning } from '../../core/toast.js';
import { confirmDialog } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { invalidateObjects } from '../../core/store.js';
import { moneyShort, dateShort, countLabel } from '../../core/format.js';
import { statusBadge } from '../common/badges.js';

/**
 * Создание экрана архива.
 * @param {Object} props
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createArchive(props) {
  const options = props || {};

  let data = null;
  let loading = true;
  let busy = '';

  const bodyBox = h('div.archive__body');
  const el = h('div.page.archive', bodyBox);

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка. */
  function render() {
    clear(bodyBox);

    if (loading && !data) {
      bodyBox.appendChild(h('div.loading-block', h('div.spinner'), h('div', { text: 'Смотрим архив…' })));
      return;
    }

    if (!data) {
      bodyBox.appendChild(h('div.empty',
        h('div.empty__icon.archive__empty-icon', { html: iconSvg('alert', 26) }),
        h('div.empty__title', { text: 'Не удалось открыть архив' }),
        h('div.empty__text', { text: 'Проверьте связь и попробуйте снова.' }),
        h('div', { style: { marginTop: '16px' } },
          h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить'))
      ));
      return;
    }

    const archives = data.archives || [];
    const totals = data.totals || {};

    bodyBox.appendChild(h('div.stats.archive__stats',
      h('div.stat',
        h('div.stat__label', { text: 'Таблиц-архивов' }),
        h('div.stat__value', { text: String(totals.archives || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Объектов в архиве' }),
        h('div.stat__value', { text: String(totals.objects || 0) })
      )
    ));

    if (!archives.length) {
      bodyBox.appendChild(h('div.empty',
        h('div.empty__icon.archive__empty-icon', { html: iconSvg('archive', 26) }),
        h('div.empty__title', { text: 'Архив пуст' }),
        h('div.empty__text', {
          text: 'Закрытые объекты переезжают сюда по годам: лист объекта уходит в отдельную таблицу на Google Диске.'
        })
      ));
      return;
    }

    archives.forEach((archive) => bodyBox.appendChild(renderArchive(archive)));

    bodyBox.appendChild(h('div.card.card--flat.archive__help',
      h('div.card__body',
        h('div.archive__help-title', { text: 'Как устроен архив' }),
        h('ul.archive__list',
          h('li', { text: 'При закрытии объекта его лист переезжает в таблицу-архив за текущий год.' }),
          h('li', { text: 'Из реестра объект не исчезает: расчёт, дни и закупки читаются как раньше.' }),
          h('li', { text: '«Вернуть в работу» переносит лист обратно в основную таблицу.' }),
          h('li', { text: '«Убрать лишние листы» чистит архив от копий, на которые никто не ссылается.' })
        )
      )
    ));
  }

  /** Карточка одной таблицы-архива. */
  function renderArchive(archive) {
    const objects = archive.objects || [];

    return h('div.card.archive__item',
      h('div.card__head',
        h('div.archive__item-titles',
          h('div.card__title', { text: archive.name }),
          h('div.archive__item-sub', {
            text: countLabel(objects.length, ['объект', 'объекта', 'объектов']) +
              ' · листов: ' + (archive.sheets || []).length +
              (archive.updated ? ' · обновлён ' + dateShort(archive.updated) : '')
          })
        )
      ),
      h('div.card__body',
        objects.length
          ? h('div.rows.archive__objects', objects.map((item) => renderObjectRow(item)))
          : h('div.archive__empty-text', { text: 'Объектов, ссылающихся на эту таблицу, нет.' }),
        h('div.archive__actions',
          h('button.btn.btn--ghost.btn--block', {
            type: 'button',
            disabled: busy === archive.id,
            onclick: () => cleanup(archive)
          }, busy === archive.id ? 'Убираем…' : 'Убрать лишние листы'),
          archive.url
            ? h('a.btn.btn--quiet.btn--block', {
              href: archive.url,
              target: '_blank',
              rel: 'noopener'
            }, 'Открыть таблицу на Диске')
            : null
        )
      )
    );
  }

  /** Строка объекта внутри архива. */
  function renderObjectRow(item) {
    return h('div.row.archive__object',
      h('span.row__main',
        h('span.archive__object-top',
          h('span.archive__object-num', { text: '№ ' + item.numberLabel }),
          statusBadge(item.status)
        ),
        h('span.row__title', { text: item.title || 'Без названия' }),
        h('span.row__sub', {
          text: [
            item.client || '',
            item.closed ? 'закрыт ' + dateShort(item.closed) : '',
            moneyShort(item.estimate || 0)
          ].filter(Boolean).join(' · ')
        })
      ),
      h('span.row__side',
        h('button.btn.btn--quiet.btn--sm', {
          type: 'button',
          onclick: () => restore(item)
        }, 'Вернуть в работу')
      )
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Загрузка списка архивов. */
  async function load() {
    loading = true;
    render();
    try {
      data = await api.archiveList();
      loading = false;
      render();
      if (typeof options.onTitle === 'function') {
        const totals = (data && data.totals) || {};
        options.onTitle('Архив', countLabel(totals.objects || 0, ['объект', 'объекта', 'объектов']) + ' по годам');
      }
    } catch (error) {
      loading = false;
      data = null;
      render();
      toastError(describeError(error));
    }
  }

  /** Возврат объекта в работу. */
  async function restore(item) {
    const confirmed = await confirmDialog({
      title: 'Вернуть объект в работу?',
      text: 'Объект № ' + item.numberLabel + ' «' + (item.title || '') + '» снова станет активным, ' +
        'а его лист вернётся из архива в основную таблицу.',
      confirmText: 'Вернуть в работу'
    });
    if (!confirmed) return;

    try {
      const result = await api.objectRestore(item.id);
      // Объект вернулся в работу — список объектов устарел.
      invalidateObjects();
      toastSuccess(result.message || 'Объект снова в работе');
      await load();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Уборка лишних листов в таблице-архиве. */
  async function cleanup(archive) {
    const confirmed = await confirmDialog({
      title: 'Убрать лишние листы?',
      text: 'В таблице «' + archive.name + '» удалятся листы, на которые не ссылается ни один объект. ' +
        'Обычно это копии, оставшиеся от прежних переносов. Листы живых объектов не тронем.',
      confirmText: 'Убрать лишние',
      danger: true
    });
    if (!confirmed) return;

    busy = archive.id;
    render();

    try {
      const result = await api.archiveCleanup(archive.id);
      if (result.removed && result.removed.length) {
        toastSuccess(result.message || 'Убрано листов: ' + result.removed.length);
      } else {
        toastWarning(result.message || 'Лишних листов не было');
      }
      await load();
    } catch (error) {
      toastError(describeError(error));
    } finally {
      busy = '';
      render();
    }
  }

  loadStyles('js/components/Archive/styles/Archive.css');

  render();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createArchive;
