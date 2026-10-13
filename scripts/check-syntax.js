#!/usr/bin/env node
/**
 * ============================================================================
 * Проверка синтаксиса всех модулей проекта.
 *   backend/*.gs        — скрипты Apps Script (обычные скрипты, разбор как CJS)
 *   public/js/**\/*.js  — ES-модули фронтенда (разбор как ESM)
 *   public/sw.js        — service worker (обычный скрипт)
 *
 * Файлы не собираются и не склеиваются: каждый проверяется отдельно,
 * чтобы модульность оставалась настоящей. Запуск: npm run check
 * ============================================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-check-'));

/** Рекурсивный сбор файлов по расширению. */
function collect(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collect(full, ext, out);
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

/** Проверка одного файла: node --check на копии с нужным расширением. */
function check(file, ext) {
  const target = path.join(TMP, path.basename(file, path.extname(file)) + '-' + Math.random().toString(36).slice(2, 7) + ext);
  fs.copyFileSync(file, target);
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    return { file, ok: true };
  } catch (err) {
    const text = (err.stderr || err.stdout || Buffer.from('')).toString();
    return { file, ok: false, text: text.split('\n').slice(0, 6).join('\n') };
  } finally {
    try { fs.unlinkSync(target); } catch (e) { /* не критично */ }
  }
}

/**
 * Имена, которые модуль отдаёт наружу.
 * Разбор простой: экспорт объявлений, список export {...} и экспорт по умолчанию.
 */
function exportedNames(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  let m;

  const declared = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g;
  while ((m = declared.exec(src))) names.add(m[1]);

  const listed = /export\s*\{([^}]+)\}/g;
  while ((m = listed.exec(src))) {
    m[1].split(',').forEach((part) => {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    });
  }

  if (/export\s+default/.test(src)) names.add('default');
  return names;
}

/**
 * Проверка, что все именованные импорты фронтенда действительно объявлены
 * в целевых модулях. Обычная проверка синтаксиса такое не ловит, а браузер
 * на этом падает целиком — поэтому проверяем отдельно.
 */
function checkImports() {
  const problems = [];
  const files = collect(path.join(ROOT, 'public', 'js'), '.js');

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[2];
      if (!spec.startsWith('.')) continue;

      const target = path.resolve(path.dirname(file), spec);
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');

      if (!fs.existsSync(target)) {
        problems.push(rel + ' → нет файла ' + spec);
        continue;
      }

      const available = exportedNames(target);
      m[1].split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !available.has(name)) {
          problems.push(rel + ' → в ' + spec + ' нет экспорта «' + name + '»');
        }
      });
    }
  }
  return problems;
}

/**
 * Проверка, что все служебные функции бэкенда определены.
 * Apps Script склеивает файлы в один общий контекст, поэтому вызов
 * несуществующей функции вроде `withObjectSheet_()` не ловится ни
 * редактором, ни сборкой — падение происходит только в бою.
 * Здесь собираем все объявления `function имя_()` и константы по всем
 * `.gs` и ищем вызовы вида `имя_(`, которых нет нигде.
 */
function checkBackendSymbols() {
  const files = collect(path.join(ROOT, 'backend'), '.gs');
  const defined = new Set();
  const sources = new Map();

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    sources.set(file, src);
    for (const m of src.matchAll(/^\s*function\s+([A-Za-z0-9_$]+)/gm)) defined.add(m[1]);
    for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)) defined.add(m[1]);
  }

  const problems = [];
  for (const [file, src] of sources) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const re = /(?<![A-Za-z0-9_.$])([A-Za-z0-9_$]+_)\s*\(/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(src))) {
      const name = m[1];
      if (defined.has(name) || seen.has(name)) continue;
      seen.add(name);
      problems.push(rel + ' → нет определения функции «' + name + '()»');
    }
  }
  return problems;
}

const targets = []
  .concat(collect(path.join(ROOT, 'backend'), '.gs').map((f) => ({ f, ext: '.cjs' })))
  .concat(collect(path.join(ROOT, 'public', 'js'), '.js').map((f) => ({ f, ext: '.mjs' })))
  .concat(collect(path.join(ROOT, 'public'), '.js').filter((f) => path.basename(f) === 'sw.js').map((f) => ({ f, ext: '.cjs' })))
  .concat(collect(path.join(ROOT, 'scripts'), '.js').map((f) => ({ f, ext: '.cjs' })));

const failures = [];
for (const t of targets) {
  const res = check(t.f, t.ext);
  const rel = path.relative(ROOT, res.file).replace(/\\/g, '/');
  if (res.ok) {
    console.log('  ок   ' + rel);
  } else {
    console.log('  ОШИБКА ' + rel);
    console.log(res.text.replace(/^/gm, '        '));
    failures.push(rel);
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* не критично */ }

// Второй проход: связность модулей фронтенда.
const importProblems = checkImports();
if (importProblems.length) {
  console.log('\nИмпорты фронтенда:');
  importProblems.forEach((line) => console.log('  ОШИБКА ' + line));
}

// Третий проход: все ли служебные функции бэкенда объявлены.
const symbolProblems = checkBackendSymbols();
if (symbolProblems.length) {
  console.log('\nСлужебные функции бэкенда:');
  symbolProblems.forEach((line) => console.log('  ОШИБКА ' + line));
}

console.log('\nПроверено файлов: ' + targets.length + ', ошибок: ' + failures.length +
  ', проблем с импортами: ' + importProblems.length +
  ', необъявленных функций: ' + symbolProblems.length);

if (failures.length || importProblems.length || symbolProblems.length) {
  if (failures.length) console.error('\nНе прошли проверку:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('Синтаксис в порядке.');
