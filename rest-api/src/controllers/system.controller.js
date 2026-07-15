const db = require('../config/database');
const solutionsConfig = require('../config/solutions');
const { buildSuccess } = require('../utils/response-builder');
const appSettings = require('../config/app-settings');
const environment = require('../config/environment');
const packageJson = require('../../package.json');
const { getLoadedPlugins } = require('../plugins/loader');
const {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  resolveLanguage,
} = require('../config/languages');

/**
 * Convert BigInt to Number for JSON serialization
 */
function bigIntToNumber(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

/**
 * System Controller
 * Handles system information endpoints
 */

/**
 * GET /api/version - API version and health status
 */
async function version(req, res, next) {
  try {
    const dbStats = await db.getDatabaseStats(req.solutionContext);

    // Build features object from loaded plugins
    const plugins = getLoadedPlugins();
    const features = {};
    for (const [name, manifest] of Object.entries(plugins)) {
      features[name] = {
        enabled: manifest.enabled,
        version: manifest.version,
        description: manifest.description,
        routes_prefix: manifest.routes_prefix,
        config: manifest.config || {},
        ui: manifest.ui || null,
      };
    }

    const versionInfo = {
      version: packageJson.version,
      api_name: packageJson.description,
      node_version: process.version,
      uptime_seconds: Math.floor(process.uptime()),
      health: 'healthy',
      database: {
        connected: dbStats.connected,
        path: dbStats.database_path,
        size_mb: dbStats.size_mb ? parseFloat(dbStats.size_mb.toFixed(2)) : 0,
        table_count: dbStats.table_count,
      },
      features,
    };

    const response = buildSuccess(versionInfo);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/info - Solution information and statistics
 */
async function info(req, res, next) {
  try {
    const { file } = req.query;

    // Get files from FilesCatalog
    let filesQuery = 'SELECT * FROM FilesCatalog ORDER BY File_Name';
    const filesResult = await db.executeQuery(req.solutionContext, filesQuery);

    // Get object statistics
    let objectStatsQuery = `
      SELECT Object_Type, COUNT(*) as count
      FROM ObjectCatalog
    `;

    if (file) {
      objectStatsQuery += ' WHERE File_Name = ?';
    }

    objectStatsQuery += ' GROUP BY Object_Type ORDER BY count DESC';

    const objectStatsResult = file
      ? await db.executeQuery(req.solutionContext, objectStatsQuery, [file])
      : await db.executeQuery(req.solutionContext, objectStatsQuery);

    // Get link statistics
    let linkStatsQuery = `
      SELECT
        COUNT(*) as total_links,
        SUM(CASE WHEN Is_Cross_File THEN 1 ELSE 0 END) as cross_file_links,
        SUM(CASE WHEN Link_Type = 'operational' THEN 1 ELSE 0 END) as operational_links,
        SUM(CASE WHEN Link_Type = 'structural' THEN 1 ELSE 0 END) as structural_links
      FROM ObjectLinks
    `;

    if (file) {
      linkStatsQuery += ' WHERE Source_File = ? OR Target_File = ?';
    }

    const linkStatsResult = file
      ? await db.executeQuery(req.solutionContext, linkStatsQuery, [file, file])
      : await db.executeQuery(req.solutionContext, linkStatsQuery);

    // Build response
    const totalObjects = objectStatsResult.rows.reduce((sum, row) => sum + bigIntToNumber(row.count), 0);

    const byType = {};
    objectStatsResult.rows.forEach((row) => {
      byType[row.Object_Type] = bigIntToNumber(row.count);
    });

    // Aktive Lösung (= Server-Default) — eigener Schlüssel neben dem
    // historischen `solution`-Block (der die Datei-/Objektstatistik trägt).
    const activeId = solutionsConfig.getActiveSolutionId();
    const activeManifest = solutionsConfig.readManifest(activeId) || {};

    // Aufgelöster Request-Kontext (Ausbaustufe M): die Lösung, die DIESER
    // Aufrufer sieht — bei gesetztem X-Solution-Header ≠ active_solution.
    // Das Frontend zeigt „meine Lösung" hieraus, nie aus active_solution.
    const ctxId = req.solutionContext.solution;
    const ctxManifest = ctxId === activeId
      ? activeManifest
      : (solutionsConfig.readManifest(ctxId) || {});

    const solutionInfo = {
      active_solution: {
        id: activeId,
        display_name: activeManifest.display_name || activeId,
        uuid: activeManifest.uuid || null,
      },
      context: {
        id: ctxId,
        display_name: ctxManifest.display_name || ctxId,
        uuid: ctxManifest.uuid || null,
        is_server_default: ctxId === activeId,
      },
      solution: {
        file_count: filesResult.rows.length,
        files: filesResult.rows.map((f) => ({
          File_Name: f.File_Name,
          File_FullName: f.File_FullName,
          FileMaker_Version: f.FileMaker_Version,
          Has_DDR_INFO: f.Has_DDR_INFO,
          Import_Timestamp: f.Import_Timestamp,
        })),
        object_statistics: {
          total_objects: totalObjects,
          by_type: byType,
        },
        link_statistics: linkStatsResult.rows[0] ? {
          total_links: bigIntToNumber(linkStatsResult.rows[0].total_links),
          cross_file_links: bigIntToNumber(linkStatsResult.rows[0].cross_file_links),
          operational_links: bigIntToNumber(linkStatsResult.rows[0].operational_links),
          structural_links: bigIntToNumber(linkStatsResult.rows[0].structural_links),
        } : {
          total_links: 0,
          cross_file_links: 0,
          operational_links: 0,
          structural_links: 0,
        },
      },
    };

    const response = buildSuccess(solutionInfo);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/system/config — Public client configuration.
 *
 * Returns the server-side default language and the list of supported
 * languages. The web frontend reads this on startup (before the user has
 * touched the language selector) and falls back to its own detection only
 * when no server default is configured. Lets local installations ship
 * their own default (e.g. `de`) via `REFERENCE_DEFAULT_LANG`.
 */
async function config(req, res, next) {
  try {
    const defaultLang = resolveLanguage(environment.reference.defaultLang) || DEFAULT_LANGUAGE;
    res.json(buildSuccess({
      languages: {
        default: defaultLang,
        supported: SUPPORTED_LANGUAGES,
      },
      // Server-side, installation-wide settings (.fmlab/settings.json).
      // NOTE: the REST-API base URL is intentionally NOT here — it is a
      // per-browser client setting (localStorage). See apps/web/src/config/apiBase.ts.
      settings: appSettings.getAppSettings(),
    }));
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/system/config — persist server-side, installation-wide settings.
 *
 * Body: { settings: { [key]: value | null } }
 *   - merges the patch into `.fmlab/settings.json`
 *   - a key set to null removes it
 *   - client-only keys (e.g. `apiUrl`) are rejected — those live in the browser
 *
 * TODO: guard with an auth token (the store is installation-wide).
 */
async function updateConfig(req, res, next) {
  try {
    const { settings } = req.body || {};

    if (settings === undefined || settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SETTINGS', message: 'Body must contain a "settings" object' },
      });
    }

    const rejected = Object.keys(settings).filter((k) => appSettings.CLIENT_ONLY_KEYS.includes(k));
    if (rejected.length) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CLIENT_ONLY_SETTING',
          message: `These settings are client-side only and cannot be stored on the server: ${rejected.join(', ')}`,
        },
      });
    }

    const stored = appSettings.setAppSettings(settings);
    res.json(buildSuccess({ settings: stored }));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  version,
  info,
  config,
  updateConfig,
};
