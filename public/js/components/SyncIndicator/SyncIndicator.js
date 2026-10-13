/**
 * ============================================================================
 * Компонент: SyncIndicator
 * Ответственность: компактный индикатор состояния отправки в верхней панели —
 *                  «всё отправлено», «N в очереди», «ошибка», «нет сети».
 *                  По нажатию запускает отправку очереди вручную.
 * Зависимости: core/dom, core/store, core/styles, core/icons
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store } from '../../core/store.js';
import { plural } from '../../core/format.js';

/**
 * Создание индикатора.
 * @param {Object} props
 * @param {Function=} props.onTap — обработчик нажатия (ручная отправка)
 * @return {Object} { el, update, destroy }
 */
export function createSyncIndicator(props) {
  const options = props || {};
  const el = h('button.sync', {
    type: 'button',
    title: 'Состояние отправки данных',
    onclick: () => {
      if (typeof options.onTap === 'function') options.onTap();
    }
  });

  /** Перерисовка по текущему состоянию. */
  function update() {
    const state = store.get();
    const count = Number(state.queueCount) || 0;
    const hasError = Boolean(state.queueError);
    let modifier = 'sync--ok';
    let iconName = 'check';
    let text = 'Всё отправлено';

    if (!state.online) {
      modifier = 'sync--offline';
      iconName = 'cloudOff';
      text = count > 0 ? 'Офлайн, ' + count + ' в очереди' : 'Нет сети';
    } else if (hasError && count > 0) {
      modifier = 'sync--error';
      iconName = 'alert';
      text = count + ' ' + plural(count, ['запись', 'записи', 'записей']) + ' — ошибка';
    } else if (count > 0) {
      modifier = 'sync--pending';
      iconName = 'sync';
      text = count + ' ' + plural(count, ['запись', 'записи', 'записей']) + ' в очереди';
    }

    el.className = 'sync ' + modifier;
    setContent(el,
      h('span.sync__icon', { html: iconSvg(iconName, 16) }),
      h('span.sync__text', { text: text })
    );
  }

  loadStyles('js/components/SyncIndicator/styles/SyncIndicator.css');
  update();

  const unsubscribe = store.subscribe(update);

  return {
    el: el,
    update: update,
    destroy: unsubscribe
  };
}
