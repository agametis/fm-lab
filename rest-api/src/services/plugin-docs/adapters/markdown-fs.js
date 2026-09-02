const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const settingsStore = require('../../../plugins/settings-store');

/**
 * markdown-fs Adapter — IDocSetIndex implementation
 *
 * Live-Verzeichnis-Scan über Markdown-Dateien. Geeignet für kleine Doc-Sets
 * (< 100 Dateien) ohne materialisierten Index. Verwendet von fmIDE und fm-lab.
 *
 * Konvention:
 *   - Jede `.md`-Datei im content_dir ist eine "Category"
 *   - Funktions-Ebene existiert in diesen Sets nicht — listFunctions liefert []
 *   - Der Inhalt wird als Markdown ausgeliefert (Konvertierung zu HTML
 *     übernimmt der Controller bzw. die Renderer-Pipeline)
 */

/**
 * Adapter-Capabilities (siehe adapters/index.js). markdown-fs-Sets haben keine
 * eigene Eintragsebene — Rubriken und Einträge sind deckungsgleich, es gibt
 * also nichts zusätzlich zu durchsuchen. Das Kästchen „auch Einträge
 * durchsuchen" rendert bei diesen Sets deshalb nicht.
 */
const capabilities = { entrySearch: false };

function repoRoot() {
  return settingsStore.resolveRepoRoot();
}

function contentDir({ catalogEntry, installedEntry }) {
  if (!installedEntry?.directory) return null;
  const base = path.resolve(repoRoot(), installedEntry.directory);
  const rel = catalogEntry?.content_dir || '.';
  return path.resolve(base, rel);
}

function slugifyTitle(filename) {
  return filename.replace(/\.md$/i, '');
}

function humanizeSlug(slug) {
  // "fmIDE-Cheatsheet" → "fmIDE Cheatsheet"
  return slug.replace(/-/g, ' ').trim();
}

/**
 * Liefert alle `.md`-Dateien unterhalb von content_dir, rekursiv, als
 * content-root-relative Pfade (z.B. "Wiki/Architecture.md"). Versteckt
 * dot-prefixed Verzeichnisse (.git, .DS_Store etc.) und limitiert die Tiefe
 * auf 4 Ebenen — markdown-fs ist nicht für tiefe Hierarchien gedacht.
 */
async function listMarkdownFiles({ catalogEntry, installedEntry } = {}) {
  const dir = contentDir({ catalogEntry, installedEntry });
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  const MAX_DEPTH = 4;

  async function walk(absDir, relDir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        await walk(abs, rel, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(rel);
      }
    }
  }
  await walk(dir, '', 0);
  return out.sort((a, b) => a.localeCompare(b, 'en'));
}

function humanizeNested(slug) {
  // "Wiki/How it works" → "How it works" (drop folder prefix; folder gibt es
  // im sortierten Listing typischerweise als Gruppierung). Für nested pages
  // bleibt die Verzeichnis-Info in der Slug-ID, der Anzeigename ist nur das
  // Basename.
  const base = slug.includes('/') ? slug.slice(slug.lastIndexOf('/') + 1) : slug;
  return humanizeSlug(base);
}

/**
 * Ungefilterte Rohliste aller Seiten (inkl. einer evtl. deklarierten
 * Startseite) — Basis für listCategories UND search, damit die Startseite
 * zwar aus dem Navigations-Listing fällt, aber suchbar bleibt.
 * `folder` = Top-Level-Ordner des Slugs ('' für Root-Dateien); tiefere
 * Verschachtelung wird auf den obersten Ordner gruppiert.
 */
async function allCategories({ catalogEntry, installedEntry } = {}) {
  const files = await listMarkdownFiles({ catalogEntry, installedEntry });
  return files.map(f => {
    const slug = slugifyTitle(f);  // strips .md
    const folder = slug.includes('/') ? slug.slice(0, slug.indexOf('/')) : '';
    return {
      id: slug,                    // z.B. "Wiki/Architecture"
      name: humanizeNested(slug),
      slug,
      folder,
      kind: 'page',
      entry_count: null,           // markdown-fs hat keine Eintragsebene
    };
  });
}

/**
 * Top-Level-Navigationsmodell (analog zu den indizierten Sets):
 *   - jeder Top-Level-Ordner ist eine "Category" (kind: 'folder',
 *     entry_count = Anzahl enthaltener Seiten, rekursiv)
 *   - Root-Seiten bleiben direkte "Categories" (kind: 'page') — flache
 *     Doc-Sets (z.B. fmide) verhalten sich damit wie bisher
 *   - die als start_page deklarierte Seite ist der Einstieg des Doc-Sets
 *     und erscheint nicht zusätzlich als Listeneintrag
 * Ordnung: Ordner alphabetisch (case-insensitiv), dann Root-Seiten.
 * Die Seiten EINES Ordners liefert listFunctions(categoryId=<Ordner>).
 */
