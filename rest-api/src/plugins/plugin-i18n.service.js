const fs = require('fs');
const path = require('path');

/**
 * Plugin i18n Service
 *
 * Resolves localised manifest text for an installed plugin. The English
 * originals live in `plugin.json`; translations live in
 * `plugins/<name>/locales/<lang>.json` as a small overrides document:
 *
 *   {
 *     "manifest": {
 *       "description": "fmIDE Thingamajig URI-Navigation"
 *     },
 *     "settings_schema": {
 *       "fmp_protocol.label":       "FMP-Protokoll",
 *       "fmp_protocol.description": "fmp oder fmps (TLS)"
 *     }
 *   }
 *
 * Keys in `manifest` are shallow fields on the manifest itself
 * (e.g. `description`). Keys in `settings_schema` are dotted
 * `<field>.<attribute>` paths into the corresponding schema field
 * (`label`, `description`). Missing keys or a missing locale file leave the
 * English originals untouched.
 *
 * Cached per `(pluginName, lang)`. `clearCache()` is wired into
 * `/api/admin/reload` so a new XML import (or hot edit of the locale files)
 * is reflected without restarting the server.
 */

const PLUGINS_DIR = __dirname;

const cache = new Map();

function makeCacheKey(name, lang) {
  return `${name}::${lang}`;
}

function clearCache() {
  cache.clear();
}

function tryReadJsonSync(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`[plugin-i18n] failed to read ${filePath}: ${err.message}`);
    return null;
  }
}

function applySchemaOverrides(schema, overrides) {
  if (!schema || typeof schema !== 'object') return;
  if (!overrides || typeof overrides !== 'object') return;

  for (const [pathExpression, value] of Object.entries(overrides)) {
    const dot = pathExpression.indexOf('.');
    if (dot <= 0 || dot === pathExpression.length - 1) {
      // Not a `<field>.<attribute>` form — silently skip.
      continue;
    }
    const fieldKey = pathExpression.slice(0, dot);
    const attrKey = pathExpression.slice(dot + 1);
    const field = schema[fieldKey];
    if (!field || typeof field !== 'object') continue;
    field[attrKey] = value;
  }
}

function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Returns a localised copy of the relevant manifest slice for the requested
 * language. Falls back to the English originals when no locale file exists
 * or the requested language is the canonical one. The returned object
 * mirrors the shape of `serializePlugin()`'s text-bearing fields:
 *
 *   { description, settings_schema }
 *
 * Other fields (name, version, enabled, settings, ui, …) are not language-
 * dependent and are left to the caller.
 */
function resolvePluginForLanguage(manifest, lang) {
  if (!manifest || !lang || lang === 'en') {
    return {
      description: manifest ? manifest.description : null,
      settings_schema: manifest && manifest.settings_schema
        ? manifest.settings_schema
        : null,
    };
  }

  const cacheKey = makeCacheKey(manifest.name, lang);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const localePath = path.join(PLUGINS_DIR, manifest.name, 'locales', `${lang}.json`);
  const overrides = tryReadJsonSync(localePath);

  if (!overrides) {
    const payload = {
      description: manifest.description,
      settings_schema: manifest.settings_schema || null,
    };
    cache.set(cacheKey, payload);
    return payload;
  }

  let description = manifest.description;
  if (overrides.manifest && typeof overrides.manifest === 'object'
      && typeof overrides.manifest.description === 'string') {
    description = overrides.manifest.description;
  }

  let settingsSchema = manifest.settings_schema || null;
  if (settingsSchema && overrides.settings_schema
      && typeof overrides.settings_schema === 'object') {
    settingsSchema = deepCloneJson(settingsSchema);
    applySchemaOverrides(settingsSchema, overrides.settings_schema);
  }

  const payload = { description, settings_schema: settingsSchema };
  cache.set(cacheKey, payload);
  return payload;
}

module.exports = {
  resolvePluginForLanguage,
  clearCache,
  // exposed for tests
  applySchemaOverrides,
};
