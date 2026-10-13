#!/usr/bin/env node
/**
 * ============================================================================
 * Сквозная проверка бэкенда через реальный Web App.
 *
 * Прогоняет полный сценарий: вход → миграция схемы → создание объекта →
 * расчёт с коэффициентами, наценками и скидкой → журнал дней с проверкой
 * дублей → чтение карточки → смена статуса → уборка тестового объекта.
 *
 * Запуск: npm run e2e
 * ============================================================================
 */

const { callApi } = require('./api.js');

const results = [];
let leaderToken = '';
let masterToken = '';
let testObjectId = '';

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
  check('список бригады получен', users.ok === true && users.data.masters.length === 50,
    users.ok ? users.data.masters.length + ' мастеров' : users.error);

  const firstMaster = users.ok ? users.data.masters[0] : null;
  if (firstMaster) {
    const masterLogin = await callApi('auth.login', { name: firstMaster.name, code: firstMaster.code });
    check('вход мастера', masterLogin.ok === true, firstMaster.name + ' / ' + firstMaster.code);
    masterToken = masterLogin.ok ? masterLogin.data.token : '';

    const forbidden = await callApi('users.list', {}, masterToken);
    check('мастеру закрыт раздел бригады', forbidden.ok === false && forbidden.code === 'FORBIDDEN');

    const forbiddenSetup = await callApi('setup.init', {}, masterToken);
    check('мастеру закрыта инициализация', forbiddenSetup.ok === false && forbiddenSetup.code === 'FORBIDDEN');
  }

  console.log('\n=== 3. Миграция схемы таблицы ===');
  const init = await callApi('setup.init', {}, leaderToken);
  check('схема таблицы актуальна', init.ok === true, init.ok ? 'итог: ' + init.data.итог : init.error);

  console.log('\n=== 4. Прайс ===');
  const prices = await callApi('prices.list');
  check('прайс загружен', prices.ok === true);
  check('204 позиции', prices.ok && prices.data.total === 204, prices.ok ? String(prices.data.total) : '');
  check('8 разделов', prices.ok && prices.data.sections.length === 8,
    prices.ok ? prices.data.sections.map((s) => s.name).join(' | ') : '');
  check('есть раздел «Умный дом и IoT»', prices.ok &&
    prices.data.sections.some((s) => s.name === 'Умный дом и IoT'));
  check('коэффициенты: 6', prices.ok && prices.data.coefficients.length === 6);
  check('наценки: 10% и 30%', prices.ok && prices.data.percents.length === 2 &&
    prices.data.percents[0].value === 10 && prices.data.percents[1].value === 30);

  console.log('\n=== 5. Создание объекта ===');
  const created = await callApi('objects.create', {
    title: 'ПРОВЕРКА ПРИЛОЖЕНИЯ',
    client: 'Тестовый клиент',
    address: 'г. Магас, ул. Проверочная, 1',
    phone: '+7 900 000-00-00'
  }, leaderToken);
  check('объект создан', created.ok === true, created.ok ? 'лист «' + created.data.object.sheet + '»' : created.error);
  if (!created.ok) return finish();
  testObjectId = created.data.object.id;
  check('номер присвоен', /^\d{3}$/.test(created.data.object.numberLabel), created.data.object.numberLabel);
  check('статус по умолчанию «расчёт»', created.data.object.status === 'расчёт');

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
  if (card.ok) {
    check('записей дня: 3', card.data.days.length === 3, String(card.data.days.length));
    eq(card.data.object.totals.hours, 14.5, 'часов всего: 7,5 + 3 + 4');
    eq(card.data.object.totals.estimate, 19237.5, 'итог расчёта в карточке');
    check('в карточке есть отметка дубля', card.data.days.some((d) => d.duplicate === true));
  }

  console.log('\n=== 9. Записи за сегодня (руководитель) ===');
  const today = await callApi('days.today', { date: '2026-10-13' }, leaderToken);
  check('сводка по дню получена', today.ok === true, today.ok ? '' : today.error);
  if (today.ok) {
    eq(today.data.hours, 10.5, 'часов за 13.10: 7,5 + 3');
    check('записи видны', today.data.records.length >= 2, today.data.records.length + ' записей');
  }
  const todayForbidden = await callApi('days.today', {}, masterToken);
  check('мастеру закрыта сводка по дню', todayForbidden.ok === false && todayForbidden.code === 'FORBIDDEN');

  console.log('\n=== 10. Смена статуса ===');
  const toWork = await callApi('objects.setStatus', { id: testObjectId, status: 'в работе' }, leaderToken);
  check('статус «в работе» установлен', toWork.ok === true && toWork.data.object.status === 'в работе');
  const sameStatus = await callApi('objects.setStatus', { id: testObjectId, status: 'в работе' }, leaderToken);
  check('повторный тот же статус отклонён', sameStatus.ok === false);

  const list = await callApi('objects.list', {}, leaderToken);
  check('объект виден в списке', list.ok && list.data.objects.some((o) => o.id === testObjectId));

  console.log('\n=== 11. Уборка тестового объекта ===');
  await callApi('objects.setStatus', { id: testObjectId, status: 'расчёт' }, leaderToken);
  const removed = await callApi('objects.remove', { id: testObjectId }, leaderToken);
  check('тестовый объект убран', removed.ok === true, removed.ok ? removed.data.message : removed.error);
  if (removed.ok) testObjectId = '';

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
