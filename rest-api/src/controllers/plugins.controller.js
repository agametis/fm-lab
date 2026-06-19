const path = require('path');
const fs = require('fs');
const { buildSuccess } = require('../utils/response-builder');
const { getLoadedPlugins } = require('../plugins/loader');
const settingsStore = require('../plugins/settings-store');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

/**
 * Lazily load a plugin's optional actions module (`plugins/<name>/<name>.actions.js`).
 * Returns the module's exports, or null when the plugin has no actions.
 */
function loadPluginActions(name) {
  const file = path.join(PLUGINS_DIR, name, `${name}.actions.js`);
  if (!fs.existsSync(file)) return null;
  try {
    return require(file);
  } catch (err) {
    console.warn(`plugins: failed to load actions for "${name}": ${err.message}`);
    return null;
  }
}
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
 * Toggling is persistent (writes to .fmlab/plugins.json) and takes effect
 * immediately: the in-memory manifest flag is flipped here, and the plugin's
 * routes are guarded by that live flag (see plugins/loader.js), so no server
 * restart is needed. `requires_restart` is therefore always false (kept in the
 * response for backward compatibility).
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
async function patch(req, res) {
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

  let justEnabled = false;
  if (typeof enabled === 'boolean' && enabled !== manifest.enabled) {
    settingsStore.setEnabledState(manifest.name, enabled);
    // Flip the live flag so the route guard and /api/version reflect it at once.
    manifest.enabled = enabled;
    justEnabled = enabled === true;
  }

  if (settings && typeof settings === 'object') {
    const allowedKeys = Object.keys(manifest.config || {});
    const merged = settingsStore.setSettings(manifest.name, settings, allowedKeys);
    // Reflect changes in the in-memory manifest so GET sees them immediately
    manifest.config = { ...(manifest.config || {}), ...merged };
  }

  // Lifecycle hook: run the plugin's onEnable action on activation (e.g. fmIDE's
  // first catalog scan). Best-effort — never fails the toggle.
  if (justEnabled) {
    const actions = loadPluginActions(manifest.name);
    if (actions && typeof actions.onEnable === 'function') {
      try {
        await actions.onEnable();
      } catch (err) {
        console.warn(`plugins: onEnable for "${manifest.name}" failed: ${err.message}`);
      }
    }
  }

  res.json(buildSuccess({
    ...serializePlugin(manifest, lang),
    requires_restart: false,
  }));
}

/**
 * POST /api/plugins/:name/actions/:action — invoke a named plugin action.
 *
 * Generic dispatch to `plugins/<name>/<name>.actions.js`. Used e.g. by the
 * fmIDE settings panel's "Rescan" button (`…/fmide/actions/rescan`) to re-run
 * the catalog scan on demand. Works regardless of the plugin's enabled state
 * (this is a core route, not a plugin-guarded one).
 */
async function action(req, res, next) {
  try {
    const { name, action: actionName } = req.params;
    const plugins = getLoadedPlugins();
    if (!plugins[name]) {
      return res.status(404).json({
        success: false,
        error: { code: 'PLUGIN_NOT_FOUND', message: `Unknown plugin: ${name}` },
      });
    }

    const actions = loadPluginActions(name);
    if (!actions || typeof actions[actionName] !== 'function') {
      return res.status(404).json({
        success: false,
        error: { code: 'ACTION_NOT_FOUND', message: `Unknown action "${actionName}" for plugin "${name}"` },
      });
    }

    const result = await actions[actionName](req.body || {});
    res.json(buildSuccess(result ?? null));
  } catch (error) {
    next(error);
  }
}

module.exports = { list, get, patch, action };
