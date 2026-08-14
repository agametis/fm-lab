const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Settings Store für Plugins.
 *
 * Liest/schreibt User-Overrides in `.fmlab/` am Projekt-Root:
 *   .fmlab/plugins.json              — enabled-State pro Plugin
 *   .fmlab/plugins/<name>/settings.json — User-Overrides der Plugin-Config
 *
 * Enabled-Precedence (vom Loader verwendet):
 *   .fmlab/plugins.json > PLUGIN_<NAME>_ENABLED (.env) > manifest.enabled
 *
 * Settings-Resolution:
 *   manifest.config (Defaults) <- .fmlab/plugins/<name>/settings.json (User) <- .env Override
 */

let cachedRoot = null;

// Ein Verzeichnis gilt nur dann als fm-lab-Root, wenn es rest-api/package.json
// enthält. Ohne diesen Check würde bei einem genesteten Checkout (fm-lab ohne
// eigenes .git innerhalb eines größeren Repos) das ÄUSSERE git-Toplevel
// akzeptiert — alle abgeleiteten Pfade (.fmlab/, tools/, version.json) zeigten
// dann ins falsche Repo.
function isRepoRoot(dir) {
  return fs.existsSync(path.join(dir, 'rest-api', 'package.json'));
}

function resolveRepoRoot() {
  if (cachedRoot) return cachedRoot;
  // 1. Expliziter Override — für Setups, in denen weder ein eigenes .git noch
  //    der Verzeichnis-Fallback greift (z. B. verschobene Server-Starts).
  if (process.env.FMLAB_REPO_ROOT) {
    const envRoot = path.resolve(process.env.FMLAB_REPO_ROOT);
    if (isRepoRoot(envRoot)) {
      cachedRoot = envRoot;
      return envRoot;
    }
    console.warn(`settings-store: FMLAB_REPO_ROOT ignoriert — ${envRoot} enthält kein rest-api/package.json`);
  }
  // 2. Git-Probe — nur akzeptieren, wenn das Toplevel wirklich fm-lab ist.
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (out && isRepoRoot(out)) {
      cachedRoot = out;
      return out;
    }
  } catch {
    // not a git checkout — fall through
  }
  // 3. Fallback: __dirname = <repo>/rest-api/src/plugins → drei Ebenen hoch = Repo-Root.
  cachedRoot = path.resolve(__dirname, '..', '..', '..');
  return cachedRoot;
}

function fmlabDir() {
  return path.join(resolveRepoRoot(), '.fmlab');
}

function pluginsStatePath() {
  return path.join(fmlabDir(), 'plugins.json');
}

function pluginSettingsPath(name) {
  return path.join(fmlabDir(), 'plugins', name, 'settings.json');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn(`settings-store: failed to read ${file}: ${err.message}`);
    return null;
  }
}

/**
 * Atomic write: write to tmp file, then rename.
 */
function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Enabled-State
// ---------------------------------------------------------------------------

function readPluginsState() {
  return readJsonSafe(pluginsStatePath()) || {};
}

/**
 * Returns true/false if .fmlab/plugins.json has an explicit entry for the
 * plugin, otherwise null (meaning: fall through to .env / manifest).
 */
function getEnabledOverride(name) {
  const state = readPluginsState();
  const entry = state[name];
  if (!entry || typeof entry.enabled !== 'boolean') return null;
  return entry.enabled;
}

function setEnabledState(name, enabled) {
  const state = readPluginsState();
  state[name] = { ...(state[name] || {}), enabled: Boolean(enabled) };
  writeJsonAtomic(pluginsStatePath(), state);
  return state[name];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Returns the User-Overrides layer only (no merge). Missing = {}.
 */
function getSettingsOverrides(name) {
  return readJsonSafe(pluginSettingsPath(name)) || {};
}

/**
 * Merge Defaults (from manifest.config) with User-Overrides.
 * Env-Overrides are applied separately in the loader for backwards compat.
 */
function mergeWithDefaults(name, defaults) {
  const overrides = getSettingsOverrides(name);
  return { ...(defaults || {}), ...overrides };
}

/**
 * Persist partial settings — merges patch into existing overrides.
 * Only keys that are present in `allowedKeys` (usually manifest.config keys)
 * are written.
 */
function setSettings(name, patch, allowedKeys) {
  const current = getSettingsOverrides(name);
  const next = { ...current };
  for (const key of Object.keys(patch || {})) {
    if (allowedKeys && !allowedKeys.includes(key)) continue;
    next[key] = patch[key];
  }
  writeJsonAtomic(pluginSettingsPath(name), next);
  return next;
}

module.exports = {
  resolveRepoRoot,
  fmlabDir,
  getEnabledOverride,
  setEnabledState,
  getSettingsOverrides,
  mergeWithDefaults,
  setSettings,
};
