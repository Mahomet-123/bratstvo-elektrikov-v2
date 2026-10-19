/**
 * ============================================================================
 * Компонент: Camera
 * Ответственность: съёмка через камеру устройства — прямо в приложении.
 *
 *                  Признак capture у поля выбора файла работает на телефонах,
 *                  а на ноутбуке браузер его игнорирует и открывает выбор
 *                  файла. Поэтому камеру берём через getUserMedia: живой
 *                  предпросмотр, кнопка «Снять», несколько кадров подряд
 *                  и удаление ненужных до сохранения.
 *
 *                  Если камера недоступна (нет устройства, запрет, не тот
 *                  протокол), сообщаем об этом — вызывающий сам решит, что
 *                  делать: показать обычное поле выбора файла.
 * Зависимости: core/dom, core/styles, core/icons, core/toast
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { toastError } from '../../core/toast.js';

/** Сколько кадров разрешаем сделать за один заход. */
const MAX_SHOTS = 8;

/**
 * Есть ли у устройства камера, доступная странице.
 * @return {boolean}
 */
export function cameraAvailable() {
  return Boolean(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * Кадр с видеопотока в blob.
 * @param {HTMLVideoElement} video
 * @return {Promise<Blob|null>}
 */
function grabFrame(video) {
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  if (!width || !height) return Promise.resolve(null);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);

  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.92);
    } catch (error) {
      resolve(null);
    }
  });
}

/**
 * Открыть камеру и вернуть снимки.
 *
 * Возвращает объект: { supported, shots }. Если supported === false —
 * камеру взять не удалось, и вызывающий должен предложить выбор файла.
 *
 * @param {Object=} options — { maxShots, title }
 * @return {Promise<{supported: boolean, shots: Array<Blob>}>}
 */
export function takePhotos(options) {
  const config = options || {};
  const limit = Math.max(1, Math.min(config.maxShots || MAX_SHOTS, MAX_SHOTS));

  return new Promise((resolve) => {
    const shots = [];
    let stream = null;
    let closed = false;

    const video = h('video.camera__video', {
      autoplay: 'autoplay',
      playsinline: 'playsinline',
      muted: 'muted'
    });

    const grid = h('div.camera__grid');
    const counter = h('div.camera__counter');
    const shutter = h('button.camera__shutter', {
      type: 'button',
      'aria-label': 'Снять кадр'
    }, h('span.camera__shutter-inner'));

    const doneBtn = h('button.btn.btn--primary.btn--block', {
      type: 'button',
      onclick: () => finish(true)
    }, 'Готово');

    const cancelBtn = h('button.btn.btn--ghost.btn--block', {
      type: 'button',
      onclick: () => finish(false)
    }, 'Отмена');

    const box = h('div.camera',
      h('div.camera__stage', video),
      counter,
      grid,
      h('div.camera__controls', shutter),
      h('div.camera__actions', cancelBtn, doneBtn)
    );

    const overlay = h('div.camera-overlay', box);

    /** Остановить камеру и закрыть окно. */
    function finish(accept) {
      if (closed) return;
      closed = true;

      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (error) {
            /* не критично */
          }
        });
      }

      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);

      resolve({ supported: true, shots: accept ? shots.slice() : [] });
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    }

    /** Показать счётчик и состояние кнопок. */
    function renderState() {
      counter.textContent = shots.length
        ? 'Снято: ' + shots.length + ' из ' + limit
        : 'Наведите камеру и нажмите кнопку';

      doneBtn.disabled = shots.length === 0;
      shutter.disabled = shots.length >= limit;

      setContent(grid);
      shots.forEach((shot, index) => {
        const url = URL.createObjectURL(shot);
        const item = h('div.camera__shot',
          h('img.camera__shot-img', { src: url, alt: 'Кадр ' + (index + 1) }),
          h('button.camera__shot-remove', {
            type: 'button',
            'aria-label': 'Удалить кадр',
            onclick: () => {
              shots.splice(index, 1);
              URL.revokeObjectURL(url);
              renderState();
            }
          }, h('span', { html: iconSvg('close', 14) }))
        );
        grid.appendChild(item);
      });
    }

    /** Снять кадр. */
    async function shoot() {
      if (shots.length >= limit) return;

      const blob = await grabFrame(video);
      if (!blob) {
        toastError('Кадр не получился — попробуйте ещё раз');
        return;
      }

      shots.push(blob);
      renderState();
    }

    shutter.addEventListener('click', shoot);
    document.addEventListener('keydown', onKey);

    // Камеру просим в обработчике нажатия: браузер требует жест человека.
    if (!cameraAvailable()) {
      resolve({ supported: false, shots: [] });
      return;
    }

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    loadStyles('js/components/Camera/styles/Camera.css');
    renderState();

    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      },
      audio: false
    }).then((media) => {
      if (closed) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = media;
      video.srcObject = media;
      const play = video.play();
      if (play && typeof play.catch === 'function') {
        play.catch(() => {
          /* автозапуск может быть отложен — картинка появится по нажатию */
        });
      }
    }).catch((error) => {
      // Камеру не дали: закрываем окно и говорим вызывающему, что не вышло.
      closed = true;
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      resolve({ supported: false, shots: [], error: error && error.name });
    });
  });
}

export default takePhotos;
