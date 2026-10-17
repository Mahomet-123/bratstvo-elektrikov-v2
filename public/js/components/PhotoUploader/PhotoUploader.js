/**
 * ============================================================================
 * Компонент: PhotoUploader
 * Ответственность: съёмка и выбор фотографий накладной с сжатием прямо
 *                  на телефоне. Фотографий может быть несколько: снимки
 *                  собираются в список, показываются превью, ненужные
 *                  убираются до сохранения закупки.
 *
 *                  На сервер уходит снимок длинной стороной до 1600 px и весом
 *                  около 300 КБ — такой проходит даже по слабому мобильному
 *                  интернету. Формат — WebP, с запасным JPEG для браузеров,
 *                  которые не умеют писать WebP (там холст молча отдаёт PNG,
 *                  поэтому формат ответа проверяется, а не предполагается).
 *
 *                  Камера и галерея — РАЗНЫЕ поля выбора файла. Одно поле
 *                  с признаком capture на части телефонов открывает галерею
 *                  вместо камеры, поэтому кнопки разделены: у камеры своё
 *                  поле с capture, у галереи — своё, с выбором нескольких.
 *
 * Зависимости: config, core/dom, core/styles, core/icons, core/format,
 *              core/toast
 * ============================================================================
 */

import { h, setContent } from '../../core/dom.js';
import { loadStyles } from '../../core/styles.js';
import { iconSvg } from '../../core/icons.js';
import { fileSize } from '../../core/format.js';
import { toastError, toastWarning } from '../../core/toast.js';
import { CONFIG } from '../../config.js';

/** Форматы сжатия по убыванию предпочтения. */
const MIME_PLAN = ['image/webp', 'image/jpeg'];

/** Сколько раз уменьшаем снимок, если он всё ещё тяжелее цели. */
const MAX_ATTEMPTS = 4;

/** Ниже этой длинной стороны уменьшать нельзя — накладную не прочитать. */
const MIN_SIDE = 640;

/** Сколько фотографий помещается в одну закупку. */
const MAX_PHOTOS = 8;

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
 * Создание блока загрузки фотографий.
 * @param {Object=} props
 * @param {Function=} props.onChange — вызывается со списком фотографий
 * @param {string=} props.hint — подсказка под кнопками
 * @param {number=} props.maxPhotos — сколько снимков помещается
 * @return {Object} { el, getPhotos, setPhotos, getPhoto, clear, isBusy, destroy }
 */
