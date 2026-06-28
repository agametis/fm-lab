const fs = require('fs').promises;
const path = require('path');
const { LRUCache } = require('lru-cache');
const environment = require('../config/environment');

/**
 * Dashboard i18n Service
 *
 * Resolves localized texts for a dashboard bundle. The English originals live
 * in `manifest.json` / `layout.json`; translations live in
 * `locales/<lang>.json` as JSON-path-based overrides:
 *
 *   {
 *     "manifest": {
 *       "title": "Projektüberblick",
 *       "description": "…"
 *     },
 *     "layout": {
 *       "root.children[0].props.title": "Projektüberblick",
 *       "root.children[0].props.items[0].label": "Dateien"
 *     }
 *   }
 *
 * Layout override keys come in two forms (both supported):
 *
 *   1. ID-form (preferred)   "<node-id>.props.label"
 *      The node carries a stable `id` in `layout.json`; the part after the
 *      first dot is resolved relative to that node. Insertion/reordering of
 *      sibling nodes does NOT break the mapping.
 *
 *   2. Legacy path-form      "root.children[4].props.label"
 *      Absolute, positional JSON path from the document root. Kept for
 *      backward compatibility; brittle against structural shifts.
 *
 * Manifest override keys are flat top-level keys (title, description, …).
 * Missing keys or a missing locale file leave the English originals
 * untouched. In dev/CI, set `STRICT_I18N=1` to turn an unresolvable
 * override into a hard error instead of a silent skip.
 *
 * The resolver is cached per `(dashboard_id, lang)`. `clearCache()` is
 * called from `/api/admin/reload` (after a fresh DB sync from convert-xml).
 */

const cache = new LRUCache({
  max: 200,
  ttl: 1000 * 60 * 60, // 1h — matches the dashboard bundle cache
  updateAgeOnGet: true,
});

function clearCache() {
  cache.clear();
}

function makeCacheKey(id, lang) {
  return `${id}::${lang}`;
}

async function tryReadJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`[dashboard-i18n] failed to read ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Walks a dotted/bracketed path expression like
 *   `root.children[0].props.title`
 * and returns `{ container, key }` so the caller can perform the assignment
 * without splitting the path again. Returns `null` if the path does not
 * resolve to an existing parent.
 */
function resolvePath(root, expression) {
  const tokens = [];
  // split into property accesses and array indices: `foo.bar[0].baz`
  // → ['foo', 'bar', 0, 'baz']
  const regex = /([^.\[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = regex.exec(expression)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else tokens.push(Number(m[2]));
  }
  if (tokens.length === 0) return null;

  let cursor = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const key = tokens[i];
    if (cursor == null || typeof cursor !== 'object') return null;
    cursor = cursor[key];
  }
  if (cursor == null || typeof cursor !== 'object') return null;
  return { container: cursor, key: tokens[tokens.length - 1] };
}

/**
 * Walks the layout document and collects every node that carries a stable
 * string `id`, returning a `Map<id, node>`. Only objects that are actual
 * layout nodes (i.e. also have a string `type`) are indexed — this avoids
 * picking up unrelated `id` keys nested in props (e.g. `onClick.args.id`).
 */
function buildIdIndex(value, index = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) buildIdIndex(item, index);
  } else if (value && typeof value === 'object') {
    if (typeof value.id === 'string' && typeof value.type === 'string') {
      if (index.has(value.id)) {
        console.warn(`[dashboard-i18n] duplicate node id "${value.id}" — later occurrence wins`);
      }
      index.set(value.id, value);
    }
    for (const key of Object.keys(value)) {
      buildIdIndex(value[key], index);
    }
  }
  return index;
}

/**
 * Resolves a single override key (either ID-form or legacy path-form) to a
 * `{ container, key }` assignment slot. Returns `null` if it does not resolve.
 *
 * @param {object} layout   the layout document root
 * @param {Map}    idIndex  result of buildIdIndex(layout)
 * @param {string} key      override key
 */
function resolveOverrideKey(layout, idIndex, key) {
  const firstDot = key.indexOf('.');
  const head = firstDot === -1 ? key : key.slice(0, firstDot);
  // Legacy: absolute JSON path from the document root.
  if (head === 'root') {
    return resolvePath(layout, key);
  }
  // ID-form: "<node-id>.<relative.path>"
  const node = idIndex.get(head);
  if (!node || firstDot === -1) return null;
  return resolvePath(node, key.slice(firstDot + 1));
}

function applyOverrides(target, overrides) {
  if (!overrides || typeof overrides !== 'object') return;
  const idIndex = buildIdIndex(target);
  for (const [key, value] of Object.entries(overrides)) {
    const slot = resolveOverrideKey(target, idIndex, key);
    if (!slot) {
      // Unresolvable override: silent best-effort skip in production, but a
      // loud signal in dev/CI so structural drift cannot slip through.
      const msg = `[dashboard-i18n] unresolved override key "${key}"`;
      if (process.env.STRICT_I18N) throw new Error(msg);
      console.warn(msg);
      continue;
    }
    slot.container[slot.key] = value;
  }
}

/**
 * Deep-clones a JSON-safe value. JSON-shaped, so JSON.parse(JSON.stringify(x))
 * is sufficient (and faster than structuredClone for small dashboard payloads).
 */
function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Returns a localised copy of `{ manifest, layout }` for the requested
 * language. Falls back to the English originals when no locale file exists
 * or the requested language is the canonical one.
 *
 * @param {object}  bundle  bundle as returned by dashboardService.getBundle()
 * @param {string}  lang    desired language code (already validated)
 * @returns {Promise<{ manifest: object, layout: object }>}
 */
async function resolveBundleForLanguage(bundle, lang) {
  if (!lang || lang === 'en') {
    return { manifest: bundle.manifest, layout: bundle.layout };
  }

  const cacheKey = makeCacheKey(bundle.id, lang);
  if (environment.templates.cacheEnabled) {
    const cached = cache.get(cacheKey);
    if (cached && cached.bundleMtime === bundle.mtime) {
      return cached.payload;
    }
  }

  const localePath = path.join(bundle.dir, 'locales', `${lang}.json`);
  const overrides = await tryReadJson(localePath);

  if (!overrides) {
    const payload = { manifest: bundle.manifest, layout: bundle.layout };
    if (environment.templates.cacheEnabled) {
      cache.set(cacheKey, { bundleMtime: bundle.mtime, payload });
    }
    return payload;
  }

  const manifest = deepCloneJson(bundle.manifest);
  const layout = deepCloneJson(bundle.layout);

  if (overrides.manifest && typeof overrides.manifest === 'object') {
    // Manifest overrides are shallow object keys for ergonomics (most
    // translatable fields live at the top level: title, description, …).
    for (const [k, v] of Object.entries(overrides.manifest)) {
      manifest[k] = v;
    }
  }
  if (overrides.layout && typeof overrides.layout === 'object') {
    applyOverrides(layout, overrides.layout);
  }

  const payload = { manifest, layout };
  if (environment.templates.cacheEnabled) {
    cache.set(cacheKey, { bundleMtime: bundle.mtime, payload });
  }
  return payload;
}

module.exports = {
  resolveBundleForLanguage,
  clearCache,
  // exposed for tests
  resolvePath,
  applyOverrides,
  buildIdIndex,
  resolveOverrideKey,
};
