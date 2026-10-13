/**
 * ============================================================================
 * Компонент: ObjectForm
 * Ответственность: форма реквизитов объекта — используется и на отдельном
 *                  экране «Новый объект», и во всплывающем окне правки.
 * Зависимости: core/dom, core/styles, core/toast, api/*
 * ============================================================================
 */

import { h } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { toastError } from '../../core/toast.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { CONFIG } from '../../config.js';

/**
 * Создание формы реквизитов объекта.
 * @param {Object} props
 * @param {Object=} props.object — заполненные поля при правке
 * @param {string=} props.submitLabel
 * @param {boolean=} props.allowStatus — показывать выбор статуса
 * @param {boolean=} props.hideSubmit — не показывать свою кнопку отправки
 * @param {Function} props.onSubmit — (data) => Promise, вызывается при отправке
 * @return {Object} { el, setBusy, getData }
 */
export function createObjectForm(props) {
  const options = props || {};
  const source = options.object || {};

  const titleInput = h('input.input', {
    type: 'text',
    value: source.title || '',
    placeholder: 'Например: Коттедж в Магасе',
    autocomplete: 'off'
  });
  const clientInput = h('input.input', {
    type: 'text',
    value: source.client || '',
    placeholder: 'Фамилия, имя или организация',
    autocomplete: 'off'
  });
  const addressInput = h('input.input', {
    type: 'text',
    value: source.address || '',
    placeholder: 'Улица, дом, населённый пункт',
    autocomplete: 'off'
  });
  const phoneInput = h('input.input', {
    type: 'tel',
    value: source.phone || '',
    placeholder: '+7 900 000-00-00',
    inputmode: 'tel',
    autocomplete: 'off'
  });

  const statusSelect = h('select.select', {},
    [CONFIG.STATUS_CALC, CONFIG.STATUS_WORK].map((status) =>
      h('option', {
        value: status,
        text: CONFIG.STATUS_LABEL[status],
        selected: (source.status || CONFIG.STATUS_CALC) === status
      })
    )
  );

  const submitBtn = h('button.btn.btn--primary.btn--block', { type: 'submit' },
    options.submitLabel || 'Сохранить');

  /** Сбор значений формы. */
  function getData() {
    const data = {
      title: titleInput.value.trim(),
      client: clientInput.value.trim(),
      address: addressInput.value.trim(),
      phone: phoneInput.value.trim()
    };
    if (options.allowStatus) data.status = statusSelect.value;
    return data;
  }

  const form = h('form.object-form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const data = getData();

      if (!data.title) {
        toastError('Укажите название объекта');
        titleInput.focus();
        return;
      }

      setBusy(true);
      try {
        await options.onSubmit(data);
      } catch (error) {
        toastError(describeError(error));
      } finally {
        setBusy(false);
      }
    }
  },
    h('label.field',
      h('span.field__label', { text: 'Название объекта' }),
      titleInput,
      h('span.field__hint', { text: 'Коротко и понятно — так объект видно в списке.' })
    ),
    h('label.field',
      h('span.field__label', { text: 'Клиент' }),
      clientInput
    ),
    h('label.field',
      h('span.field__label', { text: 'Адрес' }),
      addressInput
    ),
    h('label.field',
      h('span.field__label', { text: 'Телефон' }),
      phoneInput
    ),
    options.allowStatus
      ? h('label.field',
        h('span.field__label', { text: 'Статус' }),
        statusSelect
      )
      : null,
    options.hideSubmit ? null : h('div.object-form__actions', submitBtn)
  );

  /** Блокировка формы на время отправки. */
  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? 'Сохраняем…' : (options.submitLabel || 'Сохранить');
    [titleInput, clientInput, addressInput, phoneInput, statusSelect].forEach((field) => {
      field.disabled = busy;
    });
  }

  loadStyles('js/components/ObjectForm/styles/ObjectForm.css');

  return { el: form, setBusy: setBusy, getData: getData };
}

/**
 * Экран «Новый объект».
 * @param {Object} props
 * @param {Function=} props.onNavigate
 * @return {Object} { el, destroy }
 */
export function createObjectScreen(props) {
  const options = props || {};

  /** Переход на другой экран. */
  function navigate(path, replace) {
    if (typeof options.onNavigate === 'function') {
      options.onNavigate(path, replace);
    } else if (replace) {
      window.history.replaceState(null, '', '#' + path);
    } else {
      window.location.hash = '#' + path;
    }
  }

  const form = createObjectForm({
    allowStatus: true,
    submitLabel: 'Создать объект',
    onSubmit: async (data) => {
      const result = await api.objectCreate(data);
      // Сразу переходим в карточку созданного объекта.
      navigate('/object/' + encodeURIComponent(result.object.id), true);
    }
  });

  const el = h('div.page',
    h('div.card',
      h('div.card__head', h('div.card__title', { text: 'Новый объект' })),
      h('div.card__body',
        h('p.text-muted.text-small', {
          style: { marginBottom: '16px' },
          text: 'После создания появится отдельный лист объекта с расчётом, журналом дней и закупками.'
        }),
        form.el
      )
    )
  );

  return { el: el, destroy: () => {} };
}

export default createObjectForm;
