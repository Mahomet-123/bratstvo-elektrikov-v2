/**
 * ============================================================================
 * Компонент: PhotoUploader
 * Ответственность: съёмка или выбор фотографии накладной и её сжатие прямо
 *                  на телефоне. На сервер уходит снимок длинной стороной
 *                  до 1600 px и весом около 300 КБ — такой проходит даже
 *                  по слабому мобильному интернету.
 *                  Формат — WebP, с запасным JPEG для браузеров, которые
 *                  не умеют писать WebP (там холст молча отдаёт PNG,
 *                  поэтому формат ответа проверяется, а не предполагается).
 * Зависимости: config, core/dom, core/styles, core/icons, core/format,
 *              core/toast
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { fileSize } from '../../core/format.js';
import { toastError } from '../../core/toast.js';
import { CONFIG } from '../../config.js';

/** Форматы сжатия по убыванию предпочтения. */
const MIME_PLAN = ['image/webp', 'image/jpeg'];

/** Сколько раз уменьшаем снимок, если он всё ещё тяжелее цели. */
const MAX_ATTEMPTS = 4;

/** Ниже этой длинной стороны уменьшать нельзя — накладную не прочитать. */
const MIN_SIDE = 640;

/* --------------------------------------------------------------------------
 * Сжатие
 * ------------------------------------------------------------------------ */

/**
 * Чтение файла как изображения.
 * @param {File|Blob} file
 * @return {Promise<ImageBitmap|HTMLImageElement>}
 */
function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    // Поворот по EXIF учитываем сразу: иначе фото с телефона ляжет на бок.
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(() => loadImageElement(file));
  }
  return loadImageElement(file);
}

/**
 * Запасной путь чтения: обычный <img> из ссылки на файл.
 * @param {File|Blob} file
 * @return {Promise<HTMLImageElement>}
 */
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Файл не похож на изображение'));
    };
    image.src = url;
  });
}

/** Размеры исходного изображения. */
function sourceSize(image) {
  return {
    width: image.width || image.naturalWidth || 0,
    height: image.height || image.naturalHeight || 0
  };
}

/**
 * Отрисовка уменьшенной копии на холсте.
 * @param {ImageBitmap|HTMLImageElement} image
 * @param {number} maxSide
 * @return {HTMLCanvasElement}
 */
function drawScaled(image, maxSide) {
  const src = sourceSize(image);
  const longest = Math.max(src.width, src.height) || 1;
  const factor = Math.min(1, maxSide / longest);
  const width = Math.max(1, Math.round(src.width * factor));
  const height = Math.max(1, Math.round(src.height * factor));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  // Белая подложка: прозрачные участки в JPEG иначе станут чёрными.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

/**
 * Кодирование холста в нужный формат.
 * @param {HTMLCanvasElement} canvas
 * @param {string} mime
 * @param {number} quality
 * @return {Promise<Blob|null>} null — браузер этот формат не умеет
 */
function encode(canvas, mime, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    try {
      canvas.toBlob((blob) => {
        // Браузер вправе подменить формат (чаще всего на PNG) — тогда
        // делаем вид, что кодирование не удалось, и пробуем следующий.
        resolve(blob && blob.type === mime ? blob : null);
      }, mime, quality);
    } catch (error) {
      resolve(null);
    }
  });
}

/**
 * Подбор качества под целевой вес.
 * @param {HTMLCanvasElement} canvas
 * @param {string} mime
 * @param {Object} limits — CONFIG.PHOTO
 * @return {Promise<Blob|null>}
 */
async function fitQuality(canvas, mime, limits) {
  const steps = 6;
  const from = limits.MAX_QUALITY;
  const to = limits.MIN_QUALITY;
  let smallest = null;

  for (let i = 0; i < steps; i++) {
    const quality = Math.max(to, from - (from - to) * (i / (steps - 1)));
    const blob = await encode(canvas, mime, quality);
    if (!blob) return null;
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= limits.TARGET_BYTES) return blob;
  }
  return smallest;
}

/**
 * Сжатие фотографии: подбор формата, размера и качества.
 * @param {File|Blob} file
 * @param {Object=} limits — CONFIG.PHOTO
 * @return {Promise<{blob: Blob, mime: string, width: number, height: number}>}
 */
export async function compressImage(file, limits) {
  const config = limits || CONFIG.PHOTO;
  const image = await loadImage(file);

  let scale = 1;
  let best = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const maxSide = Math.max(MIN_SIDE, Math.round(config.MAX_SIDE * scale));
    const canvas = drawScaled(image, maxSide);
    let found = null;

    for (let i = 0; i < MIME_PLAN.length; i++) {
      const mime = MIME_PLAN[i];
      const blob = await fitQuality(canvas, mime, config);
      if (!blob) continue;
      if (!found || blob.size < found.blob.size) found = { blob: blob, mime: mime };
      if (blob.size <= config.TARGET_BYTES) break;
    }

    if (found && (!best || found.blob.size < best.blob.size)) {
      best = {
        blob: found.blob,
        mime: found.mime,
        width: canvas.width,
        height: canvas.height
      };
    }
    if (best && best.blob.size <= config.TARGET_BYTES) break;
    if (maxSide <= MIN_SIDE) break;
    scale *= 0.75;
  }

  if (image.close) {
    try {
      image.close();
    } catch (error) {
      /* не критично */
    }
  }

  if (!best) throw new Error('Не удалось сжать фотографию на этом устройстве');
  if (best.blob.size > config.MAX_BYTES) {
    throw new Error('Фотография всё ещё большая: ' + fileSize(best.blob.size) +
      '. Снимите с большего расстояния или выберите готовый файл.');
  }
  return best;
}

