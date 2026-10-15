/**
 * ============================================================================
 * Модуль: Bundle
 * Ответственность: сборка «пакета данных» — одного ответа со всем, что нужно
 *                  экранам разделов. Приложение забирает пакет один раз при
 *                  входе и обновляет его целиком, вместо запроса на каждое
 *                  переключение раздела.
 *
 *                  Права не ослабляются: пакет собирается теми же функциями,
 *                  что и отдельные маршруты, с той же проверкой сессии. Мастеру
 *                  в пакет попадает только то, что ему и так разрешено.
 *
 *                  Прайс в пакет НЕ входит: он тяжёлый и меняется редко —
 *                  его приложение держит отдельно, со своим сроком годности.
 *
 * Зависимости: Config, Utils, Objects, Users, Visits, Analytics, Archive, Bot
 * ============================================================================
 */

/** Сколько записей журнала посещений кладём в пакет по умолчанию. */
const BUNDLE_VISITS_LIMIT_ = 150;

/** Сколько дней берём в сводку посещений — как на экране «Посещения». */
const BUNDLE_VISITS_DAYS_ = 14;

/**
 * Пакет данных для вошедшего пользователя.
 *
 * @param {string} token — сессия (маршрут уже проверил её)
 * @param {Object} session — разобранная сессия
 * @param {Object=} options — { includeClosed, visitsLimit, visitsDays }
 * @return {Object}
 */
function dataBundle_(token, session, options) {
  const o = options || {};
  const isLeader = Boolean(session && str_(session.role) === CONFIG.ROLE_LEADER);

  // Список объектов нужен всем: и мастеру, и руководителю.
  const bundle = {
    collectedAt: nowIso_(),
    role: isLeader ? CONFIG.ROLE_LEADER : CONFIG.ROLE_MASTER,
    objects: listObjects_(token, { includeClosed: true }).objects || []
  };

  // Разделы руководителя мастеру не отдаём — их всё равно не должно быть видно.
  if (isLeader) {
    bundle.analytics = analyticsSummary_(token, {
      includeClosed: o.includeClosed === undefined ? true : bool_(o.includeClosed)
    });
    bundle.users = listUsersForLeader_(token);
    bundle.bot = botStatus_(token);
    bundle.archives = archivesList_(token);
    bundle.visits = {
      list: listVisits_(token, int_(o.visitsLimit, 0) || BUNDLE_VISITS_LIMIT_),
      summary: visitsSummary_(token, int_(o.visitsDays, 0) || BUNDLE_VISITS_DAYS_)
    };
  }

  return bundle;
}
