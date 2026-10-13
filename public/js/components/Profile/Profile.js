/**
 * ============================================================================
 * Компонент: Profile
 * Ответственность: экран профиля — сведения о пользователе, смена своего кода,
 *                  состояние отправки данных, сведения о приложении, выход.
 * Зависимости: core/dom, core/styles, core/store, core/toast, core/modal, api/*
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { store, saveSession, clearCache } from '../../core/store.js';
import { toastSuccess, toastError } from '../../core/toast.js';
import { confirmDialog } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { initials, dateTimeRu, plural } from '../../core/format.js';
import { CONFIG } from '../../config.js';

/**
 * Создание экрана профиля.
 * @param {Object} props
 * @param {Function} props.onLogout — вызывается после выхода
 * @param {Function=} props.onNavigate — переход на другой экран
 * @return {Object} { el, destroy }
 */
export function createProfile(props) {
  const options = props || {};
  const state = store.get();
  const user = state.user || { name: '—', role: 'master' };
  const isLeader = user.role === CONFIG.ROLE_LEADER || user.isLeader;

  /* --- Смена кода --- */

  const oldInput = h('input.input', { type: 'tel', inputmode: 'numeric', maxlength: '4', placeholder: 'Текущий код' });
  const newInput = h('input.input', { type: 'tel', inputmode: 'numeric', maxlength: '4', placeholder: 'Новый код' });
  const repeatInput = h('input.input', { type: 'tel', inputmode: 'numeric', maxlength: '4', placeholder: 'Повторите новый код' });

  [oldInput, newInput, repeatInput].forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
    });
  });

  const changeBtn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, 'Сменить код');

  const codeForm = h('form.card', {
    onsubmit: async (event) => {
      event.preventDefault();
      const oldCode = oldInput.value;
      const newCode = newInput.value;
      const repeat = repeatInput.value;

      if (oldCode.length !== 4) return toastError('Введите текущий код из четырёх цифр');
      if (newCode.length !== 4) return toastError('Новый код должен состоять из четырёх цифр');
      if (newCode !== repeat) return toastError('Новый код и повтор не совпадают');
      if (newCode === oldCode) return toastError('Новый код совпадает с текущим');

      changeBtn.disabled = true;
      changeBtn.textContent = 'Сохраняем…';
      try {
        await api.changeCode(oldCode, newCode);
        toastSuccess('Код изменён. Используйте его при следующем входе.');
        oldInput.value = '';
        newInput.value = '';
        repeatInput.value = '';
        store.patch({ mustChangeCode: false });
        const saved = store.get().session;
        if (saved) saveSession(saved, false);
        renderAlert();
      } catch (error) {
        toastError(describeError(error));
      } finally {
        changeBtn.disabled = false;
        changeBtn.textContent = 'Сменить код';
      }
    }
  },
    h('div.card__head', h('div.card__title', { text: 'Код доступа' })),
    h('div.card__body',
      h('label.field',
        h('span.field__label', { text: 'Текущий код' }),
        oldInput
      ),
      h('label.field',
        h('span.field__label', { text: 'Новый код' }),
        newInput
      ),
      h('label.field',
        h('span.field__label', { text: 'Повтор нового кода' }),
        repeatInput
      ),
      changeBtn
    )
  );

  /* --- Состояние отправки --- */

  const statusRows = h('div.card');
  const manualSendBtn = h('button.btn.btn--ghost.btn--block', {
    type: 'button',
    onclick: () => {
      if (typeof options.onManualSend === 'function') {
        options.onManualSend();
      } else {
        toastSuccess('Очередь пуста — отправлять нечего');
      }
    }
  }, 'Отправить очередь сейчас');

  const statusCard = h('div',
    h('div.page__section-title', { text: 'Отправка данных' }),
    statusRows,
    h('div', { style: { marginTop: '12px' } }, manualSendBtn)
  );

  /* --- Бригада (только руководитель) --- */

  const leaderCard = isLeader
    ? h('div',
      h('div.page__section-title', { text: 'Руководителю' }),
      h('div.card',
        h('button.row.row--tap', { type: 'button', onclick: () => navigate('/brigade') },
          h('span.row__main',
            h('span.row__title', { text: 'Бригада и коды доступа' }),
            h('span.row__sub', { text: 'Выдать коды, включить и отключить мастеров' })
          ),
          h('span.row__side', { html: iconSvg('team', 20) })
        ),
        h('button.row.row--tap', { type: 'button', onclick: () => navigate('/visits') },
          h('span.row__main',
            h('span.row__title', { text: 'Посещения и записи' }),
            h('span.row__sub', { text: 'Кто заходил, кто вёл день' })
          ),
          h('span.row__side', { html: iconSvg('eye', 20) })
        ),
        h('button.row.row--tap', { type: 'button', onclick: () => navigate('/analytics') },
          h('span.row__main',
            h('span.row__title', { text: 'Аналитика' }),
            h('span.row__sub', { text: 'Суммы по дням, прогресс, сводка по объектам' })
          ),
          h('span.row__side', { html: iconSvg('chart', 20) })
        )
      )
    )
    : null;

  /* --- О приложении --- */

  const aboutCard = h('div',
    h('div.page__section-title', { text: 'О приложении' }),
    h('div.card',
      h('div.card__body.profile__about',
        h('div', { text: CONFIG.APP_NAME + ' — версия ' + CONFIG.VERSION }),
        h('div', { style: { marginTop: '8px' }, text: 'Данные хранятся в Google Таблице, фото — на Google Диске. Приложение работает офлайн: записи сохраняются на телефоне и уходят сами, когда появится сеть.' }),
        h('div', { style: { marginTop: '8px' } },
          'Сервер: ',
          h('code', { text: CONFIG.API_URL })
        )
      )
    )
  );

  /* --- Выход --- */

  const logoutBtn = h('button.btn.btn--danger.btn--block.profile__logout', {
    type: 'button',
    onclick: async () => {
      const confirmed = await confirmDialog({
        title: 'Выйти из приложения?',
        text: 'Локальные данные будут очищены. Неотправленные записи останутся в очереди на телефоне.',
        confirmText: 'Выйти',
        danger: true
      });
      if (!confirmed) return;

      try {
        await api.logout();
      } catch (error) {
        // Даже если сервер недоступен, выходим локально.
      }
      clearCache();
      saveSession(null);
      if (typeof options.onLogout === 'function') options.onLogout();
    }
  }, 'Выйти');

  /* --- Сборка экрана --- */

  const alertBox = h('div');

  const el = h('div.page',
    h('div.profile__hero',
      h('div.profile__avatar', { text: initials(user.name) }),
      h('div',
        h('div.profile__name', { text: user.name || '—' }),
        h('div.profile__role', { text: isLeader ? 'Руководитель' : 'Мастер' })
      )
    ),
    alertBox,
    h('div.page__section', codeForm),
    h('div.page__section', statusCard),
    leaderCard ? h('div.page__section', leaderCard) : null,
    h('div.page__section', aboutCard),
    logoutBtn
  );

  /** Переход на другой экран. */
  function navigate(path) {
    if (typeof options.onNavigate === 'function') {
      options.onNavigate(path);
    } else {
      window.location.hash = '#' + path;
    }
  }

  /** Предупреждение о заводском коде. */
  function renderAlert() {
    setContent(alertBox);
    if (!store.get().mustChangeCode) return;
    alertBox.appendChild(
      h('div.profile__alert',
        h('span.profile__alert-icon', { html: iconSvg('alert', 20) }),
        h('div',
          h('div.profile__alert-title', { text: 'Смените код доступа' }),
          h('div', { text: 'Вы вошли под заводским кодом 0000. Это небезопасно — задайте свой код в блоке ниже.' })
        )
      )
    );
  }

  /** Обновление блока состояния отправки. */
  function renderStatus() {
    const s = store.get();
    const count = Number(s.queueCount) || 0;

    setContent(statusRows,
      h('div.profile__status-row',
        h('span.profile__status-label', { text: 'Соединение' }),
        h('span.profile__status-value', { text: s.online ? 'есть' : 'нет' })
      ),
      h('div.profile__status-row',
        h('span.profile__status-label', { text: 'В очереди' }),
        h('span.profile__status-value', {
          text: count === 0 ? 'ничего' : count + ' ' + plural(count, ['запись', 'записи', 'записей'])
        })
      ),
      h('div.profile__status-row',
        h('span.profile__status-label', { text: 'Последняя отправка' }),
        h('span.profile__status-value', { text: s.lastSyncAt ? dateTimeRu(s.lastSyncAt) : 'ещё не было' })
      ),
      s.queueError
        ? h('div.profile__status-row',
          h('span.profile__status-label', { text: 'Ошибка' }),
          h('span.profile__status-value', { text: s.queueError })
        )
        : null
    );

    manualSendBtn.disabled = count === 0 && !s.queueError;
  }

  loadStyles('js/components/Profile/styles/Profile.css');
  renderAlert();
  renderStatus();
  const unsubscribe = store.subscribe(renderStatus);

  return {
    el: el,
    destroy: unsubscribe
  };
}
