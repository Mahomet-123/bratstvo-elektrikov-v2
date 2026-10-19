/**
 * ============================================================================
 * Компонент: CabinetPublic
 * Ответственность: кабинет клиента на сайте приложения — открывается по
 *                  короткой ссылке вида …/#/c/ТОКЕН, без входа в приложение.
 *                  Только просмотр: смета, часы по дням, закупки с фото.
 *
 *                  Токен в адресе и есть пропуск: он уникален для объекта,
 *                  и при закрытии доступа перестаёт работать.
 * Зависимости: core/dom, core/styles, core/icons, core/format, api/*
 * ============================================================================
 */

import { h, clear, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { money, hours, dateShort, countLabel } from '../../core/format.js';
import { describeError } from '../../api/apiClient.js';
import { api } from '../../api/endpoints.js';

/** Признак токена кабинета: буквы, цифры, дефис и подчёркивание. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * Адрес ведёт в кабинет клиента? Проверяем по началу адреса, а не по токену:
 * иначе битая ссылка (#/c/ или #/c/кириллица) выглядела бы как обычный вход
 * в приложение, и человек не понял бы, что ссылка не та.
 * @param {string=} hash
 * @return {boolean}
 */
export function isCabinetHash(hash) {
  const raw = String(hash === undefined ? window.location.hash : hash);
  return raw.indexOf('#/c/') === 0;
}

/**
 * Токен кабинета из адреса: #/c/ТОКЕН.
 * @param {string=} hash
 * @return {string}
 */
export function cabinetTokenFromHash(hash) {
  const raw = String(hash === undefined ? window.location.hash : hash);
  const match = raw.match(/^#\/c\/([^/?#]*)/);
  if (!match) return '';

  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    // Битая последовательность вида %E0 — считаем ссылку негодной.
    return match[1];
  }
}

/** Ссылка на миниатюру файла на Диске. */
function driveThumb(fileId) {
  return fileId
    ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1000'
    : '';
}

/**
 * Понятный клиенту текст вместо служебного ответа сервера.
 * «Объект не найден» клиенту ни о чём не говорит — ему важно, что делать.
 * @param {Error} error
 * @return {string}
 */
function closedReason(error) {
  const code = error && error.code;
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'VALIDATION') {
    return 'Ссылка закрыта или устарела. Попросите новую у бригады.';
  }
  if (error && error.offline) return 'Нет интернета. Проверьте связь и обновите страницу.';
  return describeError(error);
}

/**
 * Создание кабинета клиента.
 * @param {Object} props
 * @param {string} props.token
 * @return {Object} { el, destroy }
 */