export function createPhotoUploader(props) {
  const options = props || {};
  const limits = Object.assign({}, CONFIG.PHOTO, options.limits || {});
  const maxPhotos = options.maxPhotos || MAX_PHOTOS;

  /** Список фотографий: { name, mime, size, data, preview, width, height }. */
  let photos = [];
  /** Сколько снимков сейчас сжимается. */
  let busyCount = 0;
  let destroyed = false;

  // Камера: своё поле с признаком capture — телефон открывает съёмку.
  const cameraInput = h('input.photo-uploader__input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    'aria-hidden': 'true',
    tabindex: '-1',
    onchange: () => {
      takeFiles(cameraInput.files);
      // Сбрасываем поле: иначе повторная съёмка того же кадра не сработает.
      cameraInput.value = '';
    }
  });

  // Галерея: без capture, зато можно выбрать сразу несколько снимков.
  const galleryInput = h('input.photo-uploader__input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    'aria-hidden': 'true',
    tabindex: '-1',
    onchange: () => {
      takeFiles(galleryInput.files);
      galleryInput.value = '';
    }
  });

  const box = h('div.photo-uploader__box');
  const el = h('div.photo-uploader', cameraInput, galleryInput, box);

  /** Сообщить наружу о смене списка. */
  function notify() {
    if (typeof options.onChange === 'function') options.onChange(photos.slice());
  }

  /** Блок «идёт сжатие». */
  function busyBlock(text) {
    return h('div.photo-uploader__busy',
      h('span.spinner'),
      h('span.photo-uploader__busy-text', { text: text })
    );
  }

  /** Одно превью с кнопкой удаления. */
  function renderItem(photo, index) {
    return h('div.photo-uploader__item',
      h('img.photo-uploader__thumb', {
        src: photo.preview,
        alt: 'Накладная ' + (index + 1),
        loading: 'lazy'
      }),
      h('span.photo-uploader__item-meta', {
        text: fileSize(photo.size) + ' · ' + (photo.mime === 'image/webp' ? 'WebP' : 'JPEG')
      }),
      h('button.photo-uploader__remove', {
        type: 'button',
        'aria-label': 'Убрать это фото',
        title: 'Убрать это фото',
        onclick: () => removeAt(index)
      }, h('span', { html: iconSvg('close', 16) }))
    );
  }

  /** Отрисовка блока. */
  function render() {
    setContent(box);

    if (photos.length) {
      box.appendChild(h('div.photo-uploader__grid',
        photos.map((photo, index) => renderItem(photo, index))
      ));
    }

    if (busyCount > 0) {
      box.appendChild(busyBlock(busyCount === 1
        ? 'Сжимаем фотографию…'
        : 'Сжимаем фотографии: осталось ' + busyCount));
    }

    box.appendChild(h('div.photo-uploader__buttons',
      h('button.btn.btn--ghost.btn--block', {
        type: 'button',
        onclick: () => cameraInput.click()
      },
        h('span.btn__icon', { html: iconSvg('camera', 18) }),
        photos.length ? 'Снять ещё' : 'Снять накладную'
      ),
      h('button.btn.btn--ghost.btn--block', {
        type: 'button',
        onclick: () => galleryInput.click()
      },
        h('span.btn__icon', { html: iconSvg('image', 18) }),
        'Из галереи'
      )
    ));

    box.appendChild(h('span.photo-uploader__hint', {
      text: photos.length
        ? 'Снимков: ' + photos.length + ' из ' + maxPhotos + '. Ненужный уберите крестиком.'
        : (options.hint || 'Фото уменьшаются на телефоне — загружаются быстро')
    }));
  }

  /**
   * Обработка выбранных или снятых файлов.
   * @param {FileList} fileList
   */
  async function takeFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []).filter((file) => {
      if (file.type && file.type.indexOf('image/') !== 0) {
        toastError('Это не изображение: ' + (file.name || 'файл'));
        return false;
      }
      return true;
    });

    if (!files.length) return;

    const room = maxPhotos - photos.length;
    if (room <= 0) {
      toastWarning('К одной закупке можно приложить не больше ' + maxPhotos + ' фото');
      return;
    }

    const accepted = files.slice(0, room);
    if (accepted.length < files.length) {
      toastWarning('Взяли ' + accepted.length + ' фото — больше ' + maxPhotos + ' к одной закупке не приложить');
    }

    busyCount += accepted.length;
    render();

    // Сжимаем по одному: так память не скачет даже на слабом телефоне.
    for (let i = 0; i < accepted.length; i++) {
      try {
        const result = await compressImage(accepted[i], limits);
        const base64 = await toBase64(result.blob);
        if (destroyed) return;

        photos.push({
          name: accepted[i].name || ('Накладная ' + (photos.length + 1)),
          mime: result.mime,
          size: result.blob.size,
          width: result.width,
          height: result.height,
          data: base64,
          preview: 'data:' + result.mime + ';base64,' + base64
        });
      } catch (error) {
        if (!destroyed) toastError(error.message || 'Не удалось обработать фотографию');
      } finally {
        busyCount -= 1;
      }
    }

    if (destroyed) return;
    render();
    notify();
  }

  /** Убрать одно фото. */
  function removeAt(index) {
    photos.splice(index, 1);
    render();
    notify();
  }

  /** Убрать все фотографии. */
  function clear() {
    photos = [];
    busyCount = 0;
    render();
    notify();
  }

  /**
   * Подставить готовый список (например, из черновика).
   * @param {Array|null} list
   */
  function setPhotos(list) {
    photos = Array.isArray(list) ? list.slice() : [];
    render();
    notify();
  }

  loadStyles('js/components/PhotoUploader/styles/PhotoUploader.css');
  render();

  return {
    el: el,
    getPhotos: () => photos.slice(),
    // Старое имя оставлено для мест, которым нужно только первое фото.
    getPhoto: () => photos[0] || null,
    setPhotos: setPhotos,
    setPhoto: (value) => setPhotos(value ? [value] : []),
    clear: clear,
    isBusy: () => busyCount > 0,
    destroy: () => {
      destroyed = true;
    }
  };
}

export default createPhotoUploader;
