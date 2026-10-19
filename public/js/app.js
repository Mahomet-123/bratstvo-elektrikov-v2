/**
 * ============================================================================
 * Модуль: app
 * Ответственность: запуск приложения — обработка ошибок, регистрация сервис-воркера,
 *                  восстановление сессии, выбор между экраном входа и рабочим
 *                  каркасом, регистрация экранов и запуск навигации.
 * Зависимости: все модули ядра, api, компоненты
 * ============================================================================
 */

import { qs, setContent } from './core/dom.js';
import { log, installGlobalHandlers, setSender } from './core/logger.js';
import { store, loadSession, saveSession, cachePrices, readCachedPrices } from './core/store.js';
import { toastError, toastWarning, toastSuccess } from './core/toast.js';
import { describeError } from './api/apiClient.js';
import { api } from './api/endpoints.js';
import { start as startSync, flushManual } from './core/sync.js';
import bundle from './core/bundle.js';
import { createLogin } from './components/Login/Login.js';
import { createAppShell } from './components/AppShell/AppShell.js';
import { createProfile } from './components/Profile/Profile.js';
import { createObjectsList } from './components/ObjectsList/ObjectsList.js';
import { createObjectScreen } from './components/ObjectForm/ObjectForm.js';
import { createObjectCard } from './components/ObjectCard/ObjectCard.js';
import { createCalculator } from './components/Calculator/Calculator.js';
import { createDaysJournal } from './components/DaysJournal/DaysJournal.js';
import { createPurchases } from './components/Purchases/Purchases.js';
import { createReport } from './components/Report/Report.js';
import { createCabinet } from './components/Cabinet/Cabinet.js';
import { createAnalytics } from './components/Analytics/Analytics.js';
import { createArchive } from './components/Archive/Archive.js';
import { createBrigade } from './components/Brigade/Brigade.js';
import { createVisits } from './components/Visits/Visits.js';
import { createPrices } from './components/Prices/Prices.js';
import { createCabinetPublic, cabinetTokenFromHash, isCabinetHash } from './components/CabinetPublic/CabinetPublic.js';
import { CONFIG } from './config.js';

const root = qs('#app');

/** Ссылки на смонтированные части интерфейса. */
let shell = null;

/* --------------------------------------------------------------------------
 * Запуск
 * ------------------------------------------------------------------------ */

/**
 * Точка входа.
 */
async function start() {
  installGlobalHandlers();
  setSender((entry) => {
    // Сбои клиента уходят в журнал посещений, чтобы их видел руководитель.
    api.visitsLog('ошибка клиента: ' + entry.message).catch(() => {});
  });

  trackConnection();
  registerServiceWorker();

  // Офлайн-очередь работает независимо от входа: накопленные записи уйдут,
  // как только появится связь.
  startSync().catch((error) => {
    log.warn('Очередь отправки не запустилась', error.message);
  });

  // Ссылку клиента могут вставить в уже открытую вкладку: тогда адрес
  // меняется без перезагрузки, и кабинет надо показать сами.
  window.addEventListener('hashchange', () => {
    if (isCabinetHash()) mountPublicCabinet(cabinetTokenFromHash());
  });

  // Короткая ссылка клиента: сразу кабинет, вход не нужен.
  if (isCabinetHash()) {
    mountPublicCabinet(cabinetTokenFromHash());
    return;
  }

  const session = loadSession();
  if (session) {
    // Пакет данных поднимаем из памяти устройства ещё до первого экрана:
    // так приложение открывается мгновенно, а свежее подтянется следом.
    bundle.restore();
    mountShell();
  } else {
    mountLogin();
  }
}

/* --------------------------------------------------------------------------
 * Экран входа
 * ------------------------------------------------------------------------ */

/** Показать экран входа. */
/**
 * Кабинет клиента по короткой ссылке — открывается без входа.
 * Токен из адреса и есть пропуск, поэтому экран живёт отдельно от каркаса.
 */
