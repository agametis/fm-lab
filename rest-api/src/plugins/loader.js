const fs = require('fs');
const path = require('path');
const settingsStore = require('./settings-store');

const PLUGINS_DIR = __dirname;
const loaded = {};

/**
 * Scan plugin directories and mount active plugins onto the Express router.
 *
 * Convention:
 *   - Directory present          -> plugin known
 *   - plugin.json + enabled:true -> routes mounted
 *   - plugin.json + enabled:false-> listed but inactive
 *   - No plugin.json             -> directory ignored
 *
 * Enabled precedence (strongest wins):
 *   1. .fmlab/plugins.json       — persistent user toggle
 *   2. PLUGIN_<NAME>_ENABLED     — .env override (admin escape hatch)
 *   3. manifest.enabled          — plugin default
 *
 * Settings precedence:
 *   manifest.config (defaults) <- .fmlab/plugins/<name>/settings.json (user) <- .env overrides
 */
function loadPlugins(router) {
  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(PLUGINS_DIR, entry.name, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const originalEnabled = manifest.enabled;

    // Resolve enabled flag with documented precedence
    const userOverride = settingsStore.getEnabledOverride(manifest.name);
    if (userOverride !== null) {
      manifest.enabled = userOverride;
    } else {
      const envKey = `PLUGIN_${manifest.name.toUpperCase()}_ENABLED`;
      if (process.env[envKey] !== undefined) {
        manifest.enabled = process.env[envKey] !== 'false';
      }
    }

    // Merge manifest.config defaults with user overrides from .fmlab/
    if (manifest.config) {
      manifest.config = settingsStore.mergeWithDefaults(manifest.name, manifest.config);

      // .env overrides still win over user settings (admin escape hatch)
      for (const key of Object.keys(manifest.config)) {
        const configEnvKey = `PLUGIN_${manifest.name.toUpperCase()}_${key.toUpperCase()}`;
        if (process.env[configEnvKey] !== undefined) {
          manifest.config[key] = process.env[configEnvKey];
        }
      }
    }

    // Register plugin (even if disabled — for /api/plugins and /api/version transparency)
    loaded[manifest.name] = manifest;

    // Mount routes UNCONDITIONALLY, fronted by a guard that checks the *live*
    // enabled flag on every request. This lets a plugin be toggled on/off at
    // runtime (PATCH /api/plugins/:name) without a server restart: a disabled
    // plugin's routes answer 404, exactly as if they were never mounted.
    const routesFile = path.join(PLUGINS_DIR, entry.name, `${entry.name}.routes.js`);
    if (fs.existsSync(routesFile)) {
      const pluginRoutes = require(routesFile);
      // Sub-routes that stay reachable even while the plugin is disabled
      // (read-only diagnostics, e.g. fmIDE's per-file install status the
      // settings panel shows before you enable the plugin). Paths are relative
      // to the plugin's mount prefix (e.g. "/status").
      const publicRoutes = Array.isArray(manifest.public_routes) ? manifest.public_routes : [];
      const enabledGuard = (req, res, next) => {
        const live = loaded[manifest.name];
        const isPublic = publicRoutes.some((p) => req.path === p || req.path.startsWith(`${p}/`));
        if ((!live || !live.enabled) && !isPublic) {
          return res.status(404).json({
            success: false,
            error: { code: 'PLUGIN_DISABLED', message: `Plugin "${manifest.name}" is disabled` },
          });
        }
        next();
      };
      router.use(manifest.routes_prefix, enabledGuard, pluginRoutes);
      console.log(`  Plugin [${manifest.name}] — mounted at /api${manifest.routes_prefix}${manifest.enabled ? '' : ' (currently disabled)'}`);
    } else {
      console.log(`  Plugin [${manifest.name}] — ${manifest.enabled ? 'enabled' : 'disabled'} (no routes)`);
    }
  }

  return loaded;
}

/**
 * Get all loaded plugin manifests (active and inactive).
 */
function getLoadedPlugins() {
  return loaded;
}

module.exports = { loadPlugins, getLoadedPlugins };
