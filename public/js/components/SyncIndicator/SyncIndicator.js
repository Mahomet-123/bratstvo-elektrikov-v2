/**
 * ============================================================================
 * Компонент: SyncIndicator
 * Ответственность: состояние обмена с сервером в верхней панели — две
 *                  компактные кнопки:
 *                    • очередь отправки: «всё отправлено», «N в очереди»,
 *                      «ошибка», «нет сети»; по нажатию отправляет записи;
 *                    • свежесть данных: когда данные разделов получены
 *                      с сервера; по нажатию обновляет их одним пакетом.
 *
 *                  Разделение нужно потому, что это разные заботы: очередь —
 *                  про то, не потерялись ли записи, а свежесть — про то,
 *                  не устарели ли данные на экране.
 * Зависимости: core/dom, core/store, core/bundle, core/styles, core/icons
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store } from '../../core/store.js';
import bundle from '../../core/bundle.js';
import { plural } from '../../core/format.js';

/** Как часто пересчитывать возраст данных, мс. */
const AGE_TICK_MS = 30000;

/**
 * Создание индикаторов.
 * @param {Object} props
 * @param {Function=} props.onTap — отправка очереди
 * @param {Function=} props.onRefresh — обновление пакета данных
 * @return {Object} { el, update, destroy }
 */
export function createSyncIndicator(props) {
  const options = props || {};

  /* --- Очередь отправки --- */

  const queuePill = h('button.sync.sync--ok', {
    type: 'button',
    title: 'Состояние отправки данных. Нажмите, чтобы отправить накопленные записи',
    onclick: () => {
      if (typeof options.onTap === 'function') options.onTap();
    }
  });

  /* --- Свежесть данных разделов --- */

  const dataPill = h('button.sync.sync--data', {
    type: 'button',
    title: 'Когда данные разделов получены с сервера. Нажмите, чтобы обновить',
    onclick: () => {
      if (typeof options.onRefresh === 'function') options.onRefresh();
    }
  });

  const el = h('div.sync-group', queuePill, dataPill);

  /** Короткий возраст данных: «сейчас», «7 мин», «2 ч». */
  function ageText() {
    const ms = bundle.ageMs();
    if (!isFinite(ms)) return '';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'сейчас';
    if (minutes < 60) return minutes + ' мин';
    return Math.floor(minutes / 60) + ' ч';
  }

  /** Перерисовка кнопки очереди. */
  function updateQueue() {
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

    queuePill.className = 'sync ' + modifier;
    setContent(queuePill,
      h('span.sync__icon', { html: iconSvg(iconName, 16) }),
      h('span.sync__text', { text: text })
    );
  }

  /** Перерисовка кнопки свежести данных. */
  function updateData() {
    const state = store.get();
    let modifier = 'sync--data';
    let iconName = 'check';
    let text = ageText();

    if (!bundle.has()) {
      modifier = 'sync--offline';
      iconName = 'cloudOff';
      text = 'Загрузить';
    } else if (bundle.isStale()) {
      modifier = 'sync--pending';
      iconName = 'sync';
      text = 'Обновить';
    } else if (!state.online) {
      modifier = 'sync--offline';
      iconName = 'cloudOff';
      text = text || 'Офлайн';
    }

    dataPill.className = 'sync ' + modifier;
    dataPill.title = bundle.has()
      ? 'Данные разделов обновлены: ' + (text || 'давно') + '. Нажмите, чтобы обновить'
      : 'Данные разделов ещё не загружены. Нажмите, чтобы загрузить';

    setContent(dataPill,
      h('span.sync__icon', { html: iconSvg(iconName, 16) }),
      h('span.sync__text', { text: text || '—' })
    );
  }

  /** Общая перерисовка. */
  function update() {
    updateQueue();
    updateData();
  }

  loadStyles('js/components/SyncIndicator/styles/SyncIndicator.css');
  update();

  const unsubscribeQueue = store.subscribe(updateQueue);
  const unsubscribeData = bundle.subscribe(updateData);

  // Возраст данных растёт сам по себе — обновляем подпись по часам.
  const timer = setInterval(updateData, AGE_TICK_MS);

  return {
    el: el,
    update: update,
    destroy: () => {
      unsubscribeQueue();
      unsubscribeData();
      clearInterval(timer);
    }
  };
}

export default createSyncIndicator;
