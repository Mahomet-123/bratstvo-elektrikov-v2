/**
 * ============================================================================
 * Модуль: sw (service worker)
 * Ответственность: офлайн-работа приложения — предварительное кэширование
 *                  оболочки, кэширование статики при первом обращении и
 *                  отдача из кэша, когда сети нет.
 *                  Запросы к API никогда не кэшируются.
 * Зависимости: нет
 * ============================================================================
 */

const VERSION = 'v2.5.0';
const CACHE_STATIC = 'be-static-' + VERSION;
const CACHE_RUNTIME = 'be-runtime-' + VERSION;

/** Файлы, без которых приложение не запустится офлайн. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './js/app.js',
  './js/config.js',
  './js/core/dom.js',
  './js/core/format.js',
  './js/core/icons.js',
  './js/core/logger.js',
  './js/core/modal.js',
  './js/core/router.js',
  './js/core/store.js',
  './js/core/bundle.js',
  './js/core/busy.js',
  './js/core/objectCache.js',
  './js/core/styles.js',
  './js/core/toast.js',
  './js/core/estimate.js',
  './js/core/queue.js',
  './js/core/sync.js',
  './js/core/clipboard.js',
  './js/api/apiClient.js',
  './js/api/endpoints.js',
  './js/components/common/badges.js',
  './js/components/Login/Login.js',
  './js/components/Login/styles/Login.css',
  './js/components/AppShell/AppShell.js',
  './js/components/AppShell/styles/AppShell.css',
  './js/components/Profile/Profile.js',
  './js/components/Profile/styles/Profile.css',
  './js/components/SyncIndicator/SyncIndicator.js',
  './js/components/SyncIndicator/styles/SyncIndicator.css',
  './js/components/ObjectsList/ObjectsList.js',
  './js/components/ObjectsList/styles/ObjectsList.css',
  './js/components/ObjectForm/ObjectForm.js',
  './js/components/ObjectForm/styles/ObjectForm.css',
  './js/components/ObjectCard/ObjectCard.js',
  './js/components/ObjectCard/styles/ObjectCard.css',
  './js/components/Calculator/Calculator.js',
  './js/components/Calculator/CalcPicker.js',
  './js/components/Calculator/styles/Calculator.css',
  './js/components/DaysJournal/DaysJournal.js',
  './js/components/DaysJournal/styles/DaysJournal.css',
  './js/components/Purchases/Purchases.js',
  './js/components/Purchases/styles/Purchases.css',
  './js/components/PhotoUploader/PhotoUploader.js',
  './js/components/PhotoUploader/styles/PhotoUploader.css',
  './js/components/Report/Report.js',
  './js/components/Report/styles/Report.css',
  './js/components/Cabinet/Cabinet.js',
  './js/components/Cabinet/styles/Cabinet.css',
  './js/components/Analytics/Analytics.js',
  './js/components/Analytics/styles/Analytics.css',
  './js/components/Archive/Archive.js',
  './js/components/Archive/styles/Archive.css',
  './js/components/Brigade/Brigade.js',
  './js/components/Brigade/styles/Brigade.css',
  './js/components/Visits/Visits.js',
  './js/components/Visits/styles/Visits.css'
];

/** Адреса API — их кэшировать нельзя ни в каком виде. */
const API_HOSTS = ['script.google.com', 'script.googleusercontent.com'];

/* --- Установка ---------------------------------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      // Каждый файл кэшируем отдельно: отсутствие одного не ломает установку.
      return Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            // Файл может отсутствовать на этой версии — это не повод падать.
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* --- Активация ---------------------------------------------------------- */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_STATIC && key !== CACHE_RUNTIME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

/* --- Обработка запросов ------------------------------------------------- */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Не-GET запросы (в том числе POST к API) пропускаем напрямую.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  // API всегда идёт в сеть.
  if (API_HOSTS.indexOf(url.hostname) !== -1) return;

  // Сторонние ресурсы не трогаем.
  if (url.origin !== self.location.origin) return;

  // Переходы по страницам: сеть, при отсутствии — кэшированная оболочка.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_STATIC).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || offlineResponse()))
    );
    return;
  }

  // Статика: сначала кэш, параллельно обновляем копию.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_RUNTIME).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || network;
    })
  );
});

/** Запасной ответ, если офлайн и оболочки в кэше нет. */
function offlineResponse() {
  const html = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Нет сети</title></head><body style="font:16px system-ui;padding:32px;text-align:center;color:#16202e">' +
    '<h1 style="font-size:20px">Нет сети</h1>' +
    '<p style="color:#6b7688">Откройте приложение, когда появится интернет — дальше оно будет работать офлайн.</p>' +
    '</body></html>';
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* --- Сообщения от приложения -------------------------------------------- */

self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'skipWaiting') {
    self.skipWaiting();
  }

  if (data.type === 'clearCache') {
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  }
});
