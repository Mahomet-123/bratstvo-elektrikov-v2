/**
 * ============================================================================
 * Компонент: Report
 * Ответственность: отчёт клиенту по объекту — сборка PDF, отправка письмом
 *                  и веб-версия отчёта по персональной ссылке кабинета.
 *                  PDF собирается на сервере в отдельной временной таблице,
 *                  поэтому его подготовка занимает несколько секунд —
 *                  кнопки на это время блокируются.
 * Зависимости: core/dom, core/styles, core/toast, core/modal, core/format,
 *              core/clipboard, api/*, components/common/badges
 * ============================================================================
 */

import { h, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { toastSuccess, toastError, toastWarning } from '../../core/toast.js';
import { promptDialog } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { copyText } from '../../core/clipboard.js';
import { moneyShort, hours, fileSize, dateShort } from '../../core/format.js';
import { statusBadge } from '../common/badges.js';

/**
 * Создание экрана отчёта.
 * @param {Object} props
 * @param {string} props.id — идентификатор объекта
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createReport(props) {
  const options = props || {};
  const id = options.id;

  let card = null;      // карточка объекта с сервера
  let links = null;     // { url, cabinetUrl } — только при открытом кабинете
  let loading = true;
  let busy = '';        // что сейчас готовится: 'pdf' | 'send'

  const bodyBox = h('div.report__body');
  const el = h('div.page.report', bodyBox);

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка. */
  function render() {
    clear(bodyBox);

    if (loading && !card) {
      bodyBox.appendChild(h('div.loading-block',
        h('div.spinner'),
        h('div', { text: 'Готовим отчёт…' })
      ));
      return;
    }

    if (!card) {
      bodyBox.appendChild(renderError());
      return;
    }

    bodyBox.appendChild(renderObjectCard(card.object));
    bodyBox.appendChild(renderTotals(card.object, card.estimate));
    bodyBox.appendChild(renderActions(card.object));
    bodyBox.appendChild(links ? renderLinks() : renderCabinetNotice(card.object));
  }

  /** Шапка: объект и статус. */
  function renderObjectCard(object) {
    return h('div.card.report__object',
      h('div.card__body',
        h('div.report__object-top',
          h('span.report__object-num', { text: 'Объект № ' + object.numberLabel }),
          statusBadge(object.status)
        ),
        h('div.report__object-title', { text: object.title || 'Без названия' }),
        h('div.report__object-meta', {
          text: [
            object.client || '',
            object.address || '',
            object.created ? 'начат ' + dateShort(object.created) : ''
          ].filter(Boolean).join(' · ')
        })
      )
    );
  }

  /** Что попадёт в отчёт. */
  function renderTotals(object, estimate) {
    const totals = object.totals || {};
    return h('div.stats.report__totals',
      h('div.stat',
        h('div.stat__label', { text: 'Итог расчёта' }),
        h('div.stat__value', { text: moneyShort(totals.estimate || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Закупки' }),
        h('div.stat__value', { text: moneyShort(totals.purchases || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Часы' }),
        h('div.stat__value', { text: hours(totals.hours || 0) })
      ),
      h('div.stat',
        h('div.stat__label', { text: 'Позиций' }),
        h('div.stat__value', { text: String((estimate && estimate.positions) || 0) })
      )
    );
  }

  /** Кнопки отчёта. */
  function renderActions(object) {
    return h('div.card.report__actions',
      h('div.card__head', h('div.card__title', { text: 'Что отправить клиенту' })),
      h('div.card__body',
        actionRow('download', 'Скачать PDF',
          busy === 'pdf' ? 'Собираем файл…' : 'Готовый документ с расчётом, днями и закупками',
          () => buildPdf(),
          busy === 'pdf'),
        actionRow('phone', 'Отправить письмом',
          busy === 'send' ? 'Готовим и отправляем…' : 'Письмо с PDF и ссылкой на кабинет',
          () => sendByEmail(),
          busy === 'send'),
        actionRow('share', 'Показать веб-отчёт',
          'Откроется страница отчёта — без входа и пароля',
          () => openWebReport(),
          false)
      )
    );
  }

  /** Строка-действие. */
  function actionRow(iconName, title, subtitle, handler, disabled) {
    return h('button.row.row--tap.report__action', {
      type: 'button',
      disabled: disabled,
      onclick: handler
    },
      h('span.report__action-icon', { html: iconSvg(iconName, 20) }),
      h('span.row__main',
        h('span.row__title', { text: title }),
        h('span.row__sub', { text: subtitle })
      ),
      // Пока работа идёт, вместо стрелки крутится значок ожидания.
      h('span.row__side', disabled
        ? h('span.spinner.spinner--sm')
        : { html: iconSvg('back', 20, 'report__chevron') })
    );
  }

  /** Ссылки кабинета — когда доступ открыт. */
  function renderLinks() {
    const cabinetField = h('input.input.report__link', {
      type: 'text',
      readonly: 'readonly',
      value: links.cabinetUrl || ''
    });
    const reportField = h('input.input.report__link', {
      type: 'text',
      readonly: 'readonly',
      value: links.url || ''
    });

    return h('div.card.report__links',
      h('div.card__head', h('div.card__title', { text: 'Ссылки для клиента' })),
      h('div.card__body',
        h('div.field',
          h('span.field__label', { text: 'Кабинет объекта' }),
          cabinetField
        ),
        h('button.btn.btn--ghost.btn--block', {
          type: 'button',
          onclick: () => copy(cabinetField.value, 'Ссылка на кабинет скопирована')
        }, 'Скопировать ссылку на кабинет'),
        h('div.field.report__field-gap',
          h('span.field__label', { text: 'Страница отчёта' }),
          reportField
        ),
        h('button.btn.btn--ghost.btn--block', {
          type: 'button',
          onclick: () => copy(reportField.value, 'Ссылка на отчёт скопирована')
        }, 'Скопировать ссылку на отчёт')
      )
    );
  }

  /** Кабинет закрыт — веб-ссылки недоступны. */
  function renderCabinetNotice(object) {
    return h('div.card.card--flat.report__notice',
      h('div.card__body',
        h('div.report__notice-title', { text: 'Кабинет клиента закрыт' }),
        h('div.report__notice-text', {
          text: 'PDF собирается и отправляется письмом в любом случае. ' +
            'А чтобы клиент мог сам открыть отчёт и фото накладных по ссылке, включите доступ в кабинете.'
        }),
        h('button.btn.btn--primary.btn--block', {
          type: 'button',
          onclick: () => navigate('/cabinet/' + encodeURIComponent(object.id))
        }, 'Открыть кабинет клиента')
      )
    );
  }

  /** Состояние ошибки. */
  function renderError() {
    return h('div.empty',
      h('div.empty__icon.report__empty-icon', { html: iconSvg('alert', 26) }),
      h('div.empty__title', { text: 'Не удалось подготовить отчёт' }),
      h('div.empty__text', { text: 'Проверьте связь и попробуйте снова.' }),
      h('div', { style: { marginTop: '16px' } },
        h('button.btn.btn--ghost', { type: 'button', onclick: load }, 'Повторить')
      )
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Загрузка карточки и ссылок. */
  async function load() {
    loading = true;
    render();
    try {
      card = await api.objectGet(id);
      loading = false;

      // Ссылки запрашиваем только при открытом кабинете: иначе они мертвы.
      if (card && card.object && card.object.hasCabinet) {
        try {
          links = await api.reportLink(id);
        } catch (error) {
          links = null;
        }
      } else {
        links = null;
      }

      render();
      if (typeof options.onTitle === 'function' && card && card.object) {
        options.onTitle('Отчёт клиенту', '№ ' + card.object.numberLabel);
      }
    } catch (error) {
      loading = false;
      card = null;
      render();
      toastError(describeError(error));
    }
  }

  /** Сборка PDF и открытие файла. */
  async function buildPdf() {
    if (busy) return;
    busy = 'pdf';
    render();

    try {
      const result = await api.reportPdf(id);
      toastSuccess('PDF готов: ' + fileSize(result.size || 0));
      if (result.url) window.open(result.url, '_blank', 'noopener');
      else toastWarning('Файл собран, но ссылку открыть не удалось — найдите его на Google Диске');
    } catch (error) {
      toastError(describeError(error));
    } finally {
      busy = '';
      render();
    }
  }

  /** Отправка отчёта письмом. */
  async function sendByEmail() {
    if (busy) return;

    const object = card.object;
    const email = await promptDialog({
      title: 'Отправить отчёт клиенту',
      text: 'Письмо с PDF-файлом и ссылкой на кабинет уйдёт с вашей почты.',
      label: 'Адрес электронной почты',
      value: '',
      placeholder: 'client@example.ru',
      inputmode: 'email',
      confirmText: 'Отправить'
    });
    if (!email) return;

    if (email.indexOf('@') === -1 || email.indexOf('.') === -1) {
      toastError('Проверьте адрес: он должен содержать «@» и точку');
      return;
    }

    busy = 'send';
    render();

    try {
      const result = await api.reportSend(id, email);
      toastSuccess('Отчёт отправлен на ' + (result.sent || email));
      if (!links && result.cabinet) {
        links = { url: result.report || '', cabinetUrl: result.cabinet };
        render();
      }
    } catch (error) {
      toastError(describeError(error));
    } finally {
      busy = '';
      render();
    }
  }

  /** Открытие веб-версии отчёта. */
  async function openWebReport() {
    if (!links || !links.url) {
      toastError('Сначала откройте кабинет клиента — иначе ссылка не работает');
      return;
    }
    window.open(links.url, '_blank', 'noopener');
  }

  /** Копирование ссылки. */
  async function copy(value, message) {
    const done = await copyText(value);
    if (done) toastSuccess(message);
    else toastError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.');
  }

  /** Переход на другой экран. */
  function navigate(path) {
    if (typeof options.onNavigate === 'function') options.onNavigate(path);
    else window.location.hash = '#' + path;
  }

  loadStyles('js/components/Report/styles/Report.css');

  render();
  load();

  return {
    el: el,
    refresh: load,
    destroy: () => {}
  };
}

export default createReport;
