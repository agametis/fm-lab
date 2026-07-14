const annotationsService = require('../services/annotations.service');
const annoDb = require('../config/annotations-db');
const graphService = require('../services/graph.service');
const environment = require('../config/environment');
const { buildSuccess } = require('../utils/response-builder');
const { createError } = require('../middleware/error-handler');

/**
 * Annotations Controller — Schreib-/Lese-Endpoints für User-Annotationen
 * (Noise-Filter & semantische Anreicherung). Schreibt in die Sidecar-DB; nach
 * jedem Write werden die Graph-Caches geleert, damit der Atlas/Explorer das
 * Ergebnis sofort sieht (statt bis zur 5-min-TTL stale zu bleiben).
 */

/** Optionaler Shared-Secret-Check (analog Admin-Reload-Token). Leer = offen. */
function isAuthorized(req) {
  const expected = environment.annotations.writeToken;
  if (!expected) return true;
  return (req.get('X-Annotations-Token') || '') === expected;
}

function assertAvailable() {
  if (!annoDb.isAvailable()) {
    throw createError('INTERNAL_ERROR', 'Annotations sidecar not available (feature disabled or DB locked)');
  }
}

/** PUT /api/annotations/community */
async function putCommunity(req, res, next) {
  try {
    if (!isAuthorized(req)) return unauthorized(res);
    assertAvailable();
    const { engine, community, user_name, user_notes } = req.body;
    const result = await annotationsService.setCommunityAnnotation(req.solutionContext, {
      engine,
      community,
      userName: user_name ?? null,
      userNotes: user_notes ?? null,
    });
    graphService.clearCache();
    res.json(buildSuccess(result));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/annotations/node/visibility */
async function putNodeVisibility(req, res, next) {
  try {
    if (!isAuthorized(req)) return unauthorized(res);
    assertAvailable();
    const { uuid, file, visible } = req.body;
    const result = await annotationsService.setNodeVisibility(req.solutionContext, {
      uuid,
      file: file || null, // '' (kein File) ⇒ NULL-File (bare uuid)
      visible,
    });
    graphService.clearCache();
    res.json(buildSuccess(result));
  } catch (error) {
    next(error);
  }
}

/** GET /api/annotations/hidden — Recovery-Liste der ausgeblendeten Knoten. */
async function getHidden(req, res, next) {
  try {
    const hidden = await annotationsService.listHidden(req.solutionContext);
    res.json(buildSuccess({ count: hidden.length, hidden }));
  } catch (error) {
    next(error);
  }
}

function unauthorized(res) {
  return res.status(401).json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Annotations-Token header' },
  });
}

module.exports = { putCommunity, putNodeVisibility, getHidden };
