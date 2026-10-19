#!/usr/bin/env node
/**
 * ============================================================================
 * Сквозная проверка приложения в настоящем браузере (Chrome).
 *
 * Проходит путь мастера целиком: вход → список объектов → создание объекта →
 * расчёт с позициями, наценками и скидкой → журнал дней с проверкой повтора →
 * закупка с фотографией накладной → кабинет клиента → отчёт клиенту →
 * работа без сети с офлайн-очередью → разделы руководителя (аналитика,
 * бригада, посещения, архив) → уборка тестового объекта.
 * Заодно следит за ошибками в консоли браузера.
 *
 * Фотография для проверки рисуется тут же в браузере: так тест не зависит
 * от файлов в репозитории, а сжатие проверяется на снимке, похожем на
 * настоящий — 2400×1600 с шумом.
 *
 * Запуск: npm run e2e:front
 * ============================================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { callApi } = require('./api.js');

const PORT = Number(process.env.PORT || 4174);
const BASE = 'http://localhost:' + PORT + '/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const OBJECT_TITLE = 'ПРОВЕРКА ИНТЕРФЕЙСА';

// Идентификатор созданного объекта — чтобы убрать его, даже если прогон
// прервался на середине. Иначе брошенный объект останется в таблице
// и следующий запуск начнёт не с чистого листа.
let createdObjectId = '';

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

/** Подождать, пока появится хотя бы один элемент по селектору. */
async function waitFor(page, selector, timeout) {
  const limit = timeout || 15000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    const count = await page.$$eval(selector, (nodes) => nodes.length).catch(() => 0);
    if (count > 0) return true;
    await sleep(200);
  }
  return false;
}

/** Сколько элементов на странице. */
async function countOf(page, selector) {
  return page.$$eval(selector, (nodes) => nodes.length).catch(() => 0);
}

/**
 * Подождать, пока элементов по селектору станет не меньше нужного.
 *
 * Экраны руководителя (аналитика, бригада, посещения, архив) сначала
 * показывают «Считаем…» и только потом рисуют данные. Проверка сразу после
 * открытия экрана увидела бы пустоту и объявила сбой там, где приложение
 * работает правильно.
 */
/**
 * Подождать, пока условие в браузере станет истинным.
 * Нужно там, где важен не счётчик элементов, а состояние формы: например,
 * что поля очистились после сохранения.
 */
async function waitUntil(page, check, timeout) {
  const limit = timeout || 15000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    const done = await page.evaluate(check).catch(() => false);
    if (done) return true;
    await sleep(200);
  }
  return false;
}

async function waitForCount(page, selector, min, timeout) {
  const limit = timeout || 20000;
  const started = Date.now();
  let count = 0;
  while (Date.now() - started < limit) {
    count = await countOf(page, selector);
    if (count >= min) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Подождать, пока появится любой из селекторов.
 * Нужен там, где экран честно показывает либо данные, либо пустое состояние.
 * @return {Promise<string>} сработавший селектор или пустая строка
 */
async function waitForAny(page, selectors, timeout) {
  const limit = timeout || 20000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    for (const selector of selectors) {
      if ((await countOf(page, selector)) > 0) return selector;
    }
    await sleep(200);
  }
  return '';
}

/**
 * Если экран показал ошибку загрузки — нажать «Повторить».
 *
 * Google изредка отвечает отказом на ровном месте (холодный старт, усталость
 * на длинном прогоне). Экран это честно показывает и предлагает «Повторить» —
 * нажимаем, как сделал бы человек. Настоящая поломка экрана так не спрячется:
 * повтор не поможет, и проверка упадёт.
 *
 * @return {Promise<boolean>} был ли повтор
 */
async function retryIfFailed(page, rootSelector, retryText) {
  const failed = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    return Boolean(root && root.querySelector('.empty'));
  }, rootSelector);
  if (!failed) return false;

  console.log('  экран показал ошибку загрузки — нажимаем «' + retryText + '»');
  await clickByText(page, rootSelector + ' .empty .btn', retryText).catch(() => {});
  await sleep(2000);
  return true;
}

/** Текст последнего уведомления — чтобы сбой объяснял сам себя. */
async function lastToast(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('.toast');
    const node = nodes[nodes.length - 1];
    return node ? node.textContent.trim() : '';
  }).catch(() => '');
}

/**
 * Нажатие по элементу с предварительным центрированием.
 *
 * Обычный page.click() прокручивает страницу ровно настолько, чтобы элемент
 * стал виден, — то есть прижимает его к нижнему краю. Там у приложения стоит
 * фиксированная нижняя навигация, и нажатие уходит в неё вместо кнопки.
 * Поэтому сначала ставим элемент в середину экрана.
 */
async function clickElement(page, selector) {
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (node) node.scrollIntoView({ block: 'center' });
  }, selector);
  await sleep(200);
  await page.click(selector);
}

/** Переход по хэш-адресу с ожиданием нужного селектора. */
async function goTo(page, hash, selector, timeout) {
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  return waitFor(page, selector, timeout);
}

/**
 * Нажатие по карточке объекта с нужным номером.
 *
 * Искать объект по названию нельзя: в таблице могут лежать прежние объекты
 * с тем же названием, и проверка открыла бы чужой журнал. Номер объекта
 * уникален, поэтому опознаём карточку по нему.
 *
 * Ждём появления карточки: список сначала рисуется из сохранённого на
 * устройстве, и только потом заменяется свежим. Одного замера мало — карточка
 * нужного объекта появляется чуть позже, а до неё на экране уже есть чужие.
 */
async function clickObjectCardByNumber(page, number, timeout) {
  const digits = String(number).replace(/\D/g, '');
  const limit = timeout || 25000;
  const started = Date.now();
  let clicked = false;

  while (!clicked && Date.now() - started < limit) {
    clicked = await page.evaluate((needle) => {
      const cards = Array.prototype.slice.call(document.querySelectorAll('.object-card'));
      const target = cards.find((card) => {
        const label = card.querySelector('.object-card__num');
        return label && label.textContent.replace(/\D/g, '') === needle;
      });
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    }, digits);
    if (!clicked) await sleep(300);
  }

  if (!clicked) throw new Error('В списке нет карточки объекта № ' + digits);
}

