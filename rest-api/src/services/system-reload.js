const db = require('../config/database');
const referenceService = require('./reference.service');
const helpService = require('./help.service');
const templateService = require('./template.service');
const dashboardService = require('./dashboard.service');
const dashboardI18nService = require('./dashboard-i18n.service');
const pluginI18nService = require('../plugins/plugin-i18n.service');
const docsReferences = require('./docs-references');
const clarisAdapter = require('./plugin-docs/adapters/claris-duckdb');

/**
 * Re-opens the DuckDB connection from disk and clears all in-process caches.
 *
 * Shared between POST /api/admin/reload (admin controller) und dem internen
 * Reload nach erfolgreichem `POST /api/docs/install/:id` (siehe
 * project/prd_docs_redesign.md §8.2 — Adapter-Refresh nach Installation).
 */
async function performReload() {
  const result = await db.reload();
  referenceService.clearCaches();
  helpService.clearCache();
  templateService.clearCache();
  dashboardService.clearCache();
  dashboardI18nService.clearCache();
  pluginI18nService.clearCache();
  docsReferences.clearCache();
  clarisAdapter.clearSlugMapCache();
  return result;
}

module.exports = { performReload };
