/**
 * ============================================================================
 * Компонент: ObjectCard
 * Ответственность: карточка объекта — реквизиты, итоги, переходы к расчёту,
 *                  журналу дней и закупкам, смена статуса, правка и уборка.
 * Зависимости: core/dom, core/styles, core/store, core/toast, core/modal,
 *              core/format, api/*, components/common/badges, components/ObjectForm
 * ============================================================================
 */

import { h, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store } from '../../core/store.js';
import bundle from '../../core/bundle.js';
import { toastSuccess, toastError } from '../../core/toast.js';
import { confirmDialog, openModal } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { moneyShort, hours, countLabel } from '../../core/format.js';
import { statusBadge } from '../common/badges.js';
import { createObjectForm } from '../ObjectForm/ObjectForm.js';
import { CONFIG } from '../../config.js';

/**
 * Создание карточки объекта.
 * @param {Object} props
 * @param {string} props.id — идентификатор объекта
 * @param {Function=} props.onNavigate — переход на другой экран
 * @param {Function=} props.onTitle — передать заголовок в верхнюю панель
 * @return {Object} { el, destroy }
 */
export function createObjectCard(props) {
  const options = props || {};
  const id = options.id;

  const state = store.get();
  const user = state.user || {};
  const isLeader = user.role === CONFIG.ROLE_LEADER || user.isLeader;

  let card = null;
  let loading = true;

  const bodyBox = h('div.object-card-screen__body');

  const el = h('div.page.object-card-screen', bodyBox);

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка экрана. */
  function render() {
    clear(bodyBox);

    if (loading && !card) {
      bodyBox.appendChild(h('div.loading-block',
        h('div.spinner'),
        h('div', { text: 'Загружаем объект…' })
      ));
      return;
    }

    if (!card) {
      bodyBox.appendChild(renderError());
      return;
    }

    const object = card.object;
    const totals = object.totals || {};
    const progress = card.progress || {};
    const estimate = card.estimate || {};

    bodyBox.appendChild(renderHero(object));
    bodyBox.appendChild(renderStats(object, progress, estimate));
    bodyBox.appendChild(renderNav(object, card.days || [], card.purchases || []));
    bodyBox.appendChild(renderStatusActions(object));
    bodyBox.appendChild(renderManage(object));
  }

  /** Шапка карточки: номер, название, статус, клиент. */
  function renderHero(object) {
    return h('div.card.object-card-screen__hero',
      h('div.object-card-screen__hero-top',
        h('span.object-card-screen__num', { text: 'Объект № ' + object.numberLabel }),
        statusBadge(object.status)
      ),
      h('h1.object-card-screen__title', { text: object.title || 'Без названия' }),
      h('div.object-card-screen__facts',
        fact('Клиент', object.client),
        fact('Адрес', object.address),
        object.phone
          ? h('a.object-card-screen__fact.object-card-screen__fact--link', { href: 'tel:' + object.phone.replace(/\s/g, '') },
            h('span.object-card-screen__fact-label', { text: 'Телефон' }),
            h('span.object-card-screen__fact-value', { text: object.phone })
          )
          : fact('Телефон', '')
      )
    );
  }

  /** Строка реквизита. */
  function fact(label, value) {
    if (!value) return null;
    return h('div.object-card-screen__fact',
      h('span.object-card-screen__fact-label', { text: label }),
      h('span.object-card-screen__fact-value', { text: value })
    );
  }

  /** Показатели: смета, закупки, часы, позиции. */
  function renderStats(object, progress, estimate) {
    return h('div.stats.object-card-screen__stats',
      h('div.stat',
        h('div.stat__label', { text: 'Итог расчёта' }),
        h('div.stat__value', { text: moneyShort(estimate.total || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Закупки' }),
        h('div.stat__value', { text: moneyShort(progress.purchases || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Часы' }),
        h('div.stat__value', { text: hours(progress.hours || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Позиций' }),
        h('div.stat__value', { text: String(estimate.positions || 0) })
      )
    );
  }

  /** Переходы к разделам объекта. */
  function renderNav(object, days, purchases) {
    const daysHours = days.reduce((acc, day) => acc + (Number(day.hours) || 0), 0);
    const purchasesSum = purchases.reduce((acc, item) => acc + (Number(item.sum) || 0), 0);

    return h('div.object-card-screen__section',
      h('div.page__section-title', { text: 'Разделы объекта' }),
      h('div.card',
        navRow('calc', 'Расчёт стоимости', estimateSummary(object, card.estimate), () => navigate('/object/' + encodeURIComponent(object.id) + '/calc')),
        navRow('clock', 'Журнал дней',
          days.length
            ? countLabel(days.length, ['запись', 'записи', 'записей']) + ' · ' + hours(daysHours)
            : 'Записей пока нет',
          () => navigate('/object/' + encodeURIComponent(object.id) + '/days')),
        navRow('cart', 'Закупки',
          purchases.length
            ? countLabel(purchases.length, ['закупка', 'закупки', 'закупок']) + ' · ' + moneyShort(purchasesSum)
            : 'Закупок пока нет',
          () => navigate('/object/' + encodeURIComponent(object.id) + '/purchases'))
      )
    );
  }

  /** Короткое описание расчёта для строки перехода. */
  function estimateSummary(object, estimate) {
    if (!estimate || !estimate.positions) return 'Позиции ещё не выбраны';
    return countLabel(estimate.positions, ['позиция', 'позиции', 'позиций']) + ' · ' + moneyShort(estimate.total || 0);
  }

  /** Строка перехода к разделу. */
  function navRow(iconName, title, subtitle, handler) {
    return h('button.row.row--tap', { type: 'button', onclick: handler },
      h('span.object-card-screen__row-icon', { html: iconSvg(iconName, 20) }),
      h('span.row__main',
        h('span.row__title', { text: title }),
        h('span.row__sub', { text: subtitle })
      ),
      h('span.row__side', { html: iconSvg('back', 20, 'object-card-screen__chevron') })
    );
  }

  /** Кнопки смены статуса. */
  function renderStatusActions(object) {
    const actions = [];

    if (object.status === CONFIG.STATUS_CALC) {
      actions.push(h('button.btn.btn--primary.btn--block', {
        type: 'button',
        onclick: () => changeStatus(CONFIG.STATUS_WORK)
      }, 'Перевести в работу'));
    } else if (object.status === CONFIG.STATUS_WORK) {
      actions.push(h('button.btn.btn--primary.btn--block', {
        type: 'button',
        onclick: () => closeObject()
      }, 'Закрыть объект'));
      actions.push(h('button.btn.btn--ghost.btn--block', {
        type: 'button',
        onclick: () => changeStatus(CONFIG.STATUS_CALC)
      }, 'Вернуть в расчёт'));
    } else if (object.status === CONFIG.STATUS_CLOSED) {
      actions.push(h('button.btn.btn--ghost.btn--block', {
        type: 'button',
        onclick: () => changeStatus(CONFIG.STATUS_WORK)
      }, 'Возобновить работы'));
    }

    return h('div.object-card-screen__section',
      h('div.page__section-title', { text: 'Статус' }),
      h('div.object-card-screen__actions', actions)
    );
  }

  /** Управление: правка, кабинет, отчёт, уборка. */
  function renderManage(object) {
    const rows = [];

    rows.push(h('button.row.row--tap', { type: 'button', onclick: () => editObject(object) },
      h('span.row__main',
        h('span.row__title', { text: 'Редактировать реквизиты' }),
        h('span.row__sub', { text: 'Название, клиент, адрес, телефон' })
      ),
      h('span.row__side', { html: iconSvg('edit', 20) })
    ));

    rows.push(h('button.row.row--tap', {
      type: 'button',
      onclick: () => navigate('/cabinet/' + encodeURIComponent(object.id))
    },
      h('span.row__main',
        h('span.row__title', { text: 'Кабинет клиента' }),
        h('span.row__sub', {
          text: object.hasCabinet
            ? 'Ссылка открыта — клиент видит ход работ'
            : 'Персональная ссылка на объект без входа в приложение'
        })
      ),
      h('span.row__side', { html: iconSvg(object.hasCabinet ? 'eye' : 'lock', 20) })
    ));

    rows.push(h('button.row.row--tap', {
      type: 'button',
      onclick: () => navigate('/object/' + encodeURIComponent(object.id) + '/report')
    },
      h('span.row__main',
        h('span.row__title', { text: 'Отчёт для клиента' }),
        h('span.row__sub', { text: 'PDF, веб-страница и отправка письмом' })
      ),
      h('span.row__side', { html: iconSvg('doc', 20) })
    ));

    // Убрать объект можно только в статусе «расчёт» — чтобы не потерять работы.
    if (isLeader && object.status === CONFIG.STATUS_CALC) {
      rows.push(h('button.row.row--tap.object-card-screen__row--danger', {
        type: 'button',
        onclick: () => removeObject(object)
      },
        h('span.row__main',
          h('span.row__title', { text: 'Убрать объект' }),
          h('span.row__sub', { text: 'Лист объекта сохранится в корзине на Диске' })
        ),
        h('span.row__side', { html: iconSvg('trash', 20) })
      ));
    }

    return h('div.object-card-screen__section',
      h('div.page__section-title', { text: 'Управление' }),
      h('div.card', rows)
    );
  }

  /** Состояние ошибки. */
  function renderError() {
    return h('div.empty',
      h('div.empty__icon.object-card-screen__empty-icon', { html: iconSvg('alert', 26) }),
      h('div.empty__title', { text: 'Не удалось открыть объект' }),
      h('div.empty__text', { text: 'Проверьте связь и попробуйте снова.' }),
      h('div', { style: { marginTop: '16px' } },
        h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
      )
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Загрузка карточки. */
  async function load() {
    loading = true;
    render();
    try {
      card = await api.objectGet(id);
      loading = false;
      render();
      if (typeof options.onTitle === 'function' && card && card.object) {
        options.onTitle(card.object.title, '№ ' + card.object.numberLabel);
      }
    } catch (error) {
      loading = false;
      card = null;
      render();
      toastError(describeError(error));
    }
  }

  /** Смена статуса объекта. */
  async function changeStatus(status) {
    try {
      await api.objectSetStatus(id, status);
      // Список объектов берётся из пакета данных — он устарел, обновляем.
      bundle.refresh();
      toastSuccess('Статус изменён: ' + CONFIG.STATUS_LABEL[status]);
      await load();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Закрытие объекта с подтверждением. */
  async function closeObject() {
    const confirmed = await confirmDialog({
      title: 'Закрыть объект?',
      text: 'Объект перейдёт в статус «Закрыт» и уедет в архив по годам. Работы можно будет возобновить.',
      confirmText: 'Закрыть объект'
    });
    if (!confirmed) return;
    await changeStatus(CONFIG.STATUS_CLOSED);
  }

  /** Правка реквизитов во всплывающем окне. */
  async function editObject(object) {
    const form = createObjectForm({
      object: object,
      allowStatus: false,
      hideSubmit: true,
      onSubmit: async () => {}
    });

    const action = await openModal({
      title: 'Реквизиты объекта',
      body: form.el,
      actions: [
        { label: 'Отмена', variant: 'ghost', value: null },
        { label: 'Сохранить', variant: 'primary', value: 'save' }
      ]
    });

    if (action !== 'save') return;

    const data = form.getData();
    if (!data.title) {
      toastError('Название объекта не может быть пустым');
      return;
    }

    try {
      await api.objectUpdate(id, data);
      // Название, клиент и адрес видны в списке — пакет данных устарел.
      bundle.refresh();
      toastSuccess('Изменения сохранены');
      await load();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Уборка объекта — с сохранением листа в корзине. */
  async function removeObject(object) {
    const confirmed = await confirmDialog({
      title: 'Убрать объект?',
      text: 'Объект исчезнет из приложения. Его лист с расчётом, днями и закупками переедет в таблицу-корзину на Google Диске — данные не пропадут.',
      confirmText: 'Убрать объект',
      danger: true
    });
    if (!confirmed) return;

    try {
      const result = await api.objectRemove(id);
      // Объекта больше нет — обновляем пакет сразу, чтобы он не остался
      // в списке до следующего захода.
      bundle.refresh();
      toastSuccess(result.message || 'Объект убран');
      navigate('/objects', true);
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Переход на другой экран. */
  function navigate(path, replace) {
    if (typeof options.onNavigate === 'function') {
      options.onNavigate(path, replace);
    } else if (replace) {
      window.history.replaceState(null, '', '#' + path);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      window.location.hash = '#' + path;
    }
  }

  loadStyles('js/components/ObjectCard/styles/ObjectCard.css');

  render();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createObjectCard;