/**
 * Подождать, пока объект с нужным номером исчезнет из списка.
 *
 * Список рисуется из кэша, а потом заменяется ответом сервера, поэтому
 * проверять исчезновение нужно с ожиданием, а не одним замером.
 */
async function waitUntilObjectGone(page, number, timeout) {
  const digits = String(number).replace(/\D/g, '');
  const limit = timeout || 25000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    const listed = await page.evaluate((needle) => {
      return Array.prototype.slice.call(document.querySelectorAll('.object-card'))
        .some((card) => {
          const label = card.querySelector('.object-card__num');
          return label && label.textContent.replace(/\D/g, '') === needle;
        });
    }, digits);
    if (!listed) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Вход в приложение с запасом по времени.
 *
 * Первый запрос к свежей версии скрипта в Google бывает долгим (холодный
 * старт), поэтому 20 секунд — мало. Ждём до 60 секунд и, если рабочий каркас
 * так и не появился, повторяем нажатие: живой человек сделал бы то же самое.
 */
async function login(page, name, code) {
  await page.waitForSelector('.login', { timeout: 20000 });
  await page.type('#login-name', name);
  await page.type('#login-code', code);
  await clickElement(page, '.login__submit');

  try {
    await page.waitForSelector('.shell', { timeout: 60000 });
    return true;
  } catch (error) {
    const state = await page.evaluate(() => ({
      name: (document.querySelector('#login-name') || {}).value || '',
      code: (document.querySelector('#login-code') || {}).value || '',
      button: (document.querySelector('.login__submit') || {}).textContent || '',
      error: (document.querySelector('.login__error') || {}).textContent || ''
    }));
    console.log('  вход не прошёл с первого раза (' + JSON.stringify(state) + '), повторяем');
    await clickElement(page, '.login__submit').catch(() => {});
    await page.waitForSelector('.shell', { timeout: 60000 });
    return true;
  }
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

/**
 * Фотография для проверки: рисуется в браузере и сохраняется во временный файл.
 * @param {Browser} browser
 * @param {string} dir
 * @return {Promise<string>} путь к файлу
 */
async function makeTestPhoto(browser, dir) {
  const maker = await browser.newPage();
  const dataUrl = await maker.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f6f4ee';
    ctx.fillRect(0, 0, 2400, 1600);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 92px sans-serif';
    ctx.fillText('НАКЛАДНАЯ № 42', 120, 250);
    ctx.font = '52px sans-serif';
    for (let i = 0; i < 12; i++) {
      ctx.fillText('Кабель ВВГнг 3×2,5 — ' + (i + 1) + ' м', 120, 380 + i * 68);
    }

    // Шум делает снимок похожим на настоящее фото: сжатие проверяется честно.
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 20;
      image.data[i] += noise;
      image.data[i + 1] += noise;
      image.data[i + 2] += noise;
    }
    ctx.putImageData(image, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.95);
  });
  await maker.close();

  const file = path.join(dir, 'nakladnaya.jpg');
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

/**
 * Загрузка файла в поле выбора фотографии.
 * Полей два: первое — камера (с признаком capture), второе — галерея.
 * В проверке подкладываем файл в нужное: так проверяются оба пути.
 */
async function attachPhoto(page, file, index) {
  const inputs = await page.$$('.photo-uploader__input');
  const input = inputs[index || 0];
  if (!input) throw new Error('Не найдено поле выбора фотографии');
  await input.uploadFile(file);
}

