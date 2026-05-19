const dashboardService = require('../services/dashboard.service');
const dashboardI18nService = require('../services/dashboard-i18n.service');
const environment = require('../config/environment');
const { SUPPORTED_LANGUAGE_CODES, DEFAULT_LANGUAGE, resolveLanguage } = require('../config/languages');

/**
 * Dashboard Controller
 * PRD: project/prd_dashboards.md §7.2 (Routes).
 *
 *   GET /api/dashboards                       List available bundles
 *   GET /api/dashboards/:id                   Manifest + layout (localised)
 *   GET /api/dashboards/:id/data              All datasets in parallel
 *   GET /api/dashboards/:id/data/:dataset     A single dataset
 */

/**
 * Query keys that are not forwarded to SQL templates as parameters.
 */
const RESERVED_QUERY_PARAMS = new Set(['format', 'meta', 'debug', 'lang']);

function extractDashboardParams(query) {
  const out = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (!RESERVED_QUERY_PARAMS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

function pickLang(query) {
  const raw = query && typeof query.lang === 'string' ? query.lang : null;
  if (!raw) {
    return resolveLanguage(environment.reference.defaultLang) || DEFAULT_LANGUAGE;
  }
  if (!SUPPORTED_LANGUAGE_CODES.includes(raw)) {
    return resolveLanguage(raw);
  }
  return raw;
}

async function listDashboards(req, res, next) {
  try {
    const lang = pickLang(req.query);
    const bundles = await dashboardService.listBundles();
    const localised = await Promise.all(
      bundles.map(async (b) => {
        const { manifest } = await dashboardI18nService.resolveBundleForLanguage(b, lang);
        return manifest;
      }),
    );
    const data = localised.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description || null,
      icon: m.icon || null,
      tags: m.tags || [],
      category: m.category || null,
      author: m.author || null,
      version: m.version || null,
    }));
    data.sort((a, b) => a.title.localeCompare(b.title, lang));
    res.json({ success: true, data, meta: { count: data.length, lang } });
  } catch (err) {
    next(err);
  }
}

async function getDashboard(req, res, next) {
  try {
    const { id } = req.params;
    const lang = pickLang(req.query);
    const bundle = await dashboardService.getBundle(id);
    const { manifest, layout } = await dashboardI18nService.resolveBundleForLanguage(bundle, lang);
    res.json({
      success: true,
      data: { manifest, layout },
      meta: { lang },
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
