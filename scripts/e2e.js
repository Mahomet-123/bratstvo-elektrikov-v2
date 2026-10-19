#!/usr/bin/env node
/**
 * ============================================================================
 * Сквозная проверка бэкенда через реальный Web App.
 *
 * Прогоняет полный сценарий: вход → миграция схемы → создание объекта →
 * расчёт с коэффициентами, наценками и скидкой → журнал дней с проверкой
 * дублей → чтение карточки → закупки → загрузка фото накладной → кабинет
 * клиента → PDF-отчёт → аналитика → закрытие объекта в архив и возврат →
 * уведомления Telegram → уборка тестового объекта.
 *
 * Запуск: npm run e2e
 * ============================================================================
 */

const { callApi } = require('./api.js');

const results = [];
let leaderToken = '';
let masterToken = '';
let testObjectId = '';
let photoFileId = '';

/** Проверка утверждения с записью в отчёт. */
function check(title, condition, details) {
  results.push({ title, ok: Boolean(condition), details: details === undefined ? '' : details });
  console.log((condition ? '  ок    ' : '  СБОЙ  ') + title + (details ? ' — ' + details : ''));
  return Boolean(condition);
}

/** Сравнение чисел с допуском на копейки. */
function eq(actual, expected, title) {
  const a = Math.round(Number(actual) * 100) / 100;
  const e = Math.round(Number(expected) * 100) / 100;
  return check(title, a === e, 'получено ' + a + ', ожидалось ' + e);
}

/**
 * Безопасное чтение вложенного поля ответа.
 * Ответ может не содержать данных (например, при ошибке), и проверка
 * не должна падать раньше, чем покажет причину.
 * @param {Object} res
 * @param {string} path — путь через точку, например 'data.object.status'
 * @param {*} fallback
 * @return {*}
 */
function val(res, path, fallback) {
  let current = res;
  const parts = String(path).split('.');
  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) return fallback;
    current = current[parts[i]];
  }
  return current === undefined || current === null ? fallback : current;
}