/** Заполнение первой строки формы закупки. */
async function fillPurchase(page, data) {
  const row = '.purchase-form__row:nth-child(1)';
  await page.type(row + ' .purchase-form__name', data.material);
  await page.type(row + ' .purchase-form__qty', String(data.qty));
  await page.type(row + ' .purchase-form__price', String(data.price));
  await page.type('.purchase-form textarea', data.comment);
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-front-'));
  const server = await startServer();
  console.log('Локальный сервер поднят на ' + BASE);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=430,932',
      // Подставная камера: проверяем настоящий путь съёмки через getUserMedia,
      // а не только поле выбора файла с признаком capture.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream'
    ]
  });

  try {
    const photoPath = await makeTestPhoto(browser, tmpDir);

    const page = await browser.newPage();
    await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
    await page.setCacheEnabled(false);

    // Считаем обращения к API: надо убедиться, что переключение вкладок
    // не ходит в сеть, а берёт данные из пакета на устройстве.
    await page.evaluateOnNewDocument(() => {
      window.__apiCalls = [];
      const original = window.fetch;
      window.fetch = function (url, options) {
        try {
          const body = JSON.parse(options.body);
          if (Array.isArray(window.__apiCalls)) window.__apiCalls.push(body.action);
        } catch (error) { /* не наш запрос */ }
        return original.apply(this, arguments);
      };
    });

    // Копирование ссылок проверяем по-настоящему: без разрешения браузер
    // откажет, и проверка «ссылка копируется» была бы ложной.
    await browser.defaultBrowserContext()
      .overridePermissions(new URL(BASE).origin, ['clipboard-read', 'clipboard-write'])
      .catch(() => {});
    await page.bringToFront();

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
    // Стек важен: без него непонятно, какой экран уронил страницу.
    page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + (error.stack || error.message)));

    console.log('\n=== 1. Загрузка и вход ===');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.login', { timeout: 20000 });
    check('экран входа показан', true);

    await login(page, 'Руководитель', '0000');
    check('рабочий каркас открыт', true);

    // Руководитель вошёл под заводским кодом — приложение открывает профиль
    // с напоминанием сменить код. Это правильно; переходим в раздел «Объекты».
    const onProfile = await waitForText(page, '.profile__alert-title', 'Смените код', 10000);
    check('напоминание о смене заводского кода показано', onProfile);

    console.log('\n=== 2. Создание объекта ===');
    await page.evaluate(() => { window.location.hash = '#/objects'; });
    await page.waitForSelector('.objects', { timeout: 15000 });
    check('список объектов показан', true);

    await clickElement(page, '.objects__add');
    await page.waitForSelector('.object-form', { timeout: 10000 });
    check('форма нового объекта открыта', true);

    await page.type('.object-form input[type="text"]', OBJECT_TITLE);
    const textInputs = await page.$$('.object-form input[type="text"]');
    await textInputs[1].type('Тестовый клиент');
    await textInputs[2].type('г. Магас, ул. Проверочная, 1');
    await page.type('.object-form input[type="tel"]', '+7 900 000-00-00');
    await clickElement(page, '.object-form__actions .btn');
    const cardOpened = await waitFor(page, '.object-card-screen__hero', 25000);
    check('карточка объекта открыта', cardOpened,
      cardOpened ? '' : 'уведомление: ' + (await lastToast(page)) + ', адрес: ' + (await page.evaluate(() => location.hash)));

    const numberLabel = await textOf(page, '.object-card-screen__num');
    check('номер объекта присвоен', /№\s*\d{3}/.test(numberLabel || ''), numberLabel);

    // Номер уникален — по нему потом найдём именно этот объект в списке.
    const objectNumber = String(numberLabel || '').replace(/\D/g, '');
    check('номер объекта разобран', objectNumber.length === 3, objectNumber);

    const objectId = await page.evaluate(() => {
      const parts = window.location.hash.split('/');
      return parts[2] || '';
    });
    check('идентификатор объекта получен из адреса', Boolean(objectId), objectId);
    createdObjectId = objectId;

    console.log('\n=== 3. Расчёт ===');
    await clickByText(page, '.object-card-screen__section .row', 'Расчёт стоимости');
    await page.waitForSelector('.calc-summary__total', { timeout: 20000 });
    check('экран расчёта открыт', true);

    await clickElement(page, '.calc__add .btn');
    // Если прайс ещё не доехал, экран сам его догружает и только потом
    // открывает окно выбора — на это нужно время.
    await page.waitForSelector('.calc-picker', { timeout: 40000 });
    check('окно выбора позиций открыто', true);

    // Раскрываем первый раздел и берём первую работу.
    await page.click('.calc-picker__section-head');
    await page.waitForSelector('.calc-picker__item', { timeout: 8000 });
    const itemCount = await page.$$eval('.calc-picker__item', (nodes) => nodes.length);
    check('позиции прайса видны', itemCount > 0, itemCount + ' позиций в разделе');

    // Список прайса обязан прокручиваться: в разделе десятки позиций, и до
    // нижних надо добраться. Список — флекс-колонка, а флекс-элементы
    // ужимаются под ограничение высоты: раздел сжимался, содержимое обрезалось
    // по overflow: hidden, и прокрутки не было вовсе.
    const pickerScroll = await page.evaluate(() => {
      const list = document.querySelector('.calc-picker__list');
      if (!list) return null;
      const before = list.scrollTop;
      list.scrollTop = 300;
      return {
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        moved: list.scrollTop > before
      };
    });
    check('список прайса прокручивается',
      Boolean(pickerScroll) && pickerScroll.moved && pickerScroll.scrollHeight > pickerScroll.clientHeight,
      pickerScroll
        ? 'видно ' + pickerScroll.clientHeight + 'px из ' + pickerScroll.scrollHeight + 'px'
        : 'списка нет');

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

    await clickElement(page, '.calc__save');
    await page.waitForSelector('.toast--success', { timeout: 20000 });
    const savedToast = await textOf(page, '.toast--success');
    check('расчёт сохранён на сервере', /Расчёт сохранён/.test(savedToast || ''), savedToast);

    const totalAfter = await textOf(page, '.calc-summary__total');
    check('итог с сервера получен', Boolean(totalAfter), totalAfter);

    console.log('\n=== 4. Журнал дней ===');
    // Открываем объект по номеру, а не по названию: в таблице могут лежать
    // прежние объекты с тем же названием, и поиск по тексту открыл бы чужой
    // журнал — тогда проверка «часы просуммированы» ровно ничего не значит.
    await goTo(page, '#/objects', '.objects', 20000);
    await clickObjectCardByNumber(page, objectNumber);
    await page.waitForSelector('.object-card-screen__hero', { timeout: 15000 });

    const openedNumber = String(await textOf(page, '.object-card-screen__num') || '').replace(/\D/g, '');
    check('открыт именно созданный объект', openedNumber === objectNumber, openedNumber);

    await clickByText(page, '.object-card-screen__section .row', 'Журнал дней');
    await page.waitForSelector('.day-journal', { timeout: 15000 });
    check('экран журнала дней открыт', true);

    // У только что созданного объекта журнал обязан быть пустым.
    const startRecords = await countOf(page, '.day-record');
    check('журнал нового объекта пуст', startRecords === 0, startRecords + ' записей');

    await page.type('.day-form input[inputmode="decimal"]', '7,5');
    await page.type('.day-form textarea', 'Разводка кабеля по первому этажу');
    await clickElement(page, '.day-form .btn--primary');
    const firstSaved = await waitForCount(page, '.day-record', 1, 20000);
    check('запись дня добавлена', firstSaved, firstSaved ? '' : await lastToast(page));

    // Ждём, пока форма очистится после первой записи. Иначе вторая запись
    // уйдёт с прежними значениями: экран уже показал запись, а поля ещё не
    // успели освободиться.
    await waitUntil(page, () => {
      const hours = document.querySelector('.day-form input[inputmode="decimal"]');
      const work = document.querySelector('.day-form textarea');
      return Boolean(hours && work && hours.value === '' && work.value === '');
    }, 20000);

    // Повтор за ту же дату — сохраняется, но помечается.
    await page.type('.day-form input[inputmode="decimal"]', '2');
    await page.type('.day-form textarea', 'Дополнительные работы');
    console.log('  перед второй записью: часы=' + JSON.stringify(
      await page.$eval('.day-form input[inputmode="decimal"]', (n) => n.value)
    ) + ', работа=' + JSON.stringify(
      await page.$eval('.day-form textarea', (n) => n.value)
    ) + ', кнопка занята=' + (await page.$eval('.day-form .btn--primary', (n) => n.dataset.busy === '1')));
    await clickElement(page, '.day-form .btn--primary');
    const secondSaved = await waitForCount(page, '.day-record', 2, 20000);
    check('вторая запись дня сохранена', secondSaved,
      secondSaved ? '' : 'уведомление: ' + (await lastToast(page)) +
        ', часов в форме: ' + (await page.$eval('.day-form input[inputmode="decimal"]', (n) => n.value)));
    await waitFor(page, '.day-record .badge--danger', 20000);
    const duplicateBadge = await textOf(page, '.day-record .badge--danger');
    check('повтор помечен, но не заблокирован', /повтор/.test(duplicateBadge || ''), duplicateBadge);

    const recordCount = await countOf(page, '.day-record');
    check('в журнале ровно две записи', recordCount === 2, recordCount + ' записей');

    // Что именно в журнале: без этого сбой «часы не те» ни о чём не говорит.
    console.log('  записи журнала: ' + JSON.stringify(
      await page.$$eval('.day-record', (nodes) => nodes.map((n) => n.textContent.trim().replace(/\s+/g, ' ')))
    ));

    const totalHours = await page.evaluate(() => {
      const node = document.querySelector('.day-journal__summary .stat__value');
      return node ? node.textContent.trim() : '';
    });
    check('часы просуммированы', /9,5/.test(totalHours), totalHours);

    console.log('\n=== 5. Закупки с фото накладной ===');
    await page.goto(BASE + '#/object/' + objectId, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.object-card-screen__hero', { timeout: 15000 });
    await clickByText(page, '.object-card-screen__section .row', 'Закупки');
    await page.waitForSelector('.purchases', { timeout: 15000 });
    check('экран закупок открыт', true);

    // Форма: три строки сразу, режимы ввода и галочка наценки.
    const defaultRows = await countOf(page, '.purchase-form__row');
    check('в форме сразу три строки', defaultRows === 3, defaultRows + ' строк');

    await clickElement(page, '.purchase-form__add .btn');
    const fourRows = await countOf(page, '.purchase-form__row');
    check('кнопка «плюс» добавляет строку', fourRows === 4, fourRows + ' строк');
    await clickElement(page, '.purchase-form__row:last-child .purchase-form__remove');

    const formModes = await page.$$eval('.purchase-form__mode', (nodes) => nodes.map((n) => n.textContent.trim()));
    check('есть переключение режима ввода', formModes.length === 2, formModes.join(' | '));
    check('галочка наценки на месте', (await countOf(page, '.purchase-form__check')) === 1);

    await attachPhoto(page, photoPath);
    const previewShown = await waitFor(page, '.photo-uploader__item', 40000);
    check('фотография сжата и показана', previewShown,
      previewShown ? '' : 'блок: ' + String(await textOf(page, '.photo-uploader') || '').replace(/\s+/g, ' ').slice(0, 120));

    // Размер и формат подписаны прямо под снимком.
    const photoMeta = String(await textOf(page, '.photo-uploader__item-meta') || '');
    const photoKb = /КБ/.test(photoMeta) ? parseInt(photoMeta, 10) : 0;
    check('размер фото в пределах цели (~300 КБ)', photoKb > 0 && photoKb <= 400,
      'получено: ' + photoMeta);
    check('формат сжатия выбран корректно', /WebP|JPEG/.test(photoMeta), photoMeta);

    // Камера и галерея — РАЗНЫЕ поля выбора файла. Одно поле с признаком
    // capture на части телефонов открывает галерею вместо камеры.
    const cameraInput = await page.$$eval('.photo-uploader__input',
      (nodes) => nodes.map((n) => n.getAttribute('capture') || ''));
    check('у камеры своё поле с признаком съёмки', cameraInput[0] === 'environment',
      'capture=' + (cameraInput[0] || 'нет'));

    const galleryMultiple = await page.$$eval('.photo-uploader__input',
      (nodes) => nodes.map((n) => n.hasAttribute('multiple')));
    check('у галереи своё поле с выбором нескольких', galleryMultiple[1] === true);

    const pickButtons = await page.$$eval('.photo-uploader__buttons .btn',
      (nodes) => nodes.map((n) => n.textContent.trim()));
    check('есть обе кнопки: съёмка и галерея',
      pickButtons.some((t) => /Снять/.test(t)) && pickButtons.some((t) => /галере/i.test(t)),
      pickButtons.join(' | '));

    // Второй снимок добавляется к первому, а не заменяет его.
    await attachPhoto(page, photoPath, 1);
    const twoPhotos = await waitForCount(page, '.photo-uploader__item', 2, 40000);
    check('к закупке прикладывается несколько фото', twoPhotos,
      (await countOf(page, '.photo-uploader__item')) + ' снимков');

    // Камера на ноутбуке: поле с capture там бесполезно, поэтому кнопка
    // «Снять» поднимает настоящее окно съёмки через getUserMedia.
    await clickElement(page, '.photo-uploader__buttons .btn');
    const cameraOpen = await waitFor(page, '.camera-overlay', 15000);
    check('кнопка съёмки открывает камеру', cameraOpen);

    if (cameraOpen) {
      // Подложка обязана быть непрозрачной, а кнопки — помещаться на экране:
      // полупрозрачная показывала страницу и её кнопки поверх съёмки.
      const layout = await page.evaluate(() => {
        const overlay = document.querySelector('.camera-overlay');
        const actions = document.querySelector('.camera__actions');
        const rect = actions ? actions.getBoundingClientRect() : null;
        return {
          opaque: getComputedStyle(overlay).backgroundColor.indexOf('rgba') === -1,
          bottom: rect ? Math.round(rect.bottom) : 0,
          windowHeight: window.innerHeight
        };
      });
      check('окно съёмки не просвечивает страницей', layout.opaque,
        await page.evaluate(() => getComputedStyle(document.querySelector('.camera-overlay')).backgroundColor));
      check('кнопки съёмки помещаются на экране',
        layout.bottom > 0 && layout.bottom <= layout.windowHeight,
        'низ кнопок ' + layout.bottom + ' из ' + layout.windowHeight);

      const live = await page.waitForFunction(() => {
        const video = document.querySelector('.camera__video');
        return Boolean(video && video.videoWidth > 0);
      }, { timeout: 20000 }).then(() => true).catch(() => false);
      check('в окне камеры идёт живая картинка', live);

      await clickElement(page, '.camera__shutter');
      const shotTaken = await waitForCount(page, '.camera__shot', 1, 15000);
      check('кадр снимается кнопкой затвора', shotTaken);

      await clickElement(page, '.camera__actions .btn--primary');
      const cameraPhoto = await waitForCount(page, '.photo-uploader__item', 3, 40000);
      check('снимок с камеры попал в форму', cameraPhoto,
        (await countOf(page, '.photo-uploader__item')) + ' снимков');
    }

    // Ненужный снимок убирается до сохранения.
    await clickElement(page, '.photo-uploader__remove');
    const twoLeft = await waitForCount(page, '.photo-uploader__item', 2, 10000);
    check('ненужный снимок убирается', twoLeft,
      (await countOf(page, '.photo-uploader__item')) + ' снимков');

    await fillPurchase(page, {
      material: 'Кабель ВВГнг 3×2,5',
      qty: 30,
      price: 118.5,
      comment: 'Накладная № 42'
    });
    const previewSum = await textOf(page, '.purchase-form__sum-value');
    check('предварительная сумма посчитана', /3\s?555/.test(String(previewSum || '').replace(/[\u2009\s]/g, '')),
      previewSum);

    await clickElement(page, '.purchase-form .btn--primary');
    const purchaseAdded = await waitFor(page, '.purchase', 60000);
    check('закупка с фото записана', purchaseAdded, purchaseAdded ? '' : await lastToast(page));

    const purchaseSum = await textOf(page, '.purchase__sum');
    check('сумма закупки показана', /3\s?555/.test(String(purchaseSum || '').replace(/[\u2009\s]/g, '')),
      purchaseSum);

    const thumb = await countOf(page, '.purchase__thumb');
    check('миниатюра накладной в списке', thumb > 0, thumb + ' миниатюр');

    if (thumb > 0) {
      await clickElement(page, '.purchase__photo--filled');
      const modalOpen = await waitFor(page, '.purchase-view__image', 8000);
      check('фото накладной открывается крупно', modalOpen);
      if (modalOpen) {
        await clickByText(page, '.modal__actions .btn', 'Закрыть');
        await sleep(300);
      }
    } else {
      check('фото накладной открывается крупно', false, 'нет миниатюры — открывать нечего');
    }

    console.log('\n=== 6. Кабинет клиента ===');
    await page.goto(BASE + '#/cabinet/' + objectId, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cabinet', { timeout: 15000 });
    await retryIfFailed(page, '.cabinet', 'Повторить');
    const openedByDefault = await waitFor(page, '.cabinet__state--open', 45000);
    check('кабинет нового объекта открыт', openedByDefault);

    const cabinetLink = await page.$eval('.cabinet__link', (node) => node.value).catch(() => '');
    check('ссылка на кабинет ведёт на сайт и несёт только токен',
      /^https:\/\/[^\s]+#\/c\/[A-Za-z0-9_-]+$/.test(cabinetLink) &&
      cabinetLink.indexOf('script.google.com') === -1,
      cabinetLink ? cabinetLink.slice(0, 70) + '…' : 'ссылки нет');

    const cabinetToken = (cabinetLink.match(/#\/c\/([A-Za-z0-9_-]+)/) || [])[1] || '';
    check('токен из короткой ссылки разбирается', Boolean(cabinetToken), cabinetToken || 'не разобран');

    // Клиент открывает ссылку без входа: проверяем в отдельном профиле
    // браузера, где нет ни сессии, ни сохранённых данных приложения.
    const guestContext = await (browser.createBrowserContext
      ? browser.createBrowserContext()
      : browser.createIncognitoBrowserContext());
    const guest = await guestContext.newPage();
    await guest.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
    await guest.setCacheEnabled(false);
    await guest.setBypassServiceWorker(true);

    try {
      await guest.goto(BASE + '#/c/' + cabinetToken, { waitUntil: 'domcontentloaded' });
      const publicTitle = await waitFor(guest, '.public-cabinet__title', 60000);
      check('кабинет открывается по короткой ссылке без входа', publicTitle,
        publicTitle ? '' : 'на экране: ' + String(await textOf(guest, '.public-cabinet__body') || '').slice(0, 90));
      check('формы входа в кабинете нет', (await countOf(guest, '.login')) === 0);

      const publicTotal = await textOf(guest, '.public-cabinet__total-value');
      check('в кабинете виден итог по смете', /₽/.test(String(publicTotal || '')), publicTotal);

      // Та же страница по адресу отчёта: #/r/ТОКЕН.
      await guest.goto(BASE + '#/r/' + cabinetToken, { waitUntil: 'domcontentloaded' });
      const reportTitle = await waitFor(guest, '.public-cabinet__title', 60000);
      check('страница отчёта открывается без входа', reportTitle);

      const reportNote = await textOf(guest, '.public-cabinet__note');
      check('у страницы отчёта свой заголовок', /Отчёт/i.test(String(reportNote || '')), reportNote);

      const moneyLabels = await guest.$$eval('.public-cabinet__total-label',
        (nodes) => nodes.map((n) => n.textContent.trim()));
      check('в отчёте смета и материалы посчитаны отдельно',
        moneyLabels.some((t) => /по смете/i.test(t)) && moneyLabels.some((t) => /за материалы/i.test(t)),
        moneyLabels.join(' | '));
      check('в отчёте есть общая сумма к оплате',
        moneyLabels.some((t) => /Всего к оплате/i.test(t)), moneyLabels.join(' | '));

      // Мёртвая ссылка: несуществующий токен не должен пускать в кабинет.
      await guest.goto(BASE + '#/c/NETTAKOGOTOKENA', { waitUntil: 'domcontentloaded' });
      const deadTitle = await waitForText(guest, '.empty__title', 'Ссылка недоступна', 60000);
      check('по чужому токену кабинет не открывается', deadTitle);
    } finally {
      await guestContext.close();
    }

    // Копирование ссылки — кнопка должна ответить понятным уведомлением.
    await clickByText(page, '.cabinet__actions .btn', 'Скопировать');
    const copyToast = await waitForText(page, '.toast', 'скопирована', 8000);
    check('ссылка копируется в буфер', copyToast);

    // Закрываем доступ: ссылка должна погаснуть.
    await clickByText(page, '.cabinet__state .btn', 'Закрыть доступ');
    await page.waitForSelector('.modal', { timeout: 8000 });
    await clickByText(page, '.modal__actions .btn', 'Закрыть доступ');
    // Смена состояния идёт через сервер: на холодном старте Google отвечает
    // медленно, поэтому ждём с запасом.
    const closedState = await waitFor(page, '.cabinet__state--closed', 45000);
    check('доступ клиенту закрывается', closedState,
      closedState ? '' : 'на экране: ' + String(await textOf(page, '.cabinet__state') || '').replace(/s+/g, ' ').slice(0, 100));

    // Старую ссылку проверяем по данным, а не по адресу: адрес ведёт на сайт,
    // и любая его копия отдаёт одну и ту же оболочку приложения.
    const deadCall = await callApi('cabinet.data', { token: cabinetToken });
    check('после закрытия старая ссылка не работает',
      deadCall.ok === false && /не найден|закрыт|недействительн/i.test(String(deadCall.error || '')),
      deadCall.ok ? 'сервер всё ещё отдаёт данные по старому токену' : String(deadCall.error || '').slice(0, 90));

    // Открываем снова — токен должен смениться, прежняя ссылка остаётся мёртвой.
    await clickByText(page, '.cabinet__state .btn', 'Открыть доступ');
    const reopened = await waitFor(page, '.cabinet__state--open', 45000);
    check('доступ открывается заново', reopened);

    const newCabinetLink = await page.$eval('.cabinet__link', (node) => node.value).catch(() => '');
    check('новая ссылка отличается от прежней',
      Boolean(newCabinetLink) && newCabinetLink !== cabinetLink);

    // Свежий токен обязан работать: иначе закрытие кабинета ломает его насовсем.
    const newToken = (newCabinetLink.match(/#\/c\/([A-Za-z0-9_-]+)/) || [])[1] || '';
    const freshCall = await callApi('cabinet.data', { token: newToken });
    const freshLabel = freshCall.ok && freshCall.data && freshCall.data.object
      ? freshCall.data.object.numberLabel
      : '';
    check('по новой ссылке кабинет снова отдаёт данные', Boolean(freshLabel),
      freshLabel || String(freshCall.error || 'нет данных'));

    console.log('\n=== 7. Отчёт клиенту ===');
    // window.open заменяем на запись: новые вкладки в проверке не нужны.
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => { window.__opened.push(url); return null; };
    });

    await page.goto(BASE + '#/object/' + objectId + '/report', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.report', { timeout: 15000 });
    check('экран отчёта открыт', true);

    await retryIfFailed(page, '.report', 'Повторить');
    const linksShown = await waitFor(page, '.report__links', 20000);
    check('ссылки для клиента доступны (кабинет открыт)', linksShown);

    // Ссылка на отчёт тоже ведёт на сайт и тоже короткая.
    const reportLinkValue = await page.$$eval('.report__link',
      (nodes) => nodes.map((n) => n.value));
    check('ссылка на страницу отчёта ведёт на сайт',
      /#\/r\/[A-Za-z0-9_-]+$/.test(String(reportLinkValue[1] || '')),
      String(reportLinkValue[1] || 'нет ссылки').slice(0, 70));

    // Скачивание проверяем по-настоящему: Chrome складывает файл в папку,
    // и мы смотрим, что это PDF, а не открытая вкладка с Google Диском.
    const downloadDir = path.join(tmpDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
      eventsEnabled: true
    });

    await clickByText(page, '.report__actions .row', 'Скачать PDF');
    const pdfToast = await waitForText(page, '.toast', 'PDF сохранён', 120000);
    check('PDF-отчёт собран на сервере', pdfToast);

    let pdfFile = '';
    const downloadStarted = Date.now();
    while (Date.now() - downloadStarted < 60000) {
      const files = fs.readdirSync(downloadDir).filter((name) => /\.pdf$/i.test(name));
      if (files.length) {
        pdfFile = path.join(downloadDir, files[0]);
        break;
      }
      await sleep(300);
    }
    const pdfSize = pdfFile ? fs.statSync(pdfFile).size : 0;
    check('файл PDF сохраняется на устройство', pdfSize > 20000,
      pdfFile ? path.basename(pdfFile) + ', ' + Math.round(pdfSize / 1024) + ' КБ' : 'файла в загрузках нет');

    const openedUrls = await page.evaluate(() => window.__opened || []);
    check('при скачивании не открывается Google Диск',
      !openedUrls.some((url) => /drive\.google\.com/.test(url)),
      openedUrls.length ? String(openedUrls[0]).slice(0, 60) : 'вкладок не открывалось');

    await clickByText(page, '.report__actions .row', 'Показать веб-отчёт');
    const reportOpened = await page.evaluate(() => (window.__opened || []).some((url) => /#\/r\//.test(url)));
    check('веб-отчёт клиента открывается на сайте', reportOpened);

    console.log('\n=== 8. Работа без сети (офлайн-очередь) ===');
    await page.goto(BASE + '#/object/' + objectId + '/purchases', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.purchases', { timeout: 15000 });

    await page.setOfflineMode(true);
    await sleep(500);
    const offlineIndicator = await textOf(page, '.sync__text');
    check('приложение видит пропажу сети', /Нет сети|Офлайн/.test(String(offlineIndicator || '')), offlineIndicator);

    await fillPurchase(page, {
      material: 'Автомат 16А (офлайн)',
      qty: 2,
      price: 320,
      comment: 'Записано без сети'
    });
    await clickElement(page, '.purchase-form .btn--primary');
    // Записей может быть несколько, поэтому подпись бывает и «сохранена», и «сохранены».
    const offlineToast = await waitForText(page, '.toast', 'на телефоне', 15000);
    check('без сети запись уходит в очередь', offlineToast);

    // Индикатор обновляется чуть позже самой записи — ждём текст, а не читаем разом.
    const queuedIndicator = await waitForText(page, '.sync__text', 'очеред', 15000);
    check('индикатор показывает очередь', queuedIndicator, await textOf(page, '.sync__text'));

    await page.setOfflineMode(false);
    // Очередь отправляется сама при появлении сети — ждём именно этого.
    let drained = false;
    for (let i = 0; i < 60; i++) {
      const text = await textOf(page, '.sync__text');
      if (/Всё отправлено/.test(String(text || ''))) {
        drained = true;
        break;
      }
      await sleep(500);
    }
    check('очередь ушла сама при появлении сети', drained);

    // Уходим на список и обратно: адрес закупок уже открыт, повторный переход
    // по тому же адресу экран не перерисует.
    await goTo(page, '#/objects', '.objects', 20000);
    await page.goto(BASE + '#/object/' + objectId + '/purchases', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.purchases', { timeout: 15000 });
    const restored = await waitForText(page, '.purchase__material', 'Автомат 16А (офлайн)', 20000);
    check('отложенная закупка появилась в списке', restored);

    console.log('\n=== 9. Аналитика ===');
    await goTo(page, '#/analytics', '.analytics', 20000);
    check('экран аналитики открыт', true);

    const statsReady = await waitForCount(page, '.analytics__stats .stat', 4, 30000);
    const analyticsStats = await countOf(page, '.analytics__stats .stat');
    check('итоги по объектам посчитаны', statsReady, analyticsStats + ' плиток');

    const analyticsRows = await countOf(page, '.analytics__row');
    check('объекты попали в сводку', analyticsRows > 0, analyticsRows + ' строк');

    await clickByText(page, '.analytics__tabs .tabs__item', 'Дни');
    const daysShown = await waitFor(page, '.analytics__day', 30000);
    check('сводка по дням построена', daysShown);

    const executorsShown = await countOf(page, '.analytics__executor');
    check('часы по мастерам посчитаны', executorsShown > 0, executorsShown + ' мастеров');

    console.log('\n=== 10. Бригада и уведомления ===');
    await goTo(page, '#/brigade', '.brigade', 20000);
    check('экран бригады открыт', true);

    const peopleReady = await waitForCount(page, '.brigade__user', 1, 30000);
    const people = await countOf(page, '.brigade__user');
    check('состав бригады загружен', peopleReady, people + ' человек');

    const botBlock = await waitFor(page, '.brigade__bot', 15000);
    check('настройки уведомлений доступны', botBlock);

    const botState = await textOf(page, '.brigade__bot-state');
    check('состояние уведомлений показано', Boolean(botState), botState);

    const tools = await countOf(page, '.brigade__tool-icon');
    check('переходы в архив и журнал на месте', tools >= 2, tools + ' разделов');

    console.log('\n=== 11. Журнал посещений ===');
    await goTo(page, '#/visits', '.visits', 20000);
    check('экран посещений открыт', true);

    const visitsReady = await waitForCount(page, '.visit', 1, 30000);
    const visits = await countOf(page, '.visit');
    check('записи журнала есть', visitsReady, visits + ' записей');

    const visitsStatsReady = await waitForCount(page, '.visits__stats .stat', 2, 15000);
    const visitsStats = await countOf(page, '.visits__stats .stat');
    check('итоги журнала посчитаны', visitsStatsReady, visitsStats + ' плиток');

    console.log('\n=== 12. Архив ===');
    await goTo(page, '#/archive', '.archive', 20000);
    check('экран архива открыт', true);

    const archiveStatsReady = await waitForCount(page, '.archive__stats .stat', 2, 30000);
    const archiveStats = await countOf(page, '.archive__stats .stat');
    check('итоги архива посчитаны', archiveStatsReady, archiveStats + ' плиток');

    // Архив может быть и с таблицами, и пустым: и то и другое — правильный
    // ответ. Ждём, пока экран выйдет из состояния загрузки.
    const archiveState = await waitForAny(page, ['.archive__item', '.archive .empty'], 20000);
    const archiveItems = await countOf(page, '.archive__item');
    const archiveEmpty = await countOf(page, '.archive .empty');
    check('архив показан: таблицы или понятная пустота', Boolean(archiveState),
      archiveItems + ' таблиц, пустое состояние: ' + (archiveEmpty ? 'да' : 'нет'));

    console.log('\n=== 13. Повторные переходы и прайс в профиле ===');

    // Первый заход прогрел сохранённое на устройстве. Второй должен открываться
    // сразу: данные берутся с устройства, а не ждут ответа Google.
    await page.goto(BASE + '#/object/' + objectId, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.object-card-screen__hero', { timeout: 20000 });
    await sleep(1200);

    const screens = [
      ['#/object/' + objectId, '.object-card-screen__num', 'карточка объекта'],
      ['#/object/' + objectId + '/calc', '.calc-summary__total', 'расчёт'],
      ['#/object/' + objectId + '/days', '.day-record', 'журнал дней'],
      ['#/object/' + objectId + '/purchases', '.purchase', 'закупки']
    ];

    // Время считаем от появления каркаса: запуск приложения к экрану
    // отношения не имеет, а именно он занимает больше всего времени.
    const slow = [];
    for (const [hash, selector, title] of screens) {
      await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.shell', { timeout: 20000 });
      const started = Date.now();
      const shown = await waitFor(page, selector, 20000);
      const spent = Date.now() - started;
      if (!shown || spent > 1200) slow.push(title + ': ' + spent + ' мс');
    }
    check('данные объекта открываются сразу, без ожидания', slow.length === 0,
      slow.length ? slow.join(', ') : 'все экраны показали данные быстрее 1,2 секунды');

    // Прайс целиком — из профиля.
    await page.goto(BASE + '#/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.profile__hero', { timeout: 15000 });
    await clickByText(page, '.page__section .row', 'Прайс цен');
    await page.waitForSelector('.prices', { timeout: 15000 });
    check('прайс открывается из профиля', true);

    const priceSections = await waitForCount(page, '.prices__section', 1, 20000);
    const priceRows = await countOf(page, '.prices__row');
    check('в прайсе видны разделы и позиции', priceSections && priceRows > 0,
      (await countOf(page, '.prices__section')) + ' разделов, ' + priceRows + ' позиций');

    await page.type('.prices__search', 'кабель');
    await sleep(600);
    const found = await countOf(page, '.prices__row');
    check('поиск по прайсу работает', found > 0 && found < priceRows, found + ' позиций по запросу «кабель»');

    console.log('\n=== 14. Уборка тестового объекта ===');
    await goTo(page, '#/objects', '.objects', 20000);
    await clickObjectCardByNumber(page, objectNumber);
    await page.waitForSelector('.object-card-screen__hero', { timeout: 15000 });

    const removalNumber = String(await textOf(page, '.object-card-screen__num') || '').replace(/\D/g, '');
    check('к уборке выбран именно созданный объект', removalNumber === objectNumber, removalNumber);

    await clickByText(page, '.object-card-screen__section .row', 'Убрать объект');
    await page.waitForSelector('.modal', { timeout: 8000 });
    await clickByText(page, '.modal__actions .btn', 'Убрать объект');
    const removed = await waitForText(page, '.toast', 'корзин', 15000);
    check('объект убран в корзину', removed);

    // После уборки объекта в списке быть не должно.
    await goTo(page, '#/objects', '.objects', 20000);
    const gone = await waitUntilObjectGone(page, objectNumber, 30000);
    check('убранного объекта нет в списке', gone);
    if (gone) createdObjectId = '';

    console.log('\n=== 15. Переключение вкладок ===');
    // Данные разделов лежат в пакете на устройстве, поэтому переключение
    // вкладок не должно обращаться к серверу. Проверяем это по-настоящему:
    // считаем запросы к API за время обхода разделов.
    await page.evaluate(() => { window.__apiCalls = []; });
    for (const hash of ['#/objects', '#/analytics', '#/brigade', '#/objects', '#/analytics', '#/profile']) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await sleep(1200);
    }
    const tabCalls = await page.evaluate(() => window.__apiCalls || []);
    check('переключение вкладок не обращается к серверу', tabCalls.length === 0,
      tabCalls.length ? 'запросы: ' + tabCalls.join(', ') : 'ни одного запроса');

    const syncTexts = await page.$$eval('.sync__text', (nodes) => nodes.map((n) => n.textContent.trim()));
    check('индикатор показывает и очередь, и свежесть данных', syncTexts.length >= 2, syncTexts.join(' | '));

    // Тексты строк не должны вылезать за край экрана. Была такая беда
    // в профиле: заголовок и подпись строки шли одной строкой и заезжали
    // под значок. Проверяем не только профиль — правило общее для всех строк.
    await page.goto(BASE + '#/profile', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const bad = [];
      document.querySelectorAll('.row__title, .row__sub, .app-header__title, .sync__text').forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.right > width + 0.5) {
          bad.push((node.textContent || '').trim().slice(0, 30));
        }
      });
      return { bad: bad, horizontal: document.documentElement.scrollWidth - width };
    });
    check('тексты не вылезают за край экрана',
      overflow.bad.length === 0 && overflow.horizontal <= 1,
      overflow.bad.length ? overflow.bad.join(' | ') : 'лишней прокрутки нет');

    // На широком экране навигация должна уехать в верхнюю шапку: внизу она
    // выглядела островком посреди пустого места.
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE + '#/objects', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const navBox = await page.evaluate(() => {
      const nav = document.querySelector('.app-nav');
      const header = document.querySelector('.app-header');
      if (!nav || !header) return null;
      const n = nav.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      return { top: n.top, bottom: n.bottom, headerBottom: h.bottom, half: window.innerHeight / 2 };
    });
    check('на широком экране навигация в шапке',
      Boolean(navBox) && navBox.top < navBox.headerBottom && navBox.bottom < navBox.half,
      navBox ? 'верх ' + Math.round(navBox.top) + 'px, низ ' + Math.round(navBox.bottom) + 'px' : 'навигация не найдена');

    await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

    console.log('\n=== 16. Ошибки консоли ===');
    // Отсеиваем шум самой проверки: браузер ругается на служебный файл
    // приложения и на запросы, которые мы нарочно обрываем, проверяя офлайн.
    const meaningful = consoleErrors.filter((line) =>
      line.indexOf('sw.js') === -1 && line.indexOf('ERR_INTERNET_DISCONNECTED') === -1);
    check('в консоли браузера нет ошибок', meaningful.length === 0,
      meaningful.length ? meaningful.slice(0, 3).join(' | ') : 'чисто');
  } finally {
    // Прогон мог прерваться до уборки — тогда тестовый объект останется
    // в таблице и следующий запуск начнётся не с чистого листа. Убираем его
    // тем же безопасным способом: лист уезжает в таблицу-корзину на Диске.
    if (createdObjectId) {
      try {
        const login = await callApi('auth.login', { name: 'Руководитель', code: '0000' });
        if (login && login.ok) {
          const res = await callApi('objects.remove', { id: createdObjectId }, login.data.token);
          console.log('\nТестовый объект убран после прерванного прогона: ' +
            (res && res.ok ? 'ок' : 'не удалось — ' + (res && res.error)));
        } else {
          console.log('\nТестовый объект остался в таблице: не удалось войти для уборки');
        }
      } catch (error) {
        console.log('\nТестовый объект остался в таблице: ' + error.message);
      }
    }
    await browser.close();
    server.kill();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (error) { /* не критично */ }
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
