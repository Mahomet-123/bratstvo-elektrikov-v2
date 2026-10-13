#!/usr/bin/env node
/**
 * ============================================================================
 * Вызов API веб-приложения из командной строки. Нужен для проверок и e2e-прогона.
 *
 * Запуск:
 *   node scripts/api.js health
 *   node scripts/api.js auth.login '{"name":"Руководитель","code":"0000"}'
 *   node scripts/api.js users.list '' <токен>
 *
 * Особенность Apps Script: POST на /exec отвечает 302 и переносит результат
 * на отдельный адрес. Здесь это обрабатывается вручную (без авто-редиректа),
 * потому что при редиректе тело POST теряется.
 * ============================================================================
 */

const API_URL =
  process.env.BRATSTVO_API_URL ||
  'https://script.google.com/macros/s/AKfycbxyAah88qWJJvNzNL8sjGdwixn_stixWCX8vJkq7qy_2PhpooTASp2j-7W46HIBJXc-/exec';

/**
 * Запрос с повтором при сетевом сбое.
 * Google периодически обрывает соединение на длинных прогонах —
 * без повторов сквозная проверка падает на ровном месте.
 * @param {string} url
 * @param {Object} options
 * @param {number=} attempts
 * @return {Promise<Response>}
 */
async function fetchRetry(url, options, attempts) {
  const total = attempts || 3;
  let lastError = null;
  for (let i = 0; i < total; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (i < total - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastError;
}

/**
 * Один запрос к API без повторов.
 * @param {string} action
 * @param {Object} payload
 * @param {string} token
 * @return {Promise<Object>}
 */
async function callApiOnce(action, payload, token) {
  const body = JSON.stringify({ action, token: token || '', payload: payload || {} });

  const first = await fetchRetry(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    redirect: 'manual'
  });

  // Прямой ответ (без редиректа) — например, при ошибке на стороне Google.
  if (first.status >= 200 && first.status < 300) {
    const text = await first.text();
    return safeJson(text);
  }

  const location = first.headers.get('location');
  if (!location) {
    const text = await first.text();
    return { ok: false, error: 'Нет адреса перенаправления (HTTP ' + first.status + ')', raw: text.slice(0, 300) };
  }

  const second = await fetchRetry(location, { method: 'GET', redirect: 'follow' });
  const text = await second.text();
  return safeJson(text);
}

/**
 * Запрос к API с повтором.
 * Помимо сетевых обрывов повторяем случай, когда Google отдал не JSON:
 * на длинных прогонах это случается и не связано с логикой приложения.
 * @param {string} action
 * @param {Object} payload
 * @param {string} token
 * @param {number=} attempts
 * @return {Promise<Object>}
 */
async function callApi(action, payload, token, attempts) {
  const total = attempts || 3;
  let last = null;

  for (let i = 0; i < total; i++) {
    try {
      last = await callApiOnce(action, payload, token);
      if (!last || last.raw === undefined) return last;
    } catch (err) {
      last = { ok: false, error: err.message };
    }
    if (i < total - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
  }
  return last;
}

/** Разбор JSON с запасным вариантом. */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Ответ не является JSON', raw: String(text).slice(0, 400) };
  }
}

/**
 * Загрузка самостоятельной HTML-страницы приложения (кабинет клиента, отчёт).
 * Идёт по GET и не требует токена сессии — только токен объекта.
 * @param {string} url
 * @return {Promise<{status: number, text: string}>}
 */
async function fetchPage(url) {
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  return { status: res.status, text: await res.text() };
}

module.exports = { callApi, fetchPage, API_URL };

/* --- Запуск из командной строки --- */
if (require.main === module) {
  const action = process.argv[2] || 'health';
  const payload = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const token = process.argv[4] || '';
  callApi(action, payload, token)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res && res.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('Ошибка вызова:', err.message);
      process.exit(1);
    });
}
