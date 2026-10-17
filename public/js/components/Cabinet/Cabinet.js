/**
 * ============================================================================
 * Компонент: Cabinet
 * Ответственность: управление кабинетом клиента — персональной ссылкой на
 *                  объект, которая открывается без входа в приложение.
 *                  Можно открыть доступ, скопировать ссылку, посмотреть,
 *                  как её видит клиент, и закрыть доступ.
 *                  Закрытие меняет токен: сохранённая клиентом ссылка
 *                  перестаёт работать навсегда.
 * Зависимости: core/dom, core/styles, core/toast, core/modal, core/format,
 *              core/clipboard, api/*, components/common/badges
 * ============================================================================
 */

import { h, setContent, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { toastSuccess, toastError } from '../../core/toast.js';
import { confirmDialog } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { runBusy } from '../../core/busy.js';
import { copyText } from '../../core/clipboard.js';
import { statusBadge } from '../common/badges.js';

/**
 * Создание экрана кабинета клиента.
 * @param {Object} props
 * @param {string} props.id — идентификатор объекта
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createCabinet(props) {
  const options = props || {};
  const id = options.id;

  let state = null;   // { enabled, url, validity, object }
  let loading = true;

  const bodyBox = h('div.cabinet__body');
  const el = h('div.page.cabinet', bodyBox);

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка. */
  function render() {
    clear(bodyBox);

    if (loading && !state) {
      bodyBox.appendChild(h('div.loading-block',
        h('div.spinner'),
        h('div', { text: 'Загружаем кабинет…' })
      ));
      return;
    }

    if (!state) {
      bodyBox.appendChild(renderError());
      return;
    }

    const object = state.object || {};
    bodyBox.appendChild(renderObjectCard(object));
    bodyBox.appendChild(state.enabled ? renderOpen() : renderClosed());
    bodyBox.appendChild(renderHelp());
  }

  /** Шапка: какой объект и в каком он статусе. */
  function renderObjectCard(object) {
    return h('div.card.cabinet__object',
      h('div.card__body',
        h('div.cabinet__object-top',
          h('span.cabinet__object-num', { text: 'Объект № ' + object.numberLabel }),
          statusBadge(object.status)
        ),
        h('div.cabinet__object-title', { text: object.title || 'Без названия' }),
        object.client ? h('div.cabinet__object-client', { text: 'Клиент: ' + object.client }) : null
      )
    );
  }

  /** Доступ открыт: показываем ссылку и действия. */
  function renderOpen() {
    const linkField = h('input.input.cabinet__link', {
      type: 'text',
      readonly: 'readonly',
      value: state.url || ''
    });

    return h('div.card.cabinet__state.cabinet__state--open',
      h('div.card__head',
        h('div.card__title', { text: 'Доступ открыт' }),
        h('div.cabinet__badge', h('span.badge.badge--success', { text: 'работает' }))
      ),
      h('div.card__body',
        h('p.cabinet__text', {
          text: 'Клиент открывает ссылку без входа и пароля: видит расчёт, журнал работ и фото накладных.'
        }),
        linkField,
        h('div.cabinet__actions',
          h('button.btn.btn--primary.btn--block', {
            type: 'button',
            onclick: (event) => doCopy(event.currentTarget)
          }, 'Скопировать ссылку'),
          h('button.btn.btn--ghost.btn--block', {
            type: 'button',
            onclick: () => openPreview()
          }, 'Посмотреть как клиент')
        ),
        h('div.cabinet__validity', {
          text: 'Ссылка действительна ' + (state.validity || 'пока идут работы')
        }),
        h('button.btn.btn--danger.btn--block.cabinet__revoke', {
          type: 'button',
          onclick: (event) => doRevoke(event.currentTarget)
        }, 'Закрыть доступ')
      )
    );
  }

  /** Доступ закрыт: предлагаем открыть. */
  function renderClosed() {
    return h('div.card.cabinet__state.cabinet__state--closed',
      h('div.card__head',
        h('div.card__title', { text: 'Доступ закрыт' }),
        h('div.cabinet__badge', h('span.badge.badge--muted', { text: 'выключен' }))
      ),
      h('div.card__body',
        h('p.cabinet__text', {
          text: 'Клиент не может открыть объект. Включите доступ — приложение выдаст персональную ссылку.'
        }),
        h('button.btn.btn--primary.btn--block', {
          type: 'button',
          onclick: (event) => doOpen(event.currentTarget)
        }, 'Открыть доступ и получить ссылку')
      )
    );
  }

  /** Пояснение для мастера. */
  function renderHelp() {
    return h('div.card.card--flat.cabinet__help',
      h('div.card__body',
        h('div.cabinet__help-title', { text: 'Как это работает' }),
        h('ul.cabinet__list',
          h('li', { text: 'Ссылка ведёт на страницу объекта — вход в приложение не нужен.' }),
          h('li', { text: 'Клиент видит расчёт, часы по дням, закупки и фотографии накладных.' }),
          h('li', { text: 'У каждого объекта своя ссылка: чужой объект по ней не открыть.' }),
          h('li', { text: '«Закрыть доступ» сразу гасит ссылку — даже если клиент её сохранил.' }),
          h('li', { text: 'Через несколько дней после закрытия объекта доступ гасится сам.' })
        )
      )
    );
  }

  /** Состояние ошибки. */
  function renderError() {
    return h('div.empty',
      h('div.empty__icon.cabinet__empty-icon', { html: iconSvg('alert', 26) }),
      h('div.empty__title', { text: 'Не удалось открыть кабинет' }),
      h('div.empty__text', { text: 'Проверьте связь и попробуйте снова.' }),
      h('div', { style: { marginTop: '16px' } },
        h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
      )
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Загрузка состояния кабинета. */
  async function load() {
    loading = true;
    render();
    try {
      state = await api.cabinetGet(id);
      loading = false;
      render();
      if (typeof options.onTitle === 'function' && state && state.object) {
        options.onTitle('Кабинет клиента', '№ ' + state.object.numberLabel);
      }
    } catch (error) {
      loading = false;
      state = null;
      render();
      toastError(describeError(error));
    }
  }

  /** Открытие доступа. */
  async function doOpen(button) {
    await runBusy(button, 'Открываем доступ…', async () => {
      try {
        const result = await api.cabinetLink(id);
        toastSuccess('Доступ открыт — ссылку можно отправлять клиенту');
        state = Object.assign({}, state, {
          enabled: true,
          url: result.url,
          object: Object.assign({}, state && state.object, { hasCabinet: true })
        });
        render();
      } catch (error) {
        toastError(describeError(error));
      }
    });
  }

  /** Закрытие доступа. */
  async function doRevoke(button) {
    const confirmed = await confirmDialog({
      title: 'Закрыть доступ клиенту?',
      text: 'Ссылка перестанет работать сразу. Если клиент сохранил её, она всё равно не откроется — ' +
        'приложение выдаст новую ссылку при следующем включении.',
      confirmText: 'Закрыть доступ',
      danger: true
    });
    if (!confirmed) return;

    await runBusy(button, 'Закрываем доступ…', async () => {
      try {
        await api.cabinetRevoke(id);
        toastSuccess('Доступ закрыт, ссылка погашена');
        await load();
      } catch (error) {
        toastError(describeError(error));
      }
    });
  }

  /** Копирование ссылки в буфер обмена. */
  async function doCopy(button) {
    await runBusy(button, 'Копируем…', async () => {
      const done = await copyText(state.url);
      if (done) toastSuccess('Ссылка скопирована — можно вставить в сообщение');
      else toastError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.');
    });
  }

  /** Открыть страницу кабинета в новой вкладке. */
  function openPreview() {
    if (!state.url) {
      toastError('Ссылка ещё не получена');
      return;
    }
    window.open(state.url, '_blank', 'noopener');
  }

  loadStyles('js/components/Cabinet/styles/Cabinet.css');

  render();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createCabinet;
