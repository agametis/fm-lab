const resultsService = require('../services/results.service');

/**
 * Results Controller — the unified result layer (Result Envelope v1).
 *
 *   GET  /api/results/summary    Flat envelope map from the cache (never computes)
 *   GET  /api/results/aggregate  Folder-hierarchy consolidation (pure fold)
 *   GET  /api/results/registry   Result-capable units + hierarchy anchors
 *   POST /api/results/run        Explicit trigger (singles / folder subtrees)
 */

function parseKinds(query) {
  if (!query.kinds) return undefined;
  return String(query.kinds).split(',').map(s => s.trim()).filter(Boolean);
}

async function getSummary(req, res, next) {
  try {
    const data = await resultsService.getSummary(req.solutionContext, {
      kinds: parseKinds(req.query),
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getAggregate(req, res, next) {
  try {
    const data = await resultsService.aggregate(req.solutionContext, {
      root: req.query.root ? String(req.query.root) : '',
      roots: req.query.roots ? String(req.query.roots) : undefined,
      kinds: parseKinds(req.query),
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getRegistry(req, res, next) {
  try {
    const rows = await resultsService.listRegistry({ kinds: parseKinds(req.query) });
    res.json({ success: true, data: rows, meta: { count: rows.length } });
  } catch (err) {
    next(err);
  }
}

async function postRun(req, res, next) {
  try {
    const { targets, mode } = req.body || {};
    const data = await resultsService.runTargets(req.solutionContext, { targets, mode });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
  getAggregate,
  getRegistry,
  postRun,
};
