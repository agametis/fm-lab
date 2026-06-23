const db = require('../config/database');
const referenceService = require('./reference.service');
const helpService = require('./help.service');
const templateService = require('./template.service');
const graphService = require('./graph.service');
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
  graphService.clearCache();
  dashboardService.clearCache();
  dashboardI18nService.clearCache();
  pluginI18nService.clearCache();
  docsReferences.clearCache();
  clarisAdapter.clearSlugMapCache();

  // Recompute the fmIDE per-file script status against the freshly reloaded DB,
  // but only if a scan was ever run (don't scan for a never-activated plugin).
  // Best-effort, lazily required so a missing plugin never breaks the reload.
  try {
    const fmide = require('../plugins/fmide/fmide.service');
    if (fmide.hasScanData()) await fmide.refreshFileStatuses();
  } catch (err) {
    console.warn(`reload: fmIDE status refresh skipped: ${err.message}`);
  }

  return result;
}

module.exports = { performReload };
