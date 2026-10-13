/**
 * ============================================================================
 * Модуль: logger
 * Ответственность: журнал событий клиента, перехват необработанных ошибок
 *                  и отправка их на сервер — чтобы сбои не терялись.
 * Зависимости: нет (отправка подключается снаружи через setSender)
 * ============================================================================
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Порог: сообщения ниже этого уровня не пишутся. */
let threshold = LEVELS.debug;

/** Кольцевой буфер последних сообщений. */
const buffer = [];
const BUFFER_LIMIT = 200;

/** Функция отправки ошибки на сервер, устанавливается приложением. */
let sender = null;

/** Установка обработчика отправки на сервер. */
export function setSender(fn) {
  sender = typeof fn === 'function' ? fn : null;
}

/** Изменить уровень подробности. */
export function setLevel(level) {
  if (LEVELS[level]) threshold = LEVELS[level];
}

/** Запись сообщения. */
function write(level, message, details) {
  if (LEVELS[level] < threshold) return;

  const entry = {
    at: new Date().toISOString(),
    level: level,
    message: String(message),
    details: details === undefined ? null : details
  };

  buffer.push(entry);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();

  const method = level === 'debug' ? 'log' : level;
  if (console && typeof console[method] === 'function') {
    if (details === undefined) console[method]('[БЭ]', message);
    else console[method]('[БЭ]', message, details);
  }

  // Ошибки уходят на сервер, чтобы руководитель видел сбои.
  if (level === 'error' && sender) {
    try {
      sender(entry);
    } catch (error) {
      /* отправка не должна ломать приложение */
    }
  }
}

export const log = {
  debug(message, details) {
    write('debug', message, details);
  },
  info(message, details) {
    write('info', message, details);
  },
  warn(message, details) {
    write('warn', message, details);
  },
  error(message, details) {
    write('error', message, details);
  },
  /** Последние сообщения — для диагностики. */
  history() {
    return buffer.slice();
  }
};

/**
 * Перехват глобальных ошибок и отклонённых промисов.
 * Вызывается один раз при запуске приложения.
 */
export function installGlobalHandlers() {
  window.addEventListener('error', (event) => {
    log.error('Необработанная ошибка: ' + (event.message || 'неизвестно'), {
      file: event.filename,
      line: event.lineno
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    log.error('Необработанный отказ промиса: ' + (reason && reason.message ? reason.message : String(reason)), {
      stack: reason && reason.stack ? String(reason.stack).slice(0, 400) : ''
    });
  });
}