export function createCabinetPublic(props) {
  const options = props || {};
  const token = options.token || '';

  const bodyBox = h('div.public-cabinet__body');

  const el = h('div.public-cabinet',
    h('div.public-cabinet__head',
      h('div.public-cabinet__brand', { text: 'Братство Электриков' }),
      h('div.public-cabinet__note', { text: 'Кабинет клиента' })
    ),
    bodyBox
  );

  /** Экран недоступной ссылки. */
  function renderClosed(message) {
    clear(bodyBox);
    bodyBox.appendChild(h('div.empty',
      h('div.empty__icon.public-cabinet__empty-icon', { html: iconSvg('lock', 26) }),
      h('div.empty__title', { text: 'Ссылка недоступна' }),
      h('div.empty__text', { text: message || 'Ссылка закрыта или устарела. Попросите новую у бригады.' })
    ));
  }

  /** Сводка по смете. */
  function renderTotals(estimate, totals) {
    const lines = [
      ['Работы (подытог)', money(estimate.subtotal || 0)],
      (estimate.supply || 0) > 0 ? ['Снабжение материалом', money(estimate.supply)] : null,
      (estimate.commissioning || 0) > 0 ? ['Пусконаладка', money(estimate.commissioning)] : null,
      (estimate.discount || 0) > 0 ? ['Скидка', '−' + money(estimate.discount)] : null
    ].filter(Boolean);

    return h('div.card.public-cabinet__card',
      h('div.card__body',
        h('div.public-cabinet__total',
          h('span.public-cabinet__total-label', { text: 'Итого по смете' }),
          h('span.public-cabinet__total-value', { text: money(estimate.total || 0) })
        ),
        h('div.public-cabinet__lines',
          lines.map((line) => h('div.public-cabinet__line',
            h('span', { text: line[0] }),
            h('span.public-cabinet__line-value', { text: line[1] })
          ))
        ),
        h('div.public-cabinet__meta', {
          text: [
            countLabel(totals.positions || 0, ['позиция', 'позиции', 'позиций']) + ' в смете',
            hours(totals.hours || 0) + ' работ',
            money(totals.purchases || 0) + ' материалов'
          ].join(' · ')
        })
      )
    );
  }

  /** Таблица сметы. */
  function renderEstimate(estimate) {
    const rows = estimate.rows || [];

    if (!rows.length) {
      return h('div.card.public-cabinet__card',
        h('div.card__body', h('div.empty__text', { text: 'Смета пока не составлена.' }))
      );
    }

    const table = h('table.public-cabinet__table',
      h('thead', h('tr',
        h('th', { text: 'Наименование' }),
        h('th.public-cabinet__num', { text: 'Кол-во' }),
        h('th.public-cabinet__num', { text: 'Сумма' })
      )),
      h('tbody', rows.map((row) => h('tr',
        h('td',
          h('div', { text: row.name || '—' }),
          h('div.public-cabinet__sub', {
            text: [row.unit, row.price ? money(row.price) + ' за ед.' : ''].filter(Boolean).join(' · ')
          })
        ),
        h('td.public-cabinet__num', { text: String(row.qty || 0) }),
        h('td.public-cabinet__num', { text: money(row.sum || 0) })
      )))
    );

    return h('div.card.public-cabinet__card',
      h('div.card__head', h('div.card__title', { text: 'Смета' })),
      h('div.public-cabinet__scroll', table)
    );
  }

  /** Журнал работ по дням. */
  function renderDays(days) {
    if (!days.length) return null;

    return h('div.card.public-cabinet__card',
      h('div.card__head', h('div.card__title', { text: 'Выполненные работы' })),
      h('div.rows',
        days.slice().reverse().map((day) => h('div.row',
          h('span.row__main',
            h('span.row__title', { text: day.work || 'Работа' }),
            h('span.row__sub', { text: dateShort(day.date) + ' · ' + day.executor })
          ),
          h('span.row__side',
            h('span.public-cabinet__hours', { text: hours(day.hours) })
          )
        ))
      )
    );
  }

  /** Закупки материалов с фото накладных. */
  function renderPurchases(purchases) {
    if (!purchases.length) return null;

    return h('div.card.public-cabinet__card',
      h('div.card__head', h('div.card__title', { text: 'Материалы' })),
      h('div.rows',
        purchases.slice().reverse().map((item) => {
          const photos = item.photos && item.photos.length
            ? item.photos
            : (item.photo ? [{ link: item.photo, id: item.photoId }] : []);

          const thumbs = photos
            .map((photo) => driveThumb(photo.id) || photo.link)
            .filter(Boolean);

          return h('div.row.public-cabinet__buy',
            h('span.row__main',
              h('span.row__title', { text: item.material || 'Материал' }),
              h('span.row__sub', {
                text: [dateShort(item.date), item.qty + ' ' + (item.unit || ''), money(item.price)]
                  .filter(Boolean).join(' · ')
              }),
              thumbs.length
                ? h('span.public-cabinet__thumbs',
                  thumbs.slice(0, 4).map((url) => h('a.public-cabinet__thumb', {
                    href: url,
                    target: '_blank',
                    rel: 'noopener'
                  }, h('img', { src: url, alt: 'Накладная', loading: 'lazy' })))
                )
                : null
            ),
            h('span.row__side',
              h('span.public-cabinet__sum', { text: money(item.sum || 0) })
            )
          );
        })
      )
    );
  }

  /** Полная отрисовка. */
  function render(data) {
    clear(bodyBox);

    const object = data.object || {};
    const estimate = data.estimate || {};
    const totals = data.totals || {};

    bodyBox.appendChild(h('div.public-cabinet__hero',
      h('div.public-cabinet__num', { text: 'Объект № ' + (object.numberLabel || '') }),
      h('div.public-cabinet__title', { text: object.title || 'Без названия' }),
      h('div.public-cabinet__address', {
        text: [object.client, object.address].filter(Boolean).join(' · ')
      })
    ));

    bodyBox.appendChild(renderTotals(estimate, totals));
    bodyBox.appendChild(renderEstimate(estimate));

    const days = renderDays(data.days || []);
    if (days) bodyBox.appendChild(days);

    const purchases = renderPurchases(data.purchases || []);
    if (purchases) bodyBox.appendChild(purchases);

    bodyBox.appendChild(h('div.public-cabinet__footer', {
      text: [data.validity || '', 'Сформировано ' + dateShort(data.generated)].filter(Boolean).join(' · ')
    }));
  }

  /** Загрузка данных кабинета. */
  async function load() {
    setContent(bodyBox,
      h('div.loading-block', h('div.spinner'), h('div', { text: 'Открываем кабинет…' }))
    );

    try {
      const data = await api.cabinetData(token);
      render(data);
    } catch (error) {
      renderClosed(closedReason(error));
    }
  }

  loadStyles('js/components/CabinetPublic/styles/CabinetPublic.css');

  // Кривой адрес не отправляем на сервер: токены состоят из латиницы,
  // цифр, дефиса и подчёркивания, всё остальное — заведомо мёртвая ссылка.
  if (!TOKEN_SHAPE.test(token)) {
    renderClosed('Ссылка неполная или искажена. Скопируйте её из сообщения бригады целиком.');
  } else {
    load();
  }

  return {
    el: el,
    destroy: () => {}
  };
}

export default createCabinetPublic;
