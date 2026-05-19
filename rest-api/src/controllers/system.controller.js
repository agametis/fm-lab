const db = require('../config/database');
const { buildSuccess } = require('../utils/response-builder');
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
    const dbStats = await db.getDatabaseStats();

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
    const filesResult = await db.executeQuery(filesQuery);

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
      ? await db.executeQuery(objectStatsQuery, [file])
      : await db.executeQuery(objectStatsQuery);

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
      ? await db.executeQuery(linkStatsQuery, [file, file])
      : await db.executeQuery(linkStatsQuery);

    // Build response
    const totalObjects = objectStatsResult.rows.reduce((sum, row) => sum + bigIntToNumber(row.count), 0);

    const byType = {};
    objectStatsResult.rows.forEach((row) => {
      byType[row.Object_Type] = bigIntToNumber(row.count);
    });

    const solutionInfo = {
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
    }));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  version,
  info,
  config,
};