/**
 * Blob → base64 без префикса data-url (именно этого ждёт сервер).
 * @param {Blob} blob
 * @return {Promise<string>}
 */
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const index = text.indexOf(',');
      resolve(index === -1 ? text : text.slice(index + 1));
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(blob);
  });
}

/* --------------------------------------------------------------------------
 * Компонент
 * ------------------------------------------------------------------------ */

/**
 * Создание блока загрузки фото.
 * @param {Object=} props
 * @param {Function=} props.onChange — вызывается с фотографией или null
 * @param {string=} props.hint — подсказка под кнопкой
 * @return {Object} { el, getPhoto, setPhoto, clear, busy, destroy }
 */
export function createPhotoUploader(props) {
  const options = props || {};
  const limits = Object.assign({}, CONFIG.PHOTO, options.limits || {});

  /** Текущая фотография: { name, mime, size, data, preview, width, height }. */
  let photo = null;
  let busy = false;
  let destroyed = false;

  const input = h('input.photo-uploader__input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    'aria-hidden': 'true',
    tabindex: '-1',
    onchange: () => {
      const files = input.files;
      if (files && files.length) handleFiles(files[0]);
      // Сбрасываем поле: иначе повторный выбор того же файла не сработает.
      input.value = '';
    }
  });

  const box = h('div.photo-uploader__box');
  const el = h('div.photo-uploader', input, box);

  /** Сообщить наружу о смене фотографии. */
  function notify() {
    if (typeof options.onChange === 'function') options.onChange(photo);
  }

  /** Отрисовка текущего состояния блока. */
  function render() {
    if (busy) {
      setContent(box,
        h('div.photo-uploader__busy',
          h('span.spinner'),
          h('span.photo-uploader__busy-text', { text: 'Сжимаем фотографию…' })
        )
      );
      return;
    }

    if (!photo) {
      setContent(box,
        h('button.photo-uploader__pick', {
          type: 'button',
          onclick: () => input.click()
        },
          h('span.photo-uploader__pick-icon', { html: iconSvg('camera', 24) }),
          h('span.photo-uploader__pick-text', { text: 'Сфотографировать накладную' }),
          h('span.photo-uploader__pick-hint', {
            text: options.hint || 'Фото уменьшится на телефоне — загрузится быстро'
          })
        )
      );
      return;
    }

    setContent(box,
      h('div.photo-uploader__preview',
        h('img.photo-uploader__thumb', { src: photo.preview, alt: 'Фото накладной' }),
        h('div.photo-uploader__meta',
          h('div.photo-uploader__size', { text: fileSize(photo.size) }),
          h('div.photo-uploader__format', {
            text: photo.mime === 'image/webp' ? 'WebP' : 'JPEG'
          }),
          h('div.photo-uploader__actions',
            h('button.btn.btn--quiet.btn--sm', {
              type: 'button',
              onclick: () => input.click()
            }, 'Переснять'),
            h('button.btn.btn--quiet.btn--sm', {
              type: 'button',
              onclick: clear
            }, 'Убрать')
          )
        )
      )
    );
  }

  /**
   * Обработка выбранного файла.
   * @param {File} file
   */
  async function handleFiles(file) {
    if (!file) return;

    if (file.type && file.type.indexOf('image/') !== 0) {
      toastError('Это не изображение. Выберите фотографию накладной.');
      return;
    }

    busy = true;
    render();

    try {
      const result = await compressImage(file, limits);
      // Читаем blob один раз: base64 и превью собираются из одной строки.
      const base64 = await toBase64(result.blob);
      if (destroyed) return;

      photo = {
        name: file.name || 'Накладная',
        mime: result.mime,
        size: result.blob.size,
        width: result.width,
        height: result.height,
        data: base64,
        preview: 'data:' + result.mime + ';base64,' + base64
      };
    } catch (error) {
      if (!destroyed) toastError(error.message || 'Не удалось обработать фотографию');
    } finally {
      if (!destroyed) {
        busy = false;
        render();
        notify();
      }
    }
  }

  /** Убрать фотографию. */
  function clear() {
    photo = null;
    render();
    notify();
  }

  /**
   * Подставить готовую фотографию (например, из черновика).
   * @param {Object|null} value
   */
  function setPhoto(value) {
    photo = value || null;
    render();
    notify();
  }

  loadStyles('js/components/PhotoUploader/styles/PhotoUploader.css');
  render();

  return {
    el: el,
    getPhoto: () => photo,
    setPhoto: setPhoto,
    clear: clear,
    isBusy: () => busy,
    destroy: () => {
      destroyed = true;
    }
  };
}

export default createPhotoUploader;
