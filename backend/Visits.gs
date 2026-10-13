/**
 * ============================================================================
 * Модуль: Visits
 * Ответственность: журнал посещений сайта — входы, выходы и значимые действия.
 *                  Руководитель видит, кто и когда заходил и что делал.
 * Зависимости: Config, Utils, Sheets
 * ============================================================================
 */

/**
 * Запись посещения.
 * @param {string} userName
 * @param {string} role
 * @param {string} action — «вход», «выход», «создал объект»…
 * @param {Object=} meta — { ip, device }
 */
function logVisit_(userName, role, action, meta) {
  try {
    const m = meta || {};
    appendRowSafe_(CONFIG.SHEETS.VISITS, {
      'дата': todayIso_(),
      'время': isoTime_(new Date()),
      'пользователь': str_(userName),
      'роль': str_(role) === CONFIG.ROLE_LEADER ? 'Руководитель' : 'Мастер',
      'действие': str_(action),
      'ip': truncate_(m.ip || '', 40),
      'устройство': truncate_(m.device || '', 160)
    });
  } catch (e) {
    logError_('Visits.logVisit_', e, { action: action });
  }
}

/**
 * Последние посещения — для панели руководителя.
 * @param {string} token
 * @param {number=} limit
 * @return {Object}
 */
function listVisits_(token, limit) {
  requireLeader_(token);
  const max = Math.min(int_(limit, 100), 500);
  const rows = readRows_(CONFIG.SHEETS.VISITS).map(function (r) {
    return {
      date: str_(r['дата']),
      time: str_(r['время']),
      user: str_(r['пользователь']),
      role: str_(r['роль']),
      action: str_(r['действие']),
      ip: str_(r['ip']),
      device: str_(r['устройство'])
    };
  });
  const tail = rows.slice(Math.max(0, rows.length - max)).reverse();
  return { visits: tail, total: rows.length };
}

/**
 * Сводка посещений по дням за последние N дней.
 * @param {string} token
 * @param {number=} days
 * @return {Object}
 */
function visitsSummary_(token, days) {
  requireLeader_(token);
  const span = Math.min(int_(days, 14), 90);
  const from = addDays_(new Date(), -span + 1);
  const fromIso = isoDate_(from);

  const byDate = {};
  const byUser = {};
  readRows_(CONFIG.SHEETS.VISITS).forEach(function (r) {
    const date = str_(r['дата']);
    if (!date || date < fromIso) return;
    byDate[date] = (byDate[date] || 0) + 1;
    const user = str_(r['пользователь']) || '—';
    byUser[user] = (byUser[user] || 0) + 1;
  });

  const days2 = Object.keys(byDate).sort().map(function (d) {
    return { date: d, count: byDate[d] };
  });
  const users = Object.keys(byUser).map(function (u) {
    return { user: u, count: byUser[u] };
  }).sort(function (a, b) { return b.count - a.count; });

  return { days: days2, users: users, span: span };
}
