#!/usr/bin/env node
/**
 * ============================================================================
 * Сквозная проверка приложения в настоящем браузере (Chrome).
 *
 * Проходит путь мастера целиком: вход → список объектов → создание объекта →
 * расчёт с позициями, наценками и скидкой → журнал дней с проверкой повтора →
 * возврат в карточку → уборка тестового объекта. Заодно следит за ошибками
 * в консоли браузера.
 *
 * Запуск: npm run e2e:front
 * ============================================================================
 */

const { spawn } = require('child_process');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT || 4174);
const BASE = 'http://localhost:' + PORT + '/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
const consoleErrors = [];

/** Проверка утверждения с записью в отчёт. */
function check(title, condition, details) {
  results.push({ title, ok: Boolean(condition), details: details === undefined ? '' : details });
  console.log((condition ? '  ок    ' : '  СБОЙ  ') + title + (details ? ' — ' + details : ''));
  return Boolean(condition);
}

/** Пауза. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Нажатие по элементу, найденному по тексту. */
async function clickByText(page, selector, text) {
  const clicked = await page.evaluate((sel, needle) => {
    const nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
    const target = nodes.find((node) => (node.textContent || '').indexOf(needle) !== -1);
    if (!target) return false;
    target.click();
    return true;
  }, selector, text);
  if (!clicked) throw new Error('Не найден элемент «' + selector + '» с текстом «' + text + '»');
}

/** Текст элемента. */
async function textOf(page, selector) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    return node ? node.textContent.trim() : null;
  }, selector);
}

/** Подождать, пока элемент с текстом появится. */
async function waitForText(page, selector, text, timeout) {
  const limit = timeout || 15000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    const found = await page.evaluate((sel, needle) => {
      return Array.prototype.slice.call(document.querySelectorAll(sel))
        .some((node) => (node.textContent || '').indexOf(needle) !== -1);
    }, selector, text);
    if (found) return true;
    await sleep(200);
  }
  return false;
}

/** Запуск локального сервера. */
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'serve.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT) }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let done = false;
    child.stdout.on('data', (chunk) => {
      if (!done && String(chunk).indexOf('localhost') !== -1) {
        done = true;
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));
    child.on('exit', (code) => {
      if (!done) reject(new Error('Сервер завершился с кодом ' + code));
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        resolve(child);
      }
    }, 2500);
  });
}

