#!/usr/bin/env node
/**
 * ============================================================================
 * Локальный статический сервер для проверки PWA перед публикацией.
 * Отдаёт содержимое public/ так же, как это делает GitHub Pages.
 *
 * Запуск: npm run serve   → http://localhost:4173
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(ROOT, pathname);

  // Защита от выхода за пределы каталога.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Доступ запрещён');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Неизвестный адрес — отдаём index.html (как SPA-фолбэк).
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404).end('Не найдено');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
      });
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/'
    }).end(data);
  });
});

server.listen(PORT, () => {
  console.log('Локальный сервер: http://localhost:' + PORT);
  console.log('Каталог: ' + ROOT);
});
