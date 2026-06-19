const fs = require('fs');
const path = require('path');
const { fmlabDir } = require('../plugins/settings-store');

/**
 * App-level settings store.
 *
 * Persists installation-wide settings in `.fmlab/settings.json` at the project
 * root (next to `plugins.json`). This is the server-side settings mechanism
 * exposed via `GET/PUT /api/system/config` (to be token-secured later).
 *
 *   .fmlab/settings.json  →  { "<key>": <value>, … }
 *
 * NOTE: the REST-API base URL is deliberately NOT stored here. It is a
 * per-browser, client-side setting (localStorage) — storing it server-side
 * would repoint the backend for *every* client and breaks multi-backend /
 * multi-frontend setups. See apps/web/src/config/apiBase.ts.
 */

/** Keys that must never be persisted server-side (client-only settings). */
const CLIENT_ONLY_KEYS = ['apiUrl'];

function settingsPath() {
  return path.join(fmlabDir(), 'settings.json');
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn(`app-settings: failed to read ${file}: ${err.message}`);
    return null;
  }
}

/**
 * Atomic write: write to a tmp file, then rename into place.
 */
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * The full settings object (never null — missing file → {}).
 */
function getAppSettings() {
  return readJsonSafe(settingsPath()) || {};
}

/**
 * Merge a partial patch into the stored settings.
 * - client-only keys (e.g. `apiUrl`) are stripped and never written
 * - a key set to null/undefined is removed
 * Returns the new full settings object.
 */
function setAppSettings(patch) {
  const next = { ...getAppSettings() };
  for (const [key, value] of Object.entries(patch || {})) {
    if (CLIENT_ONLY_KEYS.includes(key)) continue;
    if (value === null || value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  writeJsonAtomic(settingsPath(), next);
  return next;
}

module.exports = {
  CLIENT_ONLY_KEYS,
  settingsPath,
  getAppSettings,
  setAppSettings,
};
