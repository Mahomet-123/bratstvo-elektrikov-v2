/**
 * ============================================================================
 * Компонент: Brigade
 * Ответственность: раздел руководителя — состав бригады (коды входа,
 *                  включение и выключение мастеров) и настройка уведомлений
 *                  в Telegram: ключ бота, адрес чата, ежедневное напоминание.
 * Зависимости: core/dom, core/styles, core/toast, core/modal, core/format,
 *              api/*
 * ============================================================================
 */

import { h, clear } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import bundle from '../../core/bundle.js';
import { toastSuccess, toastError, toastWarning } from '../../core/toast.js';
import { confirmDialog, openModal } from '../../core/modal.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';
import { initials, countLabel } from '../../core/format.js';

/**
 * Создание экрана бригады.
 * @param {Object} props
 * @param {Function=} props.onNavigate
 * @param {Function=} props.onTitle
 * @return {Object} { el, refresh, destroy }
 */
export function createBrigade(props) {
  const options = props || {};

  let users = null;
  let bot = null;
  let loading = true;
  let busy = '';

  const bodyBox = h('div.brigade__body');
  const el = h('div.page.brigade', bodyBox);

  /* --------------------------------------------------------------------------
   * Отрисовка
   * ------------------------------------------------------------------------ */

  /** Полная перерисовка. */
  function render() {
    clear(bodyBox);

    if (loading && !users) {
      bodyBox.appendChild(h('div.loading-block', h('div.spinner'), h('div', { text: 'Загружаем состав…' })));
      return;
    }

    bodyBox.appendChild(renderMasters());
    bodyBox.appendChild(renderLeader());
    bodyBox.appendChild(renderTools());
    bodyBox.appendChild(renderTelegram());
  }

  /** Разделы руководителя, которых нет в нижнем меню. */
  function renderTools() {
    return h('div.brigade__section',
      h('div.page__section-title', { text: 'Разделы' }),
      h('div.card',
        toolRow('archive', 'Архив по годам', 'Закрытые объекты и уборка лишних листов', '/archive'),
        toolRow('eye', 'Журнал посещений', 'Кто и когда заходил в приложение', '/visits')
      )
    );
  }

  /** Строка перехода к разделу. */
  function toolRow(iconName, title, subtitle, path) {
    return h('button.row.row--tap', {
      type: 'button',
      onclick: () => navigate(path)
    },
      h('span.brigade__tool-icon', { html: iconSvg(iconName, 20) }),
      h('span.row__main',
        h('span.row__title', { text: title }),
        h('span.row__sub', { text: subtitle })
      ),
      h('span.row__side', { html: iconSvg('back', 20, 'brigade__chevron') })
    );
  }

  /** Состав: мастера. */
  function renderMasters() {
    const masters = (users && users.masters) || [];

    return h('div.brigade__section',
      h('div.page__section-title', {
        text: 'Мастера' + (masters.length ? ' · ' + masters.length : '')
      }),
      masters.length
        ? h('div.rows.brigade__rows', masters.map((user) => renderUser(user, false)))
        : h('div.empty',
          h('div.empty__icon.brigade__empty-icon', { html: iconSvg('team', 26) }),
          h('div.empty__title', { text: 'Мастеров пока нет' }),
          h('div.empty__text', { text: 'Состав бригады ведётся в таблице на Google Диске — добавьте людей туда.' })
        )
    );
  }

  /** Состав: руководитель. */
  function renderLeader() {
    const leaders = (users && users.leader) || [];
    if (!leaders.length) return null;

    return h('div.brigade__section',
      h('div.page__section-title', { text: 'Руководитель' }),
      h('div.rows.brigade__rows', leaders.map((user) => renderUser(user, true)))
    );
  }

  /** Строка человека. */
  function renderUser(user, isLeader) {
    const meta = [
      user.active ? 'доступ открыт' : 'доступ закрыт',
      user.code ? 'код ' + user.code : 'код не задан'
    ].join(' · ');

    return h('div.row.brigade__user',
      h('span.brigade__avatar', { text: initials(user.name) }),
      h('span.row__main',
        h('span.row__title', { text: user.name }),
        h('span.row__sub', { text: meta }),
        user.needsCodeChange
          ? h('span.brigade__flag', { text: 'заводской код 0000 — нужно сменить' })
          : null
      ),
      h('span.row__side.brigade__side',
        h('button.btn.btn--quiet.btn--sm', {
          type: 'button',
          onclick: () => setCode(user)
        }, 'Код'),
        isLeader
          ? null
          : h('button.btn.btn--quiet.btn--sm', {
            type: 'button',
            onclick: () => toggleActive(user)
          }, user.active ? 'Выключить' : 'Включить')
      )
    );
  }

  /** Настройки уведомлений. */
  function renderTelegram() {
    if (!bot) {
      return h('div.brigade__section',
        h('div.page__section-title', { text: 'Уведомления' }),
        h('div.card.card--flat',
          h('div.card__body',
            h('div.brigade__hint', { text: 'Настройки уведомлений недоступны — проверьте связь.' }),
            h('button.btn.btn--ghost.btn--block', {
              type: 'button',
              onclick: loadBot
            }, 'Повторить')
          )
        )
      );
    }

    const stateText = bot.configured
      ? 'Бот подключён, напоминание в ' + bot.reminderHour + ':00'
      : 'Бот не настроен';

    return h('div.brigade__section',
      h('div.page__section-title', { text: 'Уведомления в Telegram' }),
      h('div.card.brigade__bot',
        h('div.card__head',
          h('div.card__title', { text: 'Вечернее напоминание' }),
          h('span.badge', {
            class: bot.configured ? 'badge--success' : 'badge--muted',
            text: bot.configured ? 'подключено' : 'выключено'
          })
        ),
        h('div.card__body',
          h('div.brigade__bot-state', { text: stateText }),
          h('div.brigade__bot-hint', {
            text: 'Каждый вечер бот пишет в чат бригады: сколько часов записано за день и кто ещё не отчитался.'
          }),
          h('div.brigade__bot-actions',
            h('button.btn.btn--ghost.btn--block', {
              type: 'button',
              onclick: () => editBot()
            }, bot.hasToken ? 'Изменить ключ и чат' : 'Подключить бота'),
            bot.configured
              ? h('button.btn.btn--ghost.btn--block', {
                type: 'button',
                disabled: busy === 'test',
                onclick: () => testBot()
              }, busy === 'test' ? 'Отправляем…' : 'Проверить сообщением')
              : null,
            bot.configured
              ? h('button.btn.btn--ghost.btn--block', {
                type: 'button',
                disabled: busy === 'remind',
                onclick: () => remindNow()
              }, busy === 'remind' ? 'Собираем…' : 'Напомнить сейчас')
              : null,
            bot.configured && !bot.triggerInstalled
              ? h('button.btn.btn--primary.btn--block', {
                type: 'button',
                onclick: () => installTrigger()
              }, 'Включить ежедневное напоминание')
              : null,
            bot.triggerInstalled
              ? h('button.btn.btn--quiet.btn--block', {
                type: 'button',
                onclick: () => removeTrigger()
              }, 'Выключить ежедневное напоминание')
              : null
          ),
          h('div.brigade__bot-meta', {
            text: 'Часовой пояс таблицы: ' + (bot.timezone || '—') +
              ' · чат: ' + (bot.chat || 'не задан')
          })
        )
      )
    );
  }

  /* --------------------------------------------------------------------------
   * Действия
   * ------------------------------------------------------------------------ */

  /** Заголовок экрана с числом людей. */
  function applyTitle() {
    if (typeof options.onTitle === 'function') {
      options.onTitle('Бригада', countLabel((users && users.total) || 0, ['человек', 'человека', 'человек']));
    }
  }

  /**
   * Загрузка состава бригады.
   * Состав уже лежит в пакете данных — экран открывается мгновенно,
   * отдельный запрос не нужен.
   */
  async function loadUsers() {
    const packed = bundle.get();
    if (packed && packed.users) {
      users = packed.users;
      loading = false;
      applyTitle();
      render();
    }

    const hadData = Boolean(users);
    loading = !hadData;
    if (!hadData) render();

    try {
      const fresh = await bundle.ensure();
      users = (fresh && fresh.users) || users || { leader: [], masters: [], total: 0 };
      loading = false;
      applyTitle();
      render();
    } catch (error) {
      loading = false;
      if (!users) users = { leader: [], masters: [], total: 0 };
      render();
      // Состав уже показан — обновление не удалось молча.
      if (!hadData) toastError(describeError(error));
    }
  }

  /** Загрузка состояния уведомлений. */
  async function loadBot() {
    const packed = bundle.get();
    if (packed && packed.bot) bot = packed.bot;

    try {
      const fresh = await bundle.ensure();
      if (fresh && fresh.bot) bot = fresh.bot;
    } catch (error) {
      // Настройки уведомлений не критичны — показываем то, что есть.
    }
    render();
  }

  /** Смена кода входа мастеру. */
  async function setCode(user) {
    // Поле держим в переменной: после закрытия окна узел уже вне документа,
    // но значение из него читается — искать по селектору нельзя.
    const input = h('input.input', {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: 'например 4821',
      value: user.code || ''
    });

    const field = h('label.field',
      h('span.field__label', { text: 'Новый код' }),
      input,
      h('span.field__hint', { text: 'Не короче четырёх знаков. Пустое поле — код сгенерируется.' })
    );

    const action = await openModal({
      title: 'Код входа',
      text: 'Код для «' + user.name + '». Оставьте поле пустым — приложение придумает код само.',
      body: field,
      actions: [
        { label: 'Отмена', variant: 'ghost', value: null },
        { label: 'Сохранить', variant: 'primary', value: '__save__' }
      ]
    });
    if (action !== '__save__') return;

    const code = String(input.value || '').trim();

    try {
      const result = await api.userSetCode(user.id, code);
      toastSuccess(result.code ? 'Код сохранён: ' + result.code : 'Код обновлён');
      await loadUsers();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Включение и выключение мастера. */
  async function toggleActive(user) {
    const next = !user.active;
    if (!next) {
      const confirmed = await confirmDialog({
        title: 'Закрыть доступ?',
        text: '«' + user.name + '» больше не сможет войти в приложение. Записи и объекты сохранятся.',
        confirmText: 'Закрыть доступ',
        danger: true
      });
      if (!confirmed) return;
    }

    try {
      await api.userSetActive(user.id, next);
      toastSuccess(next ? 'Доступ открыт: ' + user.name : 'Доступ закрыт: ' + user.name);
      await loadUsers();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Ввод ключа бота и адреса чата. */
  async function editBot() {
    const tokenInput = h('input.input', {
      type: 'text',
      autocomplete: 'off',
      placeholder: '123456789:AA...'
    });
    const chatInput = h('input.input', {
      type: 'text',
      autocomplete: 'off',
      placeholder: '-1001234567890'
    });

    const body = h('div.brigade__form',
      h('label.field',
        h('span.field__label', { text: 'Ключ бота' }),
        tokenInput,
        h('span.field__hint', { text: 'Получите у @BotFather в Telegram. Ключ хранится в настройках таблицы.' })
      ),
      h('label.field',
        h('span.field__label', { text: 'Адрес чата' }),
        chatInput,
        h('span.field__hint', { text: 'Идентификатор чата бригады. Например -1001234567890.' })
      )
    );

    const action = await openModal({
      title: 'Подключение бота',
      text: 'Укажите ключ бота и адрес чата — приложение проверит ключ и сохранит настройки.',
      body: body,
      actions: [
        { label: 'Отмена', variant: 'ghost', value: null },
        { label: 'Сохранить', variant: 'primary', value: '__save__' }
      ]
    });
    if (action !== '__save__') return;

    const botToken = String(tokenInput.value || '').trim();
    const chatId = String(chatInput.value || '').trim();
    if (!botToken && !chatId) {
      toastWarning('Ничего не изменилось');
      return;
    }

    try {
      const result = await api.botSaveToken(botToken, chatId);
      bot = result.status || bot;
      toastSuccess(result.bot && result.bot.username
        ? 'Бот подключён: @' + result.bot.username
        : 'Настройки сохранены');
      render();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Проверка связи с Telegram. */
  async function testBot() {
    busy = 'test';
    render();
    try {
      const result = await api.botTest();
      if (result.ok) toastSuccess(result.description || 'Сообщение отправлено');
      else toastError(result.description || 'Не удалось отправить сообщение');
    } catch (error) {
      toastError(describeError(error));
    } finally {
      busy = '';
      render();
    }
  }

  /** Напоминание прямо сейчас. */
  async function remindNow() {
    busy = 'remind';
    render();
    try {
      const result = await api.botRemind();
      if (result.ok) toastSuccess('Напоминание отправлено в чат');
      else toastError('Не удалось отправить: ' + (result.description || result.reason || 'проверьте настройки'));
    } catch (error) {
      toastError(describeError(error));
    } finally {
      busy = '';
      render();
    }
  }

  /** Ежедневный триггер. */
  async function installTrigger() {
    try {
      const result = await api.botInstall();
      toastSuccess('Ежедневное напоминание включено на ' + result.hour + ':00');
      await loadBot();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Снятие ежедневного триггера. */
  async function removeTrigger() {
    const confirmed = await confirmDialog({
      title: 'Выключить напоминание?',
      text: 'Бот перестанет писать в чат по вечерам. Отправлять напоминание вручную можно будет по-прежнему.',
      confirmText: 'Выключить'
    });
    if (!confirmed) return;

    try {
      await api.botRemove();
      toastSuccess('Ежедневное напоминание выключено');
      await loadBot();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /** Переход на другой экран. */
  function navigate(path) {
    if (typeof options.onNavigate === 'function') options.onNavigate(path);
    else window.location.hash = '#' + path;
  }

  loadStyles('js/components/Brigade/styles/Brigade.css');

  render();
  loadUsers();
  loadBot();

  return {
    el: el,
    refresh: () => {
      loadUsers();
      loadBot();
    },
    destroy: () => {}
  };
}

export default createBrigade;