async function main() {
  console.log('=== 1. Связь и служебное состояние ===');
  const health = await callApi('health');
  check('API отвечает', health.ok === true);
  check('таблица инициализирована', health.data && health.data.initialized === true,
    health.data ? health.data.users + ' профилей, ' + health.data.prices + ' позиций прайса' : '');

  console.log('\n=== 2. Вход ===');
  const login = await callApi('auth.login', { name: 'Руководитель', code: '0000' });
  check('вход руководителя', login.ok === true, login.ok ? '' : login.error);
  check('роль определена как руководитель', login.data && login.data.user.role === 'leader',
    login.data ? 'роль: ' + login.data.user.role + ', имя: ' + login.data.user.name : '');
  check('имя не пустое', login.data && login.data.user.name === 'Руководитель');
  leaderToken = login.ok ? login.data.token : '';

  const badLogin = await callApi('auth.login', { name: 'Руководитель', code: '9999' });
  check('неверный код отклонён', badLogin.ok === false && badLogin.code === 'AUTH');

  // Мастер для проверки прав.
  const users = await callApi('users.list', {}, leaderToken);
  const masters = val(users, 'data.masters', []);
  check('список бригады получен: 50 мастеров', masters.length === 50,
    masters.length ? masters.length + ' мастеров' : JSON.stringify(users).slice(0, 200));

  const firstMaster = masters[0] || null;
  if (firstMaster) {
    const masterLogin = await callApi('auth.login', { name: firstMaster.name, code: firstMaster.code });
    check('вход мастера', masterLogin.ok === true, firstMaster.name + ' / ' + firstMaster.code);
    masterToken = masterLogin.ok ? masterLogin.data.token : '';

    const forbidden = await callApi('users.list', {}, masterToken);
    check('мастеру закрыт раздел бригады', forbidden.ok === false && forbidden.code === 'FORBIDDEN');

    const forbiddenSetup = await callApi('setup.init', {}, masterToken);
    check('мастеру закрыта инициализация', forbiddenSetup.ok === false && forbiddenSetup.code === 'FORBIDDEN');

    // Пакет данных собирается теми же функциями, что и отдельные маршруты,
    // поэтому проверяем: мастеру в пакет не попадают чужие разделы.
    const masterBundle = await callApi('data.bundle', {}, masterToken);
    check('мастеру выдан пакет данных',
      masterBundle.ok === true && Array.isArray(val(masterBundle, 'data.objects', null)),
      masterBundle.ok ? 'объектов: ' + val(masterBundle, 'data.objects', []).length : masterBundle.error);
    check('в пакет мастера не попадают разделы руководителя',
      val(masterBundle, 'data.analytics', null) === null &&
      val(masterBundle, 'data.users', null) === null &&
      val(masterBundle, 'data.visits', null) === null &&
      val(masterBundle, 'data.archives', null) === null);
  }

  console.log('\n=== 2.1 Пакет данных разделов ===');
  const leaderBundle = await callApi('data.bundle', {}, leaderToken);
  check('пакет данных получен', leaderBundle.ok === true, leaderBundle.ok ? '' : leaderBundle.error);
  check('в пакете есть объекты', Array.isArray(val(leaderBundle, 'data.objects', null)));
  check('в пакете есть аналитика', val(leaderBundle, 'data.analytics', null) !== null);
  check('в пакете есть состав бригады', val(leaderBundle, 'data.users.total', 0) > 0,
    'человек: ' + val(leaderBundle, 'data.users.total', 0));
  check('в пакете есть состояние уведомлений', val(leaderBundle, 'data.bot', null) !== null);
  check('в пакете есть архив', val(leaderBundle, 'data.archives', null) !== null);
  check('в пакете есть журнал посещений', val(leaderBundle, 'data.visits.list.visits', null) !== null);
  check('в пакет не попал прайс (он хранится отдельно)',
    val(leaderBundle, 'data.prices', null) === null);

  console.log('\n=== 3. Миграция схемы таблицы ===');
  const init = await callApi('setup.init', {}, leaderToken);
  check('схема таблицы актуальна', init.ok === true, init.ok ? 'итог: ' + init.data.итог : init.error);

  console.log('\n=== 4. Прайс ===');
  const prices = await callApi('prices.list');
  check('прайс загружен', prices.ok === true, prices.ok ? '' : prices.error);
  check('204 позиции', val(prices, 'data.total', 0) === 204, 'позиций: ' + val(prices, 'data.total', '—'));
  check('8 разделов', (val(prices, 'data.sections', []) || []).length === 8,
    (val(prices, 'data.sections', []) || []).map((s) => s.name).join(' | '));
  check('есть раздел «Умный дом и IoT»',
    (val(prices, 'data.sections', []) || []).some((s) => s.name === 'Умный дом и IoT'));
  check('коэффициенты: 6', (val(prices, 'data.coefficients', []) || []).length === 6);
  const percents = val(prices, 'data.percents', []) || [];
  check('наценки: 10% и 30%', percents.length === 2 &&
    percents[0].value === 10 && percents[1].value === 30);

  console.log('\n=== 5. Создание объекта ===');
  const created = await callApi('objects.create', {
    title: 'ПРОВЕРКА ПРИЛОЖЕНИЯ',
    client: 'Тестовый клиент',
    address: 'г. Магас, ул. Проверочная, 1',
    phone: '+7 900 000-00-00'
  }, leaderToken);
  const createdSheet = val(created, 'data.object.sheet', '');
  check('объект создан', created.ok === true && !!createdSheet,
    createdSheet ? 'лист «' + createdSheet + '»' : (created.error || JSON.stringify(created).slice(0, 200)));
  if (!created.ok || !createdSheet) return finish();
  testObjectId = val(created, 'data.object.id', '');
  check('номер присвоен', /^\d{3}$/.test(val(created, 'data.object.numberLabel', '')),
    val(created, 'data.object.numberLabel', '—'));
  check('статус по умолчанию «расчёт»', val(created, 'data.object.status', '') === 'расчёт');

  // Телефон начинается с «+» — Google принимал его за формулу и записывал
  // #ERROR! прямо при создании объекта. Проверяем, что текст дошёл как есть.
  check('телефон с «+» сохраняется текстом',
    val(created, 'data.object.phone', '') === '+7 900 000-00-00',
    'получено: ' + val(created, 'data.object.phone', 'пусто'));

  console.log('\n=== 6. Расчёт ===');
  const calc = await callApi('calc.save', {
    id: testObjectId,
    payload: {
      rows: [
        { id: 'r1', section: 'Монтажные работы', position: 2, name: 'Распределительная коробка', unit: 'шт.', price: 700, qty: 10, coeff: 1 },
        { id: 'r2', section: 'Монтажные работы', position: 7, name: 'Затягивание кабеля в гофру', unit: 'м/п', price: 35, qty: 100, coeff: 1.5 }
      ],
      coefficient: 1,
      materialCost: 50000,
      equipmentCost: 10000,
      discount: 5,
      discountType: 'percent'
    }
  }, leaderToken);
  check('расчёт сохранён', calc.ok === true, calc.ok ? '' : calc.error);

  if (calc.ok) {
    const est = calc.data.estimate;
    eq(est.subtotal, 12250, 'подытог: 700×10 + 35×100×1,5');
    eq(est.supply, 5000, 'снабжение материалом: 10% от 50 000 ₽');
    eq(est.commissioning, 3000, 'пусконаладка: 30% от 10 000 ₽');
    eq(est.beforeDiscount, 20250, 'сумма до скидки');
    eq(est.discount, 1012.5, 'скидка 5%');
    eq(est.total, 19237.5, 'итог со скидкой');
  }

  // Проверка минимума снабжения.
  const calcMin = await callApi('calc.save', {
    id: testObjectId,
    payload: {
      rows: [{ id: 'r1', name: 'Розетка', unit: 'шт.', price: 280, qty: 1, coeff: 1 }],
      materialCost: 5000,
      equipmentCost: 0,
      discount: 0
    }
  }, leaderToken);
  check('снабжение не меньше 1500 ₽', calcMin.ok && calcMin.data.estimate.supply === 1500,
    calcMin.ok ? 'снабжение ' + calcMin.data.estimate.supply : calcMin.error);

  // Возвращаем полный расчёт.
  await callApi('calc.save', {
    id: testObjectId,
    payload: {
      rows: [
        { id: 'r1', section: 'Монтажные работы', position: 2, name: 'Распределительная коробка', unit: 'шт.', price: 700, qty: 10, coeff: 1 },
        { id: 'r2', section: 'Монтажные работы', position: 7, name: 'Затягивание кабеля в гофру', unit: 'м/п', price: 35, qty: 100, coeff: 1.5 }
      ],
      materialCost: 50000,
      equipmentCost: 10000,
      discount: 5,
      discountType: 'percent'
    }
  }, leaderToken);

  console.log('\n=== 7. Журнал дней ===');
  const day1 = await callApi('days.add', {
    id: testObjectId,
    day: { date: '2026-10-13', hours: 7.5, work: 'Разводка кабеля по первому этажу' }
  }, leaderToken);
  check('первая запись дня добавлена', day1.ok === true, day1.ok ? '' : day1.error);
  check('первая запись не помечена дублем', day1.ok && day1.data.duplicate === false);

  const day2 = await callApi('days.add', {
    id: testObjectId,
    day: { date: '2026-10-13', hours: 3, work: 'Дополнительные работы' }
  }, leaderToken);
  check('повтор за ту же дату сохранён', day2.ok === true);
  check('повтор помечен как дубль, но не заблокирован', day2.ok && day2.data.duplicate === true);

  const day3 = await callApi('days.add', {
    id: testObjectId,
    day: { date: '2026-10-12', hours: 4, work: 'Штробление' }
  }, leaderToken);
  check('запись за другую дату добавлена', day3.ok === true);

  const badDay = await callApi('days.add', {
    id: testObjectId,
    day: { date: '2026-10-13', hours: 0, work: '' }
  }, leaderToken);
  check('пустая запись отклонена', badDay.ok === false && badDay.code === 'VALIDATION');

  console.log('\n=== 8. Карточка объекта ===');
  const card = await callApi('objects.get', { id: testObjectId }, leaderToken);
  check('карточка получена', card.ok === true, card.ok ? '' : card.error);
  const cardDays = val(card, 'data.days', []) || [];
  check('записей дня: 3', cardDays.length === 3, String(cardDays.length));
  eq(val(card, 'data.object.totals.hours', 0), 14.5, 'часов всего: 7,5 + 3 + 4');
  eq(val(card, 'data.object.totals.estimate', 0), 19237.5, 'итог расчёта в карточке');
  check('в карточке есть отметка дубля', cardDays.some((d) => d.duplicate === true));

  console.log('\n=== 9. Записи за сегодня (руководитель) ===');
  const today = await callApi('days.today', { date: '2026-10-13' }, leaderToken);
  check('сводка по дню получена', today.ok === true, today.ok ? '' : today.error);
  eq(val(today, 'data.hours', 0), 10.5, 'часов за 13.10: 7,5 + 3');
  check('записи видны', (val(today, 'data.records', []) || []).length >= 2,
    (val(today, 'data.records', []) || []).length + ' записей');
  const todayForbidden = await callApi('days.today', {}, masterToken);
  check('мастеру закрыта сводка по дню', todayForbidden.ok === false && todayForbidden.code === 'FORBIDDEN');

  console.log('\n=== 10. Смена статуса ===');
  const toWork = await callApi('objects.setStatus', { id: testObjectId, status: 'в работе' }, leaderToken);
  check('статус «в работе» установлен', toWork.ok === true &&
    val(toWork, 'data.object.status', '') === 'в работе', toWork.ok ? '' : toWork.error);
  const sameStatus = await callApi('objects.setStatus', { id: testObjectId, status: 'в работе' }, leaderToken);
  check('повторный тот же статус отклонён', sameStatus.ok === false);

  const list = await callApi('objects.list', {}, leaderToken);
  check('объект виден в списке',
    (val(list, 'data.objects', []) || []).some((o) => o.id === testObjectId));

  console.log('\n=== 11. Закупки ===');
  const buy1 = await callApi('purchases.add', {
    id: testObjectId,
    purchase: {
      date: '2026-10-13',
      material: 'Кабель ВВГнг 3×2,5',
      qty: 100,
      unit: 'м',
      price: 95.5,
      comment: 'Накладная № 4412'
    }
  }, leaderToken);
  check('закупка добавлена', buy1.ok === true, buy1.ok ? '' : buy1.error);
  eq(val(buy1, 'data.purchase.sum', 0), 9550, 'сумма закупки: 100 × 95,50 ₽');

  const badBuy = await callApi('purchases.add', {
    id: testObjectId,
    purchase: { material: '', qty: 0, price: -1 }
  }, leaderToken);
  check('пустая закупка отклонена', badBuy.ok === false && badBuy.code === 'VALIDATION');

  const buy2 = await callApi('purchases.add', {
    id: testObjectId,
    purchase: { date: '2026-10-14', material: 'Гофра ПВХ 20 мм', qty: 50, unit: 'м', price: 18 }
  }, leaderToken);
  check('вторая закупка добавлена', buy2.ok === true, buy2.ok ? '' : buy2.error);

  // Несколько наименований и наценка — на отдельном объекте, чтобы не сбить
  // ожидания остальных проверок по этому объекту.
  const markupObject = await callApi('objects.create', {
    title: 'ПРОВЕРКА НАЦЕНКИ', client: 'Проверка', address: 'г. Магас'
  }, leaderToken);
  const markupId = val(markupObject, 'data.object.id', '');

  const batch = await callApi('purchases.addBatch', {
    id: markupId,
    items: [
      { purchase: { date: '2026-10-15', material: 'Подрозетник', qty: 4, unit: 'шт', price: 45 } },
      { purchase: { date: '2026-10-15', material: 'Клемма WAGO', qty: 10, unit: 'шт', price: 12 } }
    ],
    markup: true
  }, leaderToken);
  check('пакетная запись закупок', batch.ok === true && val(batch, 'data.purchases', []).length === 2,
    batch.ok ? 'записей: ' + val(batch, 'data.purchases', []).length : batch.error);

  // Наценка на материал: 10% от суммы закупок, но не меньше 1500 ₽.
  const marked = await callApi('purchases.list', { id: markupId }, leaderToken);
  const markupBase = val(marked, 'data.sum', 0);
  const markupSum = val(marked, 'data.markupSum', 0);
  check('наценка включилась вместе с записью', val(marked, 'data.markup', false) === true && markupSum > 0,
    'закуплено ' + markupBase + ', наценка ' + markupSum);
  check('наценка не меньше минимума', markupSum >= 1500, 'наценка ' + markupSum);
  eq(val(marked, 'data.withMarkup', 0), Math.round((markupBase + markupSum) * 100) / 100,
    'итог закупки с наценкой');

  const markupOff = await callApi('objects.setMarkup', { id: markupId, on: false }, leaderToken);
  check('наценка обнуляется',
    markupOff.ok === true && val(markupOff, 'data.object.totals.markupSum', -1) === 0,
    'наценка: ' + val(markupOff, 'data.object.totals.markupSum', 'нет данных'));

  const markupOn = await callApi('objects.setMarkup', { id: markupId, on: true }, leaderToken);
  check('наценка включается обратно',
    markupOn.ok === true && val(markupOn, 'data.object.totals.markupSum', 0) > 0);

  await callApi('objects.remove', { id: markupId }, leaderToken);

  const buyList = await callApi('purchases.list', { id: testObjectId }, leaderToken);
  check('список закупок получен: 2 позиции', val(buyList, 'data.total', -1) === 2,
    'позиций: ' + val(buyList, 'data.total', 'нет данных'));
  eq(val(buyList, 'data.sum', 0), 10450, 'сумма закупок: 9550 + 900');

  const cardAfterBuy = await callApi('objects.get', { id: testObjectId }, leaderToken);
  eq(val(cardAfterBuy, 'data.object.totals.purchases', 0), 10450, 'итог закупок в карточке объекта');
  eq(val(cardAfterBuy, 'data.object.totals.positions', 0), 2, 'позиций расчёта в реестре');

  console.log('\n=== 12. Фото накладной ===');
  // 1×1 пиксель PNG — минимально возможный корректный файл.
  const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const photo = await callApi('photos.upload', {
    id: testObjectId,
    name: 'Накладная № 4412',
    mime: 'image/png',
    data: 'data:image/png;base64,' + TINY_PNG
  }, leaderToken);
  check('фото загружено на Диск', photo.ok === true,
    photo.ok ? val(photo, 'data.name', '') + ' (' + val(photo, 'data.size', 0) + ' Б)' : photo.error);
  check('тип определён как PNG', val(photo, 'data.mime', '') === 'image/png',
    'получено ' + val(photo, 'data.mime', '—'));
  check('ссылка на файл получена', /^https:\/\/drive\.google\.com/.test(val(photo, 'data.url', '')));
  photoFileId = val(photo, 'data.fileId', '');

  const badPhoto = await callApi('photos.upload', { id: testObjectId, name: 'Пусто', data: '' }, leaderToken);
  check('пустое фото отклонено', badPhoto.ok === false && badPhoto.code === 'VALIDATION');

  if (photo.ok) {
    const buyWithPhoto = await callApi('purchases.add', {
      id: testObjectId,
      purchase: {
        date: '2026-10-14', material: 'Автомат 16А', qty: 4, unit: 'шт.', price: 320,
        comment: 'Фото накладной', photo: val(photo, 'data.url', ''), photoId: val(photo, 'data.fileId', '')
      }
    }, leaderToken);
    check('закупка с фото добавлена', buyWithPhoto.ok === true, buyWithPhoto.ok ? '' : buyWithPhoto.error);
    check('фото привязано к закупке',
      val(buyWithPhoto, 'data.purchase.photoId', '') === val(photo, 'data.fileId', ''));
  }

  console.log('\n=== 13. Кабинет клиента ===');
  const cabLink = await callApi('cabinet.link', { id: testObjectId }, leaderToken);
  const cabUrl = val(cabLink, 'data.url', '');
  const cabToken = val(cabLink, 'data.token', '');
  check('ссылка на кабинет выдана', /#\/c\/[A-Za-z0-9_-]+$/.test(cabUrl),
    cabUrl ? cabUrl.slice(0, 70) + '…' : cabLink.error);
  check('ссылка ведёт на сайт, а не на скрипт',
    cabUrl.indexOf('script.google.com') === -1 && cabUrl.indexOf('#/c/') !== -1, cabUrl.slice(0, 70));
  check('ссылка короткая', cabUrl.length <= 80, cabUrl.length + ' знаков');

  // Отдельный маршрут чтения нужен экрану управления: он не должен попадать
  // в журнал посещений как «открыл кабинет клиента».
  const cabGet = await callApi('cabinet.get', { id: testObjectId }, leaderToken);
  check('состояние кабинета читается отдельно от выдачи ссылки',
    cabGet.ok === true && val(cabGet, 'data.enabled', false) === true &&
    val(cabGet, 'data.url', '') === cabUrl,
    cabGet.ok ? '' : cabGet.error);

  if (cabToken) {
    // Сайт отдаёт кабинет из браузера, поэтому содержимое проверяем по данным
    // маршрута — он и есть источник экрана.
    const cabData = await callApi('cabinet.data', { token: cabToken });
    check('данные кабинета отдаются без входа', cabData.ok === true,
      cabData.ok ? '' : cabData.error);
    check('в кабинете есть название объекта',
      val(cabData, 'data.object.title', '') === 'ПРОВЕРКА ПРИЛОЖЕНИЯ',
      val(cabData, 'data.object.title', 'нет названия'));
    check('в кабинете телефон клиента без искажений',
      val(cabData, 'data.object.phone', '') === '+7 900 000-00-00',
      val(cabData, 'data.object.phone', 'пусто'));
    check('в кабинете виден расчёт',
      Array.isArray(val(cabData, 'data.estimate.rows', [])) &&
      val(cabData, 'data.estimate.rows', []).length > 0);
    check('в кабинете видны дни работы', val(cabData, 'data.days', []).length > 0);
    check('в кабинете видны закупки', val(cabData, 'data.purchases', []).length > 0);
    check('в кабинете видна закупка по названию',
      JSON.stringify(val(cabData, 'data.purchases', [])).indexOf('Кабель ВВГнг') !== -1);
    check('в кабинете видна накладная с фото',
      !!photoFileId && JSON.stringify(cabData.data || {}).indexOf(photoFileId) !== -1,
      photoFileId ? '' : 'фото не загружалось');
    check('в кабинете указан срок действия', Boolean(val(cabData, 'data.validity', '')),
      val(cabData, 'data.validity', ''));

    // Чужой токен не должен открывать кабинет.
    const wrong = await callApi('cabinet.data', { token: 'ZZZZZZZZZZ' });
    check('неверный токен не открывает кабинет',
      wrong.ok === false && /не найден/i.test(String(wrong.error || '')),
      wrong.ok ? 'данные отдались' : String(wrong.error || '').slice(0, 60));
  }

  const cabRevoke = await callApi('cabinet.revoke', { id: testObjectId }, leaderToken);
  check('кабинет закрыт', cabRevoke.ok === true && val(cabRevoke, 'data.enabled', true) === false,
    cabRevoke.ok ? '' : cabRevoke.error);
  if (cabToken) {
    const dead = await callApi('cabinet.data', { token: cabToken });
    check('после закрытия старая ссылка мертва',
      dead.ok === false && /закрыт|не найден/i.test(String(dead.error || '')),
      dead.ok ? 'данные отдались' : String(dead.error || '').slice(0, 60));
  }
  await callApi('cabinet.link', { id: testObjectId }, leaderToken);

  console.log('\n=== 14. Отчёты ===');
  // Наценка — свойство объекта, поэтому включаем её на проверяемом объекте:
  // иначе проверять «попала ли наценка в отчёт» не на чем.
  const reportMarkupOn = await callApi('objects.setMarkup', { id: testObjectId, on: true }, leaderToken);
  check('наценка включена для проверки отчёта', reportMarkupOn.ok === true,
    reportMarkupOn.ok ? '' : reportMarkupOn.error);

  const repLink = await callApi('report.link', { id: testObjectId }, leaderToken);
  const repUrl = val(repLink, 'data.url', '');
  const repToken = val(repLink, 'data.token', '');
  check('ссылка на отчёт получена', /#\/r\/[A-Za-z0-9_-]+$/.test(repUrl),
    repUrl ? repUrl.slice(0, 70) + '…' : repLink.error);
  check('ссылка на отчёт ведёт на сайт',
    repUrl.indexOf('script.google.com') === -1 && repUrl.indexOf('#/r/') !== -1);

  if (repToken) {
    const repData = await callApi('report.data', { token: repToken });
    check('данные отчёта отдаются без входа', repData.ok === true,
      repData.ok ? '' : repData.error);
    check('в отчёте есть итог по смете', typeof val(repData, 'data.totals.estimate', null) === 'number',
      'смета: ' + val(repData, 'data.totals.estimate', 0) + ' ₽');
    check('в отчёте есть итог за материалы', val(repData, 'data.totals.materials', 0) > 0,
      'материалы: ' + val(repData, 'data.totals.materials', 0) + ' ₽');
    check('наценка на материал попала в итог', val(repData, 'data.totals.markup', 0) > 0,
      'наценка: ' + val(repData, 'data.totals.markup', 0) + ' ₽');
    check('материалы в отчёте = закупки + наценка',
      Math.abs(val(repData, 'data.totals.materials', 0) -
        (val(repData, 'data.totals.purchases', 0) + val(repData, 'data.totals.markup', 0))) < 0.01,
      'материалы: ' + val(repData, 'data.totals.materials', 0) + ' ₽');
    check('всего к оплате = смета + материалы',
      Math.abs(val(repData, 'data.totals.grand', 0) -
        (val(repData, 'data.totals.estimate', 0) + val(repData, 'data.totals.materials', 0))) < 0.01,
      'всего: ' + val(repData, 'data.totals.grand', 0) + ' ₽');

    const repWrong = await callApi('report.data', { token: 'ZZZZZZZZZZ' });
    check('чужой токен отчёт не открывает', repWrong.ok === false,
      repWrong.ok ? 'данные отдались' : String(repWrong.error || '').slice(0, 60));
  }

  const repPdf = await callApi('report.pdf', { id: testObjectId }, leaderToken);
  check('PDF-отчёт собран', repPdf.ok === true && val(repPdf, 'data.size', 0) > 0,
    repPdf.ok ? val(repPdf, 'data.name', '') + ' (' + Math.round(val(repPdf, 'data.size', 0) / 1024) + ' КБ)' : repPdf.error);

  const pdfBase64 = String(val(repPdf, 'data.base64', ''));
  check('PDF приходит файлом, а не ссылкой', pdfBase64.length > 1000,
    pdfBase64 ? Math.round(pdfBase64.length / 1024) + ' КБ в ответе' : 'содержимого нет');
  check('в ответе действительно PDF',
    Buffer.from(pdfBase64.slice(0, 8), 'base64').toString() === '%PDF-1',
    Buffer.from(pdfBase64.slice(0, 8), 'base64').toString());
  check('копия файла на Диске тоже есть',
    /^https:\/\/drive\.google\.com/.test(val(repPdf, 'data.url', '')));

  const repBad = await callApi('report.send', { id: testObjectId, contact: 'не-почта' }, leaderToken);
  check('отправка без почты отклонена', repBad.ok === false && repBad.code === 'VALIDATION');

  console.log('\n=== 15. Аналитика (руководитель) ===');
  const summary = await callApi('analytics.summary', {}, leaderToken);
  check('сводка по объектам получена', summary.ok === true, summary.ok ? '' : summary.error);
  check('тестовый объект попал в сводку',
    (val(summary, 'data.objects', []) || []).some((o) => o.id === testObjectId));
  check('итоги посчитаны', val(summary, 'data.totals.objects', 0) >= 1,
    'объектов: ' + val(summary, 'data.totals.objects', 0) +
    ', смета: ' + val(summary, 'data.totals.estimate', 0) + ' ₽');

  const daysStat = await callApi('analytics.days', { from: '2026-10-01', to: '2026-10-31' }, leaderToken);
  check('сводка по дням получена', daysStat.ok === true, daysStat.ok ? '' : daysStat.error);
  check('в сводке есть 13.10',
    (val(daysStat, 'data.days', []) || []).some((d) => d.date === '2026-10-13'),
    'дней в сводке: ' + (val(daysStat, 'data.days', []) || []).length);
  check('исполнители посчитаны', (val(daysStat, 'data.byExecutor', []) || []).length >= 1);

  const summaryForbidden = await callApi('analytics.summary', {}, masterToken);
  check('мастеру закрыта аналитика', summaryForbidden.ok === false && summaryForbidden.code === 'FORBIDDEN');

  console.log('\n=== 16. Закрытие объекта и архив ===');
  const closed = await callApi('objects.close', { id: testObjectId }, leaderToken);
  const archiveName = val(closed, 'data.archive.name', '');
  check('объект закрыт и убран в архив', closed.ok === true && !!archiveName,
    archiveName || closed.error || 'архив не указан');
  check('лист перенесён в «Архив 2026»', archiveName === 'Архив 2026', archiveName || '—');

  const cardArchived = await callApi('objects.get', { id: testObjectId }, leaderToken);
  check('закрытый объект читается из архива', cardArchived.ok === true,
    cardArchived.ok ? 'часов: ' + val(cardArchived, 'data.object.totals.hours', 0) : cardArchived.error);
  eq(val(cardArchived, 'data.object.totals.hours', 0), 14.5, 'часы читаются из архивного листа');
  check('закупки читаются из архива', (val(cardArchived, 'data.purchases', []) || []).length === 3,
    'закупок: ' + (val(cardArchived, 'data.purchases', []) || []).length);
  check('расчёт читается из архива', (val(cardArchived, 'data.estimate.rows', []) || []).length === 2);

  const archives = await callApi('archive.list', {}, leaderToken);
  check('список архивов получен', archives.ok === true, archives.ok ? '' : archives.error);
  const yearArchive = (val(archives, 'data.archives', []) || []).filter((a) => a.name === 'Архив 2026')[0];
  check('архив «Архив 2026» найден', !!yearArchive);
  check('в архиве числится наш объект',
    !!yearArchive && (yearArchive.objects || []).some((o) => o.id === testObjectId));
  // Имя листа в архиве берём из карточки: Google может добавить «(копия)»,
  // и приложение обязано записать фактическое имя, а не исходное.
  check('лист объекта лежит в архиве',
    !!yearArchive && (yearArchive.sheets || []).indexOf(val(cardArchived, 'data.object.sheet', '')) !== -1,
    yearArchive ? 'листы: ' + (yearArchive.sheets || []).join(', ') : '');

  const archivesForbidden = await callApi('archive.list', {}, masterToken);
  check('мастеру закрыт список архивов', archivesForbidden.ok === false && archivesForbidden.code === 'FORBIDDEN');

  const restored = await callApi('objects.restore', { id: testObjectId }, leaderToken);
  check('объект возвращён в работу', restored.ok === true &&
    val(restored, 'data.object.status', '') === 'в работе',
    restored.ok ? val(restored, 'data.message', '') : restored.error);

  const cardRestored = await callApi('objects.get', { id: testObjectId }, leaderToken);
  check('после возврата объект снова читается',
    cardRestored.ok === true && (val(cardRestored, 'data.days', []) || []).length === 3,
    cardRestored.ok ? 'дней: ' + (val(cardRestored, 'data.days', []) || []).length : cardRestored.error);

  console.log('\n=== 17. Уведомления в Telegram ===');
  const botState = await callApi('bot.status', {}, leaderToken);
  check('состояние уведомлений получено', botState.ok === true, botState.ok ? '' : botState.error);
  check('бот ещё не настроен', val(botState, 'data.configured', true) === false);
  check('час напоминания из настроек', val(botState, 'data.reminderHour', 0) === 20,
    String(val(botState, 'data.reminderHour', '—')));

  const botBad = await callApi('bot.saveToken', { botToken: 'заведомо-неверный-ключ' }, leaderToken);
  check('неверный ключ бота отклонён', botBad.ok === false && botBad.code === 'VALIDATION');

  const botEmpty = await callApi('bot.saveToken', {}, leaderToken);
  check('пустые настройки бота отклонены', botEmpty.ok === false && botEmpty.code === 'VALIDATION');

  const botTest = await callApi('bot.test', {}, leaderToken);
  check('проверка отправки отвечает без падения', botTest.ok === true && val(botTest, 'data.ok', true) === false,
    botTest.ok ? val(botTest, 'data.description', '') : botTest.error);

  const botForbidden = await callApi('bot.status', {}, masterToken);
  check('мастеру закрыты настройки уведомлений', botForbidden.ok === false && botForbidden.code === 'FORBIDDEN');

  console.log('\n=== 18. Уборка тестового объекта ===');
  await callApi('objects.setStatus', { id: testObjectId, status: 'расчёт' }, leaderToken);
  const removed = await callApi('objects.remove', { id: testObjectId }, leaderToken);
  check('тестовый объект убран', removed.ok === true,
    removed.ok ? val(removed, 'data.message', '') : removed.error);
  if (removed.ok) testObjectId = '';

  // Уборка архива: тестовые листы в нём больше никому не нужны.
  const archAfter = await callApi('archive.list', {}, leaderToken);
  const yearAfter = (val(archAfter, 'data.archives', []) || []).filter((a) => a.name === 'Архив 2026')[0];
  if (yearAfter) {
    const cleaned = await callApi('archive.cleanup', { archiveId: yearAfter.id }, leaderToken);
    check('уборка архива убирает лишние листы', cleaned.ok === true,
      cleaned.ok ? val(cleaned, 'data.message', '') : cleaned.error);

    const archFinal = await callApi('archive.list', {}, leaderToken);
    const yearFinal = (val(archFinal, 'data.archives', []) || []).filter((a) => a.name === 'Архив 2026')[0];
    check('в архиве не осталось мусорных листов',
      !!yearFinal && (yearFinal.sheets || []).every((s) => s.indexOf('копия') === -1),
      yearFinal ? 'листы: ' + (yearFinal.sheets || []).join(', ') : 'архив не найден');
  }
  const cleanupForbidden = await callApi('archive.cleanup', {}, masterToken);
  check('мастеру закрыта уборка архива', cleanupForbidden.ok === false && cleanupForbidden.code === 'FORBIDDEN');

  finish();
}

/** Итог прогона. */
function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log('Проверок: ' + results.length + ', успешно: ' + (results.length - failed.length) + ', сбоев: ' + failed.length);
  if (failed.length) {
    console.log('\nНе прошли:');
    failed.forEach((r) => console.log('  - ' + r.title + (r.details ? ' (' + r.details + ')' : '')));
    process.exit(1);
  }
  console.log('Все проверки пройдены.');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nПрогон прерван:', error.message);
  if (testObjectId) {
    console.error('Тестовый объект остался в таблице: ' + testObjectId);
  }
  process.exit(1);
});
