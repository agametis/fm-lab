const fmideService = require('./fmide.service');
const { buildSuccess } = require('../../utils/response-builder');

/**
 * GET /api/fmide/uri?uuid=<Object_UUID>
 * Returns Thingamajig URI and full fmp:// URL for an object.
 */
async function uri(req, res, next) {
  try {
    const { uuid } = req.query;
    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'Query parameter "uuid" is required' },
      });
    }

    // Optional client-side config overrides
    const configOverrides = {};
    if (req.query.protocol) configOverrides.fmp_protocol = req.query.protocol;
    if (req.query.server) configOverrides.server_address = req.query.server;

    const result = await fmideService.buildUri(req.solutionContext, uuid, configOverrides, req.query.file);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: { code: 'OBJECT_NOT_FOUND', message: `Object not found: ${uuid}` },
      });
    }

    res.json(buildSuccess(result));
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/fmide/goto?uuid=<Object_UUID>
 * Redirects to the fmp:// URL — allows direct browser invocation.
 */
async function goto(req, res, next) {
  try {
    const { uuid } = req.query;
    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'Query parameter "uuid" is required' },
      });
    }

    const configOverrides = {};
    if (req.query.protocol) configOverrides.fmp_protocol = req.query.protocol;
    if (req.query.server) configOverrides.server_address = req.query.server;

    const result = await fmideService.buildUri(req.solutionContext, uuid, configOverrides, req.query.file);

    if (!result || !result.fmp_url) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NO_FMP_URL',
          message: result
            ? `Object type "${result.object_type}" is not supported for fmIDE navigation`
            : `Object not found: ${uuid}`,
        },
      });
    }

    res.redirect(302, result.fmp_url);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/fmide/status
 * Per-file fmIDE script status: { [File_Name]: { script_present, script_valid, fmide_version } }.
 * Pass ?refresh=1 to recompute from the catalog.
 */
async function status(req, res, next) {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = refresh
      ? await fmideService.refreshFileStatuses(req.solutionContext)
      : await fmideService.getFileStatuses();
    res.json(buildSuccess(data));
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/fmide/config
 * Returns the current fmIDE configuration.
 */
function getConfig(req, res) {
  res.json(buildSuccess(fmideService.getConfig()));
}

/**
 * PUT /api/fmide/config
 * Updates fmIDE configuration in memory (non-persistent).
 */
function putConfig(req, res) {
  const allowedKeys = ['fmp_protocol', 'server_address', 'script_name'];
  const updates = {};

  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'NO_VALID_FIELDS', message: `Allowed fields: ${allowedKeys.join(', ')}` },
    });
  }

  const updated = fmideService.updateConfig(updates);
  res.json(buildSuccess(updated));
}

module.exports = { uri, goto, status, getConfig, putConfig };
