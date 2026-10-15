/**
 * ============================================================================
 * Компонент: Login
 * Ответственность: экран входа — имя и код доступа, показ ошибок,
 *                  проверка связи с сервером.
 * Зависимости: core/dom, core/styles, core/toast, core/icons, api/*
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { toastError } from '../../core/toast.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { CONFIG } from '../../config.js';

/**
 * Создание экрана входа.
 * @param {Object} props
 * @param {Function} props.onSuccess — (result) => void, result: { token, user, mustChangeCode }
 * @return {Object} { el }
 */
export function createLogin(props) {
  const options = props || {};

  const nameInput = h('input.input', {
    type: 'text',
    id: 'login-name',
    name: 'name',
    placeholder: 'Например: Мастер 7',
    autocomplete: 'username',
    autocapitalize: 'words',
    required: true
  });

  const codeInput = h('input.input.login__code-input', {
    type: 'tel',
    id: 'login-code',
    name: 'code',
    placeholder: '••••',
    inputmode: 'numeric',
    maxlength: '4',
    autocomplete: 'current-password',
    required: true
  });

  // Ввод кода: только цифры.
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
    hideError();
  });
  nameInput.addEventListener('input', hideError);

  const errorBox = h('div.login__error.hidden', { role: 'alert' });
  const submitBtn = h('button.btn.btn--primary.btn--block.login__submit', {
    type: 'submit'
  }, 'Войти');

  const connectionLine = h('span.login__status-line');

  const form = h('form.login__card', { novalidate: true },
    h('div.login__title', { text: 'Вход в приложение' }),
    h('p.login__hint', { text: 'Укажите имя и код доступа, который выдал руководитель.' }),
    errorBox,
    h('label.field',
      h('span.field__label', { text: 'Имя' }),
      nameInput
    ),
    h('label.field',
      h('span.field__label', { text: 'Код доступа' }),
      codeInput,
      h('span.field__hint', { text: 'Четыре цифры. Руководитель входит под кодом 0000.' })
    ),
    submitBtn
  );

  const el = h('div.login',
    h('div.login__brand',
      h('div.login__mark', { 'aria-hidden': 'true' }),
      h('div.login__name', { text: CONFIG.APP_NAME }),
      h('div.login__tagline', { text: 'Расчёт, объекты, закупки и отчёты' })
    ),
    form,
    h('div.login__demo',
      h('div.login__demo-title', { text: 'Первый вход' }),
      'Руководитель — имя «Руководитель», код 0000. Смените код сразу после входа.'
    ),
    h('div.login__status', connectionLine)
  );

  /** Показать сообщение об ошибке. */
  function showError(message) {
    setContent(errorBox,
      h('span.login__error-icon', { html: iconSvg('alert', 18) }),
      h('span', { text: message })
    );
    errorBox.classList.remove('hidden');
  }

  /** Скрыть сообщение об ошибке. */
  function hideError() {
    errorBox.classList.add('hidden');
  }

  /** Проверка связи с сервером. */
  async function checkConnection() {
    setContent(connectionLine,
      h('span.login__dot'),
      h('span', { text: 'Проверяем связь…' })
    );
    try {
      await api.health();
      setContent(connectionLine,
        h('span.login__dot'),
        h('span', { text: 'Связь с сервером есть' })
      );
    } catch (error) {
      setContent(connectionLine,
        h('span.login__dot.login__dot--bad'),
        h('span', { text: 'Сервер недоступен — проверьте интернет' })
      );
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();

    const name = String(nameInput.value || '').trim();
    const code = String(codeInput.value || '').trim();

    if (!name) {
      showError('Укажите имя');
      nameInput.focus();
      return;
    }
    if (code.length !== 4) {
      showError('Код доступа состоит из четырёх цифр');
      codeInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Входим…';

    try {
      const result = await api.login(name, code);
      if (typeof options.onSuccess === 'function') options.onSuccess(result);
    } catch (error) {
      const message = describeError(error);
      showError(message);
      if (!error.offline) toastError(message);
      codeInput.value = '';
      codeInput.focus();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
    }
  });

  // Подключение стилей и фоновые проверки.
  loadStyles('js/components/Login/styles/Login.css');
  checkConnection();

  // Ставим курсор в поле имени, но только если человек ещё ничего не выбрал.
  // Безусловный focus() через мгновение после показа экрана мог увести
  // курсор из поля кода прямо во время ввода — код оставался недобранным.
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || active === document.body) nameInput.focus();
  }, 120);

  return { el };
}