function mountPublicCabinet(token) {
  if (shell && typeof shell.destroy === 'function') shell.destroy();
  shell = null;

  const screen = createCabinetPublic({ token: token });
  setContent(root, screen.el);
}

function mountLogin() {
  if (shell && typeof shell.destroy === 'function') shell.destroy();
  shell = null;

  const login = createLogin({
    onSuccess: (result) => {
      saveSession({ token: result.token, user: result.user, expires: result.expires }, result.mustChangeCode);
      mountShell();
      if (result.mustChangeCode) {
        toastWarning('Вы вошли под заводским кодом 0000. Смените его в профиле.', 6000);
      }
    }
  });

  setContent(root, login.el);
}

/* --------------------------------------------------------------------------
 * Рабочая область
 * ------------------------------------------------------------------------ */

/** Показать рабочий каркас. */
function mountShell() {
  shell = createAppShell({
    onLogout: () => {
      mountLogin();
    },
    onManualSend: () => {
      sendQueueNow();
    },
    onRefreshData: () => {
      syncNow();
    }
  });

  /** Переход на экран через роутер каркаса. */
  const go = (path, replace) => shell.router.go(path, replace);

  // Регистрация экранов.
  shell.register('/profile', () => createProfile({
    onLogout: () => mountLogin(),
    onNavigate: go,
    onRefreshData: () => syncNow()
  }));

  shell.register('/objects', () => createObjectsList({
    onNavigate: go
  }));

  shell.register('/object/new', () => createObjectScreen({
    onNavigate: go
  }));

  shell.register('/object/:id', (params, tools) => createObjectCard({
    id: params.id,
    onNavigate: go,
    onTitle: (title, subtitle) => tools.setTitle(title, subtitle)
  }));

  shell.register('/object/:id/calc', (params, tools) => createCalculator({
    id: params.id,
    onNavigate: go,
    onTitle: (title, subtitle) => tools.setTitle(title, subtitle)
  }));

  shell.register('/object/:id/days', (params, tools) => createDaysJournal({
    id: params.id,
    onNavigate: go,
    onTitle: (title, subtitle) => tools.setTitle(title, subtitle)
  }));

  shell.register('/object/:id/purchases', (params, tools) => createPurchases({
    id: params.id,
    onNavigate: go,
    onTitle: (title, subtitle) => tools.setTitle(title, subtitle)
  }));

  shell.register('/object/:id/report', (params, tools) => createReport({
    id: params.id,
    onNavigate: go,
    onTitle: (title, subtitle) => tools.setTitle(title, subtitle)
  }));

  shell.register('/cabinet/:id', (params, tools) => createCabinet({
    id: params.id,
    onNavigate: go,
    onTitle: (title, subtitle) => tools.setTitle(title, subtitle)
  }));

  shell.register('/analytics', () => createAnalytics({
    onNavigate: go
  }));

  shell.register('/archive', () => createArchive({
    onNavigate: go
  }));

  shell.register('/brigade', () => createBrigade({
    onNavigate: go
  }));

  shell.register('/visits', () => createVisits({
    onNavigate: go
  }));

  shell.register('/prices', (params, tools) => createPrices({
    onNavigate: go,
    onTitle: (title, subtitle) => tools.setTitle(title, subtitle)
  }));

  setContent(root, shell.el);
  shell.router.start();

  if (store.get().mustChangeCode) {
    shell.router.go('/profile', true);
  }

  logVisit();
  warmUp();
}

/** Ручная отправка накопленных записей из индикатора в шапке. */
async function sendQueueNow() {
  const count = Number(store.get().queueCount) || 0;
  if (!count) {
    toastSuccess('Всё отправлено — очередь пуста');
    return;
  }
  if (!navigator.onLine) {
    toastWarning('Нет сети. Записи уйдут сами, как только появится связь', 5000);
    return;
  }

  toastWarning('Отправляем ' + count + ' ' + (count === 1 ? 'запись' : 'записей') + '…');
  const result = await flushManual();
  const left = Number(result.left) || 0;

  if (left === 0) toastSuccess('Очередь отправлена');
  else if (result.sent > 0) toastWarning('Отправлено: ' + result.sent + ', осталось: ' + left);
  else toastError('Не удалось отправить: ' + (result.stopped || 'проверьте связь'));
}

