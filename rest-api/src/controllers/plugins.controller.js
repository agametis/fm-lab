const { buildSuccess } = require('../utils/response-builder');
const { getLoadedPlugins } = require('../plugins/loader');
const settingsStore = require('../plugins/settings-store');
const pluginI18nService = require('../plugins/plugin-i18n.service');
const environment = require('../config/environment');
const {
  SUPPORTED_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  resolveLanguage,
} = require('../config/languages');

/**
 * Plugins Controller
 * Exposes a generic API over all loaded plugins — used by the Settings UI
 * to list, toggle and configure plugins.
 *
 * Toggling is persistent (writes to .fmlab/plugins.json) but requires a
 * server restart to take effect on the routing layer. The response flags
 * this via `requires_restart: true` so the UI can show a hint.
 */

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

function serializePlugin(manifest, lang) {
  const localised = pluginI18nService.resolvePluginForLanguage(manifest, lang);
  return {
    name: manifest.name,
    version: manifest.version,
    description: localised.description,
    enabled: manifest.enabled,
    routes_prefix: manifest.routes_prefix,
    settings: manifest.config || {},
    settings_schema: localised.settings_schema,
    ui: manifest.ui || null,
  };
}

/**
 * GET /api/plugins — list all installed plugins
 */
function list(req, res) {
  const lang = pickLang(req.query);
  const plugins = getLoadedPlugins();
  const data = Object.values(plugins).map((m) => serializePlugin(m, lang));
  res.json(buildSuccess(data));
}

/**
 * GET /api/plugins/:name — details for a single plugin
 */
function get(req, res) {
  const lang = pickLang(req.query);
  const plugins = getLoadedPlugins();
  const manifest = plugins[req.params.name];
  if (!manifest) {
    return res.status(404).json({
      success: false,
      error: { code: 'PLUGIN_NOT_FOUND', message: `Unknown plugin: ${req.params.name}` },
    });
  }
  res.json(buildSuccess(serializePlugin(manifest, lang)));
}

/**
 * PATCH /api/plugins/:name — update enabled and/or settings.
 * Body: { enabled?: boolean, settings?: object }
 */
function patch(req, res) {
  const lang = pickLang(req.query);
  const plugins = getLoadedPlugins();
  const manifest = plugins[req.params.name];
  if (!manifest) {
    return res.status(404).json({
      success: false,
      error: { code: 'PLUGIN_NOT_FOUND', message: `Unknown plugin: ${req.params.name}` },
    });
  }

  const { enabled, settings } = req.body || {};

  if (enabled === undefined && settings === undefined) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'NO_VALID_FIELDS',
        message: 'Body must contain "enabled" and/or "settings"',
      },
    });
  }

  let requiresRestart = false;

  if (typeof enabled === 'boolean' && enabled !== manifest.enabled) {
    settingsStore.setEnabledState(manifest.name, enabled);
    requiresRestart = true;
  }

  if (settings && typeof settings === 'object') {
    const allowedKeys = Object.keys(manifest.config || {});
    const merged = settingsStore.setSettings(manifest.name, settings, allowedKeys);
    // Reflect changes in the in-memory manifest so GET sees them immediately
    manifest.config = { ...(manifest.config || {}), ...merged };
  }

  res.json(buildSuccess({
    ...serializePlugin(manifest, lang),
    requires_restart: requiresRestart,
  }));
}

module.exports = { list, get, patch };
