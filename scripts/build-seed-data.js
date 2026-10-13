#!/usr/bin/env node
/**
 * ============================================================================
 * Генерация backend/SeedData.gs из backend/seed/price.json.
 *
 * Apps Script не умеет читать файлы репозитория, поэтому данные прайса
 * попадают в проект как отдельный модуль-константа. Файл создаётся
 * автоматически — править его руками не нужно.
 *
 * Запуск: npm run seed:data
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'backend', 'seed', 'price.json');
const OUT = path.join(ROOT, 'backend', 'SeedData.gs');

if (!fs.existsSync(SRC)) {
  console.error('Не найден ' + path.relative(ROOT, SRC) + '. Сначала разберите прайс: npm run seed');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const items = data.items || [];
const meta = data.meta || {};

const lines = [];
lines.push('/**');
lines.push(' * ============================================================================');
lines.push(' * Модуль: SeedData');
lines.push(' * Ответственность: данные прайса для первичной инициализации таблицы.');
lines.push(' * ФАЙЛ СГЕНЕРИРОВАН автоматически скриптом scripts/build-seed-data.js.');
lines.push(' * Править вручную бессмысленно — изменения потеряются при следующей сборке.');
lines.push(' *');
lines.push(' * Источник: ' + (meta.source || 'price.json'));
lines.push(' * Разобрано: ' + (meta.parsedAt || '—'));
lines.push(' * Позиций: ' + items.length +
  ' (работы ' + (meta.works || 0) +
  ', коэффициенты ' + (meta.coefficients || 0) +
  ', проценты ' + (meta.percents || 0) +
  ', примечания ' + (meta.notes || 0) + ')');
lines.push(' * ============================================================================');
lines.push(' */');
lines.push('');
lines.push('const PRICE_SEED_ = ' + JSON.stringify({ meta: meta, items: items }, null, 1) + ';');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log('Создан ' + path.relative(ROOT, OUT).replace(/\\/g, '/') + ' — ' + items.length + ' позиций, ' + sizeKb + ' КБ');
