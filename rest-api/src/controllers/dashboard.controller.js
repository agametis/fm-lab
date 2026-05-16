const dashboardService = require('../services/dashboard.service');

/**
 * Dashboard Controller
 * PRD: project/prd_dashboards.md §7.2 (Routes).
 *
 *   GET /api/dashboards                       Liste verfügbarer Bundles
 *   GET /api/dashboards/:id                   Manifest + Layout
 *   GET /api/dashboards/:id/data              Alle Datasets parallel
 *   GET /api/dashboards/:id/data/:dataset     Einzelnes Dataset
 */

/**
 * Reserviert: nicht als Template-Parameter behandeln.
 */
const RESERVED_QUERY_PARAMS = new Set(['format', 'meta', 'debug']);

function extractDashboardParams(query) {
  const out = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (!RESERVED_QUERY_PARAMS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

async function listDashboards(req, res, next) {
  try {
    const bundles = await dashboardService.listBundles();
    const data = bundles.map(b => ({
      id: b.manifest.id,
      title: b.manifest.title,
      description: b.manifest.description || null,
      icon: b.manifest.icon || null,
      tags: b.manifest.tags || [],
      category: b.manifest.category || null,
      author: b.manifest.author || null,
      version: b.manifest.version || null,
    }));
    data.sort((a, b) => a.title.localeCompare(b.title, 'de'));
    res.json({ success: true, data, meta: { count: data.length } });
  } catch (err) {
    next(err);
  }
}

async function getDashboard(req, res, next) {
  try {
    const { id } = req.params;
    const bundle = await dashboardService.getBundle(id);
    res.json({
      success: true,
      data: {
        manifest: bundle.manifest,
        layout: bundle.layout,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getDashboardData(req, res, next) {
  try {
    const { id } = req.params;
    const bundle = await dashboardService.getBundle(id);
    const params = extractDashboardParams(req.query);
    const datasets = await dashboardService.executeAllDatasets(bundle, params);
    res.json({
      success: true,
      data: { datasets },
      meta: { dashboard_id: id, params_used: params },
    });
  } catch (err) {
    next(err);
  }
}

async function getDashboardDataset(req, res, next) {
  try {
    const { id, dataset } = req.params;
    const bundle = await dashboardService.getBundle(id);
    const params = extractDashboardParams(req.query);
    const result = await dashboardService.executeSingleDataset(bundle, dataset, params);
    res.json({
      success: true,
      data: result.data,
      meta: { ...result.meta, dashboard_id: id, dataset_id: dataset, params_used: params },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDashboards,
  getDashboard,
  getDashboardData,
  getDashboardDataset,
};
