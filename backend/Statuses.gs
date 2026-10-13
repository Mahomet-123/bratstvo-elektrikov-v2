/**
 * ============================================================================
 * Модуль: Statuses
 * Ответственность: снимок состояния офлайн-очереди каждого мастера.
 *                  Лист «Статусы» — одна строка на пользователя, обновляется на месте.
 * Зависимости: Config, Utils, Sheets, Sessions
 * ============================================================================
 */

/**
 * Обновление статуса очереди для вошедшего пользователя.
 * @param {string} token
 * @param {Object} payload — { queued, error, lastSent, comment }
 * @return {Object}
 */
function setStatus_(token, payload) {
  const session = requireSession_(token);
  const p = payload || {};
  const row = {
    'пользователь': session.name,
    'обновлено': nowIso_(),
    'в очереди': int_(p.queued, 0),
    'ошибка': truncate_(p.error || '', 200),
    'последняя отправка': str_(p.lastSent) || '',
    'комментарий': truncate_(p.comment || '', 200)
  };

  return withLock_(function () {
    const existing = findRow_(CONFIG.SHEETS.STATUSES, function (r) {
      return str_(r['пользователь']) === session.name;
    });
    if (existing) {
      updateRow_(CONFIG.SHEETS.STATUSES, existing._row, row);
    } else {
      appendRowSafe_(CONFIG.SHEETS.STATUSES, row);
    }
    return { ok: true, updated: row['обновлено'] };
  });
}

/**
 * Все статусы очереди — для панели руководителя.
 * @param {string} token
 * @return {Object}
 */
function listStatuses_(token) {
  requireLeader_(token);
  const rows = readRows_(CONFIG.SHEETS.STATUSES).map(function (r) {
    return {
      user: str_(r['пользователь']),
      updated: str_(r['обновлено']),
      queued: int_(r['в очереди'], 0),
      error: str_(r['ошибка']),
      lastSent: str_(r['последняя отправка']),
      comment: str_(r['комментарий'])
    };
  });
  const problems = rows.filter(function (r) { return r.queued > 0 || r.error; });
  return { statuses: rows, problems: problems.length, total: rows.length };
}

/**
 * Очистка строки статуса — когда мастер сообщил, что всё отправлено.
 * @param {string} token
 * @return {Object}
 */
function clearStatus_(token) {
  const session = requireSession_(token);
  const existing = findRow_(CONFIG.SHEETS.STATUSES, function (r) {
    return str_(r['пользователь']) === session.name;
  });
  if (!existing) return { ok: true, cleared: false };
  return withLock_(function () {
    updateRow_(CONFIG.SHEETS.STATUSES, existing._row, {
      'обновлено': nowIso_(),
      'в очереди': 0,
      'ошибка': '',
      'последняя отправка': nowIso_()
    });
    return { ok: true, cleared: true };
  });
}
