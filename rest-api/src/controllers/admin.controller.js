const db = require('../config/database');
const environment = require('../config/environment');
const { buildSuccess } = require('../utils/response-builder');
const referenceService = require('../services/reference.service');
const helpService = require('../services/help.service');
const templateService = require('../services/template.service');
const dashboardService = require('../services/dashboard.service');
const dashboardI18nService = require('../services/dashboard-i18n.service');
const pluginI18nService = require('../plugins/plugin-i18n.service');

/**
 * Admin Controller
 * Handles administrative endpoints (DB reload, etc.).
 */

/**
 * Optional shared-secret check. If ADMIN_RELOAD_TOKEN is configured, the
 * request must carry a matching X-Admin-Token header. Empty token = open.
 */
function isAuthorized(req) {
  const expected = environment.admin.reloadToken;
  if (!expected) return true;
  const provided = req.get('X-Admin-Token') || '';
  return provided === expected;
}

/**
 * POST /api/admin/reload
 * Closes the current DuckDB connection and re-opens it from disk. Called by
 * convert-xml after a fresh copy of the master DB has been synced into
 * rest-api/db/. See project/plan-db-architektur.md.
 */
async function reload(req, res, next) {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing X-Admin-Token header',
        },
      });
    }

    console.log('Admin reload requested - re-opening DuckDB connection');
    const result = await db.reload();
    // Reference-, Help- und Template-Caches verwerfen, damit der nächste Request
    // frische Daten aus der neu attached'eten Reference-DB, dem Mirror und den
    // SQL-Templates (auf der Platte ggf. geändert) lädt.
    referenceService.clearCaches();
    helpService.clearCache();
    templateService.clearCache();
    dashboardService.clearCache();
    dashboardI18nService.clearCache();
    pluginI18nService.clearCache();
    console.log(`Admin reload complete: ${result.tables} tables from ${result.path}`);

    res.json(buildSuccess({
      status: result.status,
      tables: result.tables,
      path: result.path,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('Admin reload failed:', error);
    next(error);
  }
}

module.exports = {
  reload,
};
