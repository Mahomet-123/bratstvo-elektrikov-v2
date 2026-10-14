#!/usr/bin/env node
/**
 * ============================================================================
 * Сборка иконок приложения из одного источника (public/icon.svg).
 *
 * Зачем скрипт, а не готовые PNG: значок меняется вместе с фирменным стилем,
 * и держать три нарисованных вручную файла — значит рано или поздно получить
 * расхождение между ними. Здесь значок один, а размеры нарезаются из него.
 *
 * Рисует настоящий Chrome (puppeteer-core): SVG разбирается движком браузера,
 * поэтому результат совпадает с тем, что видит пользователь.
 *
 * Что получается:
 *   icons/icon-192.png            — основной значок 192×192 (прозрачные углы)
 *   icons/icon-512.png            — основной значок 512×512 (прозрачные углы)
 *   icons/icon-maskable-512.png   — значок для Android: фон во весь квадрат,
 *                                   логотип уменьшен под «безопасную зону»
 *
 * Запуск: node scripts/make-icons.js
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PUBLIC = path.resolve(__dirname, '..', 'public');
const SOURCE = path.join(PUBLIC, 'icon.svg');
const OUT = path.join(PUBLIC, 'icons');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/**
 * Значок для Android-маски: фон занимает весь квадрат, а логотип уменьшен —
 * система обрежет края по своей форме, и логотип не должен пострадать.
 * Масштаб подобран так, чтобы логотип остался внутри круга 80 % диаметра.
 */
const MASKABLE = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
  '<rect width="512" height="512" fill="#1657c4"/>',
  '<g transform="translate(256 256) scale(0.78) translate(-250 -256)">',
  '<path d="M96 268h84l30-92 46 176 40-118 22 34h98" fill="none" stroke="#f2a20c"',
  ' stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M300 92 196 300h72l-24 120 128-216h-76z" fill="#ffd166" opacity="0.95"/>',
  '</g>',
  '</svg>'
].join('\n');

/** Что и в каком размере нарезаем. */
const TARGETS = [
  { file: 'icon-192.png', size: 192, transparent: true },
  { file: 'icon-512.png', size: 512, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, transparent: false }
];

/** HTML-обёртка: SVG вписан в квадрат без полей. */
function pageHtml(svg, size) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:transparent}' +
    'svg{display:block;width:' + size + 'px;height:' + size + 'px}' +
    '</style></head><body>' + svg + '</body></html>';
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Не найден исходный значок: ' + SOURCE);
    process.exit(1);
  }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const source = fs.readFileSync(SOURCE, 'utf8');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1']
  });

  try {
    for (const target of TARGETS) {
      const page = await browser.newPage();
      await page.setViewport({ width: target.size, height: target.size, deviceScaleFactor: 1 });
      await page.setContent(pageHtml(target.transparent ? source : MASKABLE, target.size), {
        waitUntil: 'load'
      });

      const file = path.join(OUT, target.file);
      await page.screenshot({
        path: file,
        type: 'png',
        omitBackground: Boolean(target.transparent),
        clip: { x: 0, y: 0, width: target.size, height: target.size }
      });
      await page.close();

      const stat = fs.statSync(file);
      console.log('  ок   ' + target.file + ' — ' + target.size + '×' + target.size +
        ', ' + Math.round(stat.size / 1024) + ' КБ');
    }
  } finally {
    await browser.close();
  }

  console.log('\nЗначки собраны в ' + path.relative(process.cwd(), OUT));
}

main().catch((error) => {
  console.error('\nНе удалось собрать значки:', error.message);
  process.exit(1);
});