async function listCategories(ctx, { catalogEntry, installedEntry } = {}) {
  const pages = await allCategories({ catalogEntry, installedEntry });
  const startPage = catalogEntry?.start_page || null;
  const visible = startPage ? pages.filter(c => c.id !== startPage) : pages;

  const folderCounts = new Map();
  const rootPages = [];
  for (const p of visible) {
    if (p.folder) folderCounts.set(p.folder, (folderCounts.get(p.folder) || 0) + 1);
    else rootPages.push(p);
  }

  const folderRows = [...folderCounts.entries()]
    .map(([name, count]) => ({
      id: name,
      name,
      slug: name,
      folder: '',
      kind: 'folder',
      entry_count: count,
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
        || a.name.localeCompare(b.name, 'en'));

  rootPages.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return [...folderRows, ...rootPages];
}

/**
 * Seiten eines Top-Level-Ordners (categoryId = Ordnername), analog zur
 * Functions-Ebene der indizierten Sets. Tiefer verschachtelte Seiten zählen
 * zu ihrem Top-Level-Ordner. Für Root-Seiten-Categories (kind 'page') und
 * unbekannte Ordner: leere Liste.
 */
async function listFunctions(ctx, { catalogEntry, installedEntry, categoryId } = {}) {
  if (!categoryId) return [];
  const pages = await allCategories({ catalogEntry, installedEntry });
  return pages
    .filter(p => p.folder === categoryId)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map(p => ({
      id: p.id,                      // voller Slug, z.B. "Wiki/Architecture"
      name: p.name,
      canonical: null,
      signature: null,
    }));
}

async function getEntry(ctx, { catalogEntry, installedEntry, functionId, categoryId } = {}) {
  // markdown-fs nutzt categoryId als slug (functionId wird ignoriert / als alias akzeptiert)
  const id = functionId || categoryId;
  if (!id) return null;
  const dir = contentDir({ catalogEntry, installedEntry });
  if (!dir) return null;

  // Strikte Path-Safety: erst resolve()n, dann prüfen, dass der Pfad echt
  // unterhalb von dir bleibt (mit explizitem Separator). Verhindert sowohl
  // "../etc/passwd" als auch Pfad-Präfix-Tricks ("docs/fm-lab.bak/foo.md").
  const file = path.resolve(dir, `${id}.md`);
  const rootWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  if (file !== dir && !file.startsWith(rootWithSep)) return null;
  if (!fs.existsSync(file)) return null;

  let content_md;
  try {
    content_md = await fsp.readFile(file, 'utf-8');
  } catch {
    return null;
  }
  return {
    id,
    title: humanizeNested(id),
    content_md,
    content_html: null, // Konvertierung erfolgt in der Renderer-Pipeline
    metadata: { source_file: path.relative(repoRoot(), file) },
    online_url: catalogEntry?.source_url ? `${catalogEntry.source_url}/${id}` : null,
    format: 'markdown',
  };
}

async function search(ctx, { catalogEntry, installedEntry, q } = {}) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return { categories: [], functions: [] };
  // Rohliste statt listCategories: die Startseite bleibt per Suche erreichbar.
  const cats = await allCategories({ catalogEntry, installedEntry });
  const matched = cats.filter(c =>
    c.name.toLowerCase().includes(term) || c.slug.toLowerCase().includes(term)
  );
  return { categories: matched, functions: [] };
}

async function listLanguages({ installedEntry } = {}) {
  return Array.isArray(installedEntry?.languages) ? installedEntry.languages : ['en'];
}

async function validate(ctx, { catalogEntry, installedEntry } = {}) {
  const errors = [];
  const dir = contentDir({ catalogEntry, installedEntry });
  if (!dir) {
    errors.push('No installed directory configured.');
    return { ok: false, errors };
  }
  if (!fs.existsSync(dir)) {
    errors.push(`Content directory missing: ${dir}`);
    return { ok: false, errors };
  }
  const files = await listMarkdownFiles({ catalogEntry, installedEntry });
  if (files.length === 0) {
    errors.push(`No markdown files found in ${dir}`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  capabilities,
  listCategories,
  listFunctions,
  getEntry,
  search,
  listLanguages,
  validate,
};