async function main() {
  const server = await startServer();
  console.log('Локальный сервер поднят на ' + BASE);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=430,932']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
    await page.setCacheEnabled(false);

    // Сервис-воркер в проверке не нужен: он может отдать старую копию файлов.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().endsWith('/sw.js')) {
        request.abort();
        return;
      }
      request.continue();
    });

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));

    console.log('\n=== 1. Загрузка и вход ===');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.login', { timeout: 15000 });
    check('экран входа показан', true);

    await page.type('#login-name', 'Руководитель');
    await page.type('#login-code', '0000');
    await page.click('.login__submit');
    await page.waitForSelector('.shell', { timeout: 20000 });
    check('рабочий каркас открыт', true);

    // Руководитель вошёл под заводским кодом — приложение открывает профиль
    // с напоминанием сменить код. Это правильно; переходим в раздел «Объекты».
    const onProfile = await waitForText(page, '.profile__alert-title', 'Смените код', 10000);
    check('напоминание о смене заводского кода показано', onProfile);

    await page.evaluate(() => { window.location.hash = '#/objects'; });
    await page.waitForSelector('.objects', { timeout: 15000 });
    check('список объектов показан', true);

    console.log('\n=== 2. Создание объекта ===');
    await page.click('.objects__add');
    await page.waitForSelector('.object-form', { timeout: 10000 });
    check('форма нового объекта открыта', true);

    await page.type('.object-form input[type="text"]', 'ПРОВЕРКА ИНТЕРФЕЙСА');
    const textInputs = await page.$$('.object-form input[type="text"]');
    await textInputs[1].type('Тестовый клиент');
    await textInputs[2].type('г. Магас, ул. Проверочная, 1');
    await page.type('.object-form input[type="tel"]', '+7 900 000-00-00');
    await page.click('.object-form__actions .btn');
    await page.waitForSelector('.object-card-screen__hero', { timeout: 20000 });
    check('карточка объекта открыта', true);

    const numberLabel = await textOf(page, '.object-card-screen__num');
    check('номер объекта присвоен', /№\s*\d{3}/.test(numberLabel || ''), numberLabel);

    console.log('\n=== 3. Расчёт ===');
    await clickByText(page, '.object-card-screen__section .row', 'Расчёт стоимости');
    await page.waitForSelector('.calc-summary__total', { timeout: 20000 });
    check('экран расчёта открыт', true);

    await page.click('.calc__add .btn');
    await page.waitForSelector('.calc-picker', { timeout: 10000 });
    check('окно выбора позиций открыто', true);

    // Раскрываем первый раздел и берём первую работу.
    await page.click('.calc-picker__section-head');
    await page.waitForSelector('.calc-picker__item', { timeout: 8000 });
    const itemCount = await page.$$eval('.calc-picker__item', (nodes) => nodes.length);
    check('позиции прайса видны', itemCount > 0, itemCount + ' позиций в разделе');

    // Берём две разные работы: повторное нажатие по той же позиции ничего не делает.
    const pickerItems = await page.$$('.calc-picker__item');
    await pickerItems[0].click();
    if (pickerItems[1]) await pickerItems[1].click();
    await clickByText(page, '.modal__actions .btn', 'Готово');
    await page.waitForSelector('.calc-row', { timeout: 8000 });
    const rowCount = await page.$$eval('.calc-row', (nodes) => nodes.length);
    check('две позиции добавлены в смету', rowCount === 2, rowCount + ' строк');

    // Наценки и скидка.
    const paramInputs = await page.$$('.calc__params input');
    await paramInputs[0].type('50000');
    await paramInputs[1].type('10000');
    await paramInputs[2].type('5');
    await clickByText(page, '.calc__discount-tabs .tabs__item', 'Процент');
    await sleep(300);

    const totalBefore = await textOf(page, '.calc-summary__total');
    check('итог пересчитан', Boolean(totalBefore) && totalBefore !== '0,00 ₽', totalBefore);

    await page.click('.calc__save');
    await page.waitForSelector('.toast--success', { timeout: 20000 });
    const savedToast = await textOf(page, '.toast--success');
    check('расчёт сохранён на сервере', /Расчёт сохранён/.test(savedToast || ''), savedToast);

    const totalAfter = await textOf(page, '.calc-summary__total');
    check('итог с сервера получен', Boolean(totalAfter), totalAfter);

    console.log('\n=== 4. Журнал дней ===');
    await page.goto(BASE + '#/objects', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.objects', { timeout: 15000 });
    await page.waitForSelector('.objects', { timeout: 15000 });
    await page.waitForSelector('.object-card', { timeout: 15000 });
    await clickByText(page, '.object-card', 'ПРОВЕРКА ИНТЕРФЕЙСА');
    await page.waitForSelector('.object-card-screen__hero', { timeout: 15000 });
    await clickByText(page, '.object-card-screen__section .row', 'Журнал дней');
    await page.waitForSelector('.day-journal', { timeout: 15000 });
    check('экран журнала дней открыт', true);

    await page.type('.day-form input[inputmode="decimal"]', '7,5');
    await page.type('.day-form textarea', 'Разводка кабеля по первому этажу');
    await page.click('.day-form .btn--primary');
    await page.waitForSelector('.day-record', { timeout: 20000 });
    check('запись дня добавлена', true);

    // Повтор за ту же дату — сохраняется, но помечается.
    await page.type('.day-form input[inputmode="decimal"]', '2');
    await page.type('.day-form textarea', 'Дополнительные работы');
    await page.click('.day-form .btn--primary');
    await page.waitForSelector('.day-record .badge--danger', { timeout: 20000 });
    const duplicateBadge = await textOf(page, '.day-record .badge--danger');
    check('повтор помечен, но не заблокирован', /повтор/.test(duplicateBadge || ''), duplicateBadge);

    const totalHours = await page.evaluate(() => {
      const node = document.querySelector('.day-journal__summary .stat__value');
      return node ? node.textContent.trim() : '';
    });
    check('часы просуммированы', /9,5/.test(totalHours), totalHours);

    console.log('\n=== 5. Уборка тестового объекта ===');
    await page.goto(BASE + '#/objects', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.objects', { timeout: 15000 });
    await page.waitForSelector('.objects', { timeout: 15000 });
    await page.waitForSelector('.object-card', { timeout: 15000 });
    await clickByText(page, '.object-card', 'ПРОВЕРКА ИНТЕРФЕЙСА');
    await page.waitForSelector('.object-card-screen__hero', { timeout: 15000 });
    await clickByText(page, '.object-card-screen__section .row', 'Убрать объект');
    await page.waitForSelector('.modal', { timeout: 8000 });
    await clickByText(page, '.modal__actions .btn', 'Убрать объект');
    const removed = await waitForText(page, '.toast', 'корзин', 15000);
    check('объект убран в корзину', removed);

    console.log('\n=== 6. Ошибки консоли ===');
    const meaningful = consoleErrors.filter((line) => line.indexOf('sw.js') === -1);
    check('в консоли браузера нет ошибок', meaningful.length === 0,
      meaningful.length ? meaningful.slice(0, 3).join(' | ') : 'чисто');
  } finally {
    await browser.close();
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log('Проверок: ' + results.length + ', успешно: ' + (results.length - failed.length) + ', сбоев: ' + failed.length);
  if (failed.length) {
    console.log('\nНе прошли:');
    failed.forEach((r) => console.log('  - ' + r.title + (r.details ? ' (' + r.details + ')' : '')));
    process.exit(1);
  }
  console.log('Все проверки интерфейса пройдены.');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nПрогон прерван:', error.message);
  process.exit(1);
});
