const graphService = require('../services/graph.service');
const { sendFormatted } = require('../utils/response-builder');
const { createError } = require('../middleware/error-handler');

/**
 * Graph Controller (P2 — Subgraph-Backend)
 *
 * Core-Endpoints (LE-6):
 *   GET /api/graph/subgraph   — fokus-zentrierter k-Hop-Subgraph
 *   GET /api/graph/neighbors  — 1-Hop-Expansion (Lazy-Expand)
 *   GET /api/graph/search     — Fokus-Autocomplete über ObjectCatalog
 *
 * Plan plan_graphify_style_visualisierung.md §6.1 / §13.3.
 */

/**
 * Fokus-Auflösung mit Clone-Disambiguierung. Wirft 404 (unbekannt) bzw. 409
 * (mehrdeutig ohne focus_file) — sonst stiller Treffer auf den falschen Klon.
 */
async function assertFocusResolvable(focus, focusFile) {
  const status = await graphService.objectFocusStatus(focus, focusFile);
  if (!status.exists) {
    throw createError('OBJECT_NOT_FOUND', `Focus object '${focus}' not found in ObjectCatalog`, { focus });
  }
  if (status.ambiguous) {
    throw createError(
      'AMBIGUOUS_UUID',
      `Focus UUID '${focus}' exists in ${status.files.length} files (cloned/modular solution); ` +
        `add &focus_file=<File_Name> to disambiguate`,
      { focus, matched_files: status.files }
    );
  }
}

/** GET /api/graph/subgraph */
async function getSubgraph(req, res, next) {
  try {
    const { format, meta, debug } = req.query;

    await assertFocusResolvable(req.query.focus, req.query.focus_file);

    const { payload, sql } = await graphService.getSubgraph(req.query);
    const metaInfo = meta
      ? { focus: payload.focus, ...payload.stats, truncated: payload.truncated }
      : null;
    return sendFormatted(res, payload, format, metaInfo, debug ? sql : null);
  } catch (error) {
    next(error);
  }
}

/** GET /api/graph/neighbors — 1-Hop um einen bestehenden Knoten */
async function getNeighbors(req, res, next) {
  try {
    const { format, meta, debug } = req.query;

    await assertFocusResolvable(req.query.focus, req.query.focus_file);

    const { payload, sql } = await graphService.getNeighbors(req.query);
    const metaInfo = meta
      ? { focus: payload.focus, ...payload.stats, truncated: payload.truncated }
      : null;
    return sendFormatted(res, payload, format, metaInfo, debug ? sql : null);
  } catch (error) {
    next(error);
  }
}

/** GET /api/graph/search — Fokus-Autocomplete */
async function search(req, res, next) {
  try {
    const { format, meta, debug } = req.query;
    const { payload, sql } = await graphService.search(req.query);
    const metaInfo = meta ? { query: payload.query, count: payload.count } : null;
    return sendFormatted(res, payload, format, metaInfo, debug ? sql : null);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSubgraph,
  getNeighbors,
  search,
};