/**
 * Обновление данных разделов по нажатию на индикатор свежести.
 * Один запрос вместо пяти: объекты, аналитика, бригада, посещения, архив.
 */
async function syncNow() {
  if (!navigator.onLine) {
    toastWarning('Нет сети. Данные обновятся, как только появится связь', 5000);
    return;
  }

  toastWarning('Обновляем данные с сервера…');
  try {
    await bundle.load({ force: true });
    toastSuccess('Данные обновлены');
  } catch (error) {
    toastError('Не удалось обновить данные: ' + describeError(error));
  }
}

/** Отметить вход в журнале посещений — один раз за запуск. */
function logVisit() {
  if (store.get().visitsLogged) return;
  store.patch({ visitsLogged: true });
  api.visitsLog('открыл приложение', {
    user: store.get().user ? store.get().user.name : '',
    role: store.get().user ? store.get().user.role : ''
  }).catch(() => {
    // Журнал посещений не критичен — молча пропускаем.
  });
}

/** Предзагрузка прайса и пакета данных разделов. */
async function warmUp() {
  // Пакет данных: если он уже лежит на устройстве — показываем сразу,
  // а устаревший тихо обновляем.
  bundle.ensure().catch((error) => {
    log.warn('Пакет данных не загрузился', error.message);
  });

  const cached = readCachedPrices();
  if (cached) {
    cachePrices(cached);
    log.info('Прайс взят из кэша: ' + (cached.total || 0) + ' позиций');
  }

  try {
    const fresh = await api.pricesList();
    cachePrices(fresh);
    log.info('Прайс обновлён: ' + (fresh.total || 0) + ' позиций');
  } catch (error) {
    if (!cached) toastError('Не удалось загрузить прайс: ' + describeError(error));
  }
}

/* --------------------------------------------------------------------------
 * Состояние сети
 * ------------------------------------------------------------------------ */

/** Слежение за подключением к сети. */
function trackConnection() {
  const update = () => {
    const online = navigator.onLine;
    const was = store.get().online;
    store.patch({ online: online });
    if (online && !was) toastSuccess('Связь восстановлена');
    if (!online && was) toastWarning('Нет сети — записи сохраняются на телефоне', 5000);
  };

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

/* --------------------------------------------------------------------------
 * Сервис-воркер
 * ------------------------------------------------------------------------ */

/** Регистрация сервис-воркера — основа офлайн-работы. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    log.warn('Сервис-воркер не поддерживается браузером');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js', { scope: './' })
      .then((registration) => {
        log.info('Сервис-воркер зарегистрирован');
        // Проверяем обновления при каждом запуске.
        registration.update().catch(() => {});
      })
      .catch((error) => {
        log.warn('Сервис-воркер не зарегистрирован', error.message);
      });
  });
}

/* --------------------------------------------------------------------------
 * Поехали
 * ------------------------------------------------------------------------ */

start().catch((error) => {
  log.error('Приложение не запустилось', error && error.message);
  setContent(root,
    (() => {
      const box = document.createElement('div');
      box.className = 'page';
      const card = document.createElement('div');
      card.className = 'card';
      const body = document.createElement('div');
      body.className = 'card__body';
      const title = document.createElement('div');
      title.className = 'h2';
      title.textContent = 'Приложение не запустилось';
      const text = document.createElement('p');
      text.className = 'text-muted';
      text.style.marginTop = '8px';
      text.textContent = 'Обновите страницу. Если не поможет — сообщите руководителю: ' +
        (error && error.message ? error.message : 'неизвестная ошибка');
      body.appendChild(title);
      body.appendChild(text);
      card.appendChild(body);
      box.appendChild(card);
      return box;
    })()
  );
});

// Справочно для отладки в консоли браузера.
window.__BRATSTVO__ = { store, CONFIG };
