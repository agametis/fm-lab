const fs = require('fs').promises;
const path = require('path');
const { LRUCache } = require('lru-cache');
const environment = require('../config/environment');
const { createError } = require('../middleware/error-handler');
const db = require('../config/database');

/**
 * Template Service
 * Handles SQL template loading, caching, parsing, and execution
 */

// LRU Cache for template storage
const templateCache = new LRUCache({
  max: 100, // Maximum 100 templates
  ttl: 1000 * 60 * 60, // 1 hour TTL
  updateAgeOnGet: true,
});

/**
 * Parse template metadata from SQL comments
 * @param {string} templateContent - Template file content
 * @returns {Object} Parsed metadata
 */
function parseTemplateMetadata(templateContent) {
  const metadata = {
    template_type: 'report', // Default to report for max flexibility
    title: null,
    description: null,
    icon: null,
    category: null,
    display: null,
    click_action: null,
    click_args: null,
    row_action: null,
    row_action_args: null,
    row_action_label: null,
    chip_filter: null,
    chip_param: null,
    params: [],
    output_format: null,
    author: null,
    version: null,
    tags: [],
    // Analysis-Tests member metadata: all optional, absent = query is not
    // test-capable. `default_result` is a one-line JSON object.
    object_types: [],
    output_types: [],
    scope: [],
    default_result: null,
  };

  // Generischer Frontmatter-Parser: "-- @key: value"
  const lines = templateContent.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*--\s*@([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    switch (key) {
      case 'template_type':
        metadata.template_type = value;
        break;
      case 'title':
        metadata.title = value;
        break;
      case 'description':
        metadata.description = value;
        break;
      case 'icon':
        metadata.icon = value;
        break;
      case 'category':
        metadata.category = value;
        break;
      case 'display':
        metadata.display = value;
        break;
      case 'click_action':
        metadata.click_action = value;
        break;
      case 'click_args':
        metadata.click_args = value;
        break;
      case 'row_action':
        // Zweites, pro Zeile gerendertes Klickziel (kleiner Pfeil-Button am
        // Zeilenende) — gleiche Action-Whitelist und Token-Grammatik wie
        // click_action/click_args. Opt-in pro Query; ohne row_action bleibt
        // die Tabelle einspaltig klickbar wie bisher.
        metadata.row_action = value;
        break;
      case 'row_action_args':
        metadata.row_action_args = value;
        break;
      case 'row_action_label':
        // Tooltip/aria-label des Pfeil-Buttons. Template-Sprache (Englisch),
        // wie @title/@description; fehlt es, greift ein generischer i18n-Text.
        metadata.row_action_label = value;
        break;
      case 'chip_filter':
        // Name einer Ergebnis-Spalte, über die der generische Renderer eine
        // Chip-Leiste rendert. Die Facetten-Buckets werden in der SQL geformt
        // (z.B. Scope → '$'/'$$'/'$$$'); die Grammatik hier bleibt ein
        // einzelner Spaltenname.
        //
        // Zählung und Filterung laufen client-seitig über die geladene,
        // LIMIT-gekappte Ergebnismenge — es sei denn, die Query liefert die
        // Konventionsspalte `_chip_facets` (echte Facetten-Counts der
        // Grundgesamtheit) bzw. deklariert `@chip_param` (Klick filtert
        // serverseitig). Beides ist opt-in pro Query.
        metadata.chip_filter = value;
        break;
      case 'chip_param':
        // Query-Parameter, den ein Chip-Klick in die URL schreibt, damit die
        // Query serverseitig neu filtert statt nur die geladene Seite zu
        // partitionieren. Setzt voraus, dass die Query den Parameter auch
        // auswertet (`getvariable('<param>')`) und ihn unter `@params` führt.
        metadata.chip_param = value;
        break;
      case 'params':
        metadata.params = value.split(',').map(p => p.trim()).filter(Boolean);
        break;
      case 'output_format':
        metadata.output_format = value;
        break;
      case 'author':
        metadata.author = value;
        break;
      case 'version':
        metadata.version = value;
        break;
      case 'tags':
        metadata.tags = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'object_types':
        metadata.object_types = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'output_types':
        metadata.output_types = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'scope':
        metadata.scope = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'default_result':
        // One-line JSON: { type, name, meaning, aggregate }. Invalid JSON is
        // treated as "not declared" (warn) — never breaks template loading.
        try {
          metadata.default_result = JSON.parse(value);
        } catch (err) {
          console.warn(`template metadata: invalid @default_result JSON (${err.message})`);
          metadata.default_result = null;
        }
        break;
      default:
        // unbekannte Keys ignorieren — zukünftige Erweiterungen
        break;
    }
  }

  return metadata;
}

/**
 * Load template from file with caching
 * @param {string} templateName - Template name (without .sql extension)
 * @param {string} templateDir - Directory to load from
 * @returns {Promise<Object>} Template content and metadata
 */
async function loadTemplate(templateName, templateDir) {
  const cacheKey = `${templateDir}:${templateName}`;
  const templatePath = path.join(templateDir, `${templateName}.sql`);

  // mtime-Check für Cache-Invalidation — analog zu dashboard.service.loadBundle().
  // Damit wirken Änderungen an sql/*.sql und sql-custom/*.sql ohne /api/admin/reload.
  let mtime = 0;
  if (environment.templates.cacheEnabled) {
    try {
      mtime = (await fs.stat(templatePath)).mtimeMs;
    } catch {
      // Datei nicht (mehr) vorhanden — Fehler überlassen wir readFile unten
    }
    const cached = templateCache.get(cacheKey);
    if (cached && cached.mtime === mtime) {
      return cached;
    }
  }

  try {
    const content = await fs.readFile(templatePath, 'utf-8');
    const metadata = parseTemplateMetadata(content);

    const template = {
      name: templateName,
      content,
      metadata,
      path: templatePath,
      mtime,
    };

    if (environment.templates.cacheEnabled) {
      templateCache.set(cacheKey, template);
    }

    return template;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw createError(
        'TEMPLATE_NOT_FOUND',
        `Template '${templateName}' not found in ${templateDir}`,
        { templateName, templateDir }
      );
    }
    throw createError('TEMPLATE_ERROR', `Failed to load template: ${error.message}`, {
      templateName,
      error: error.message,
    });
  }
}

/**
 * Interpolate template variables with parameters
 * Supports three formats:
 * - DuckDB-style: getvariable('var_name')
 * - Named parameters: :var_name
 * - Positional parameters: $1, $2, etc.
 *
 * @param {string} templateContent - Template SQL content
 * @param {Object} params - Parameters to interpolate
 * @returns {string} Interpolated SQL
 */
function interpolateTemplate(templateContent, params = {}) {
  let sql = templateContent;

  // Escape single quotes in string parameters
  const escapeParam = (value) => {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    return String(value);
  };

  // Substitution order matters: the getvariable() pass — the one used by the
  // dashboard bundles — MUST run LAST. Otherwise a value it inserts that itself
  // contains ":word" (e.g. a host with a port like `localhost:3000`, or a
  // "key:value" string) would be re-scanned by the named-parameter pass below and
  // its ":3000" fragment replaced with NULL → `'localhostNULL'`, so the filter
  // matches nothing. Running getvariable last means its inserted values are never
  // re-scanned. (String.replace does not re-scan its own replacement text within a
  // single pass, so the :name / $n values are already safe on their own passes.)

  // 1. Replace named parameters :var_name (e.g. the `file` dashboard's `:file`)
  sql = sql.replace(/:(\w+)/g, (match, varName) => {
    if (varName in params) {
      return escapeParam(params[varName]);
    }
    return 'NULL';
  });

  // 2. Replace positional parameters $1, $2, etc.
  sql = sql.replace(/\$(\d+)/g, (match, position) => {
    const index = parseInt(position, 10) - 1;
    const paramsArray = Object.values(params);
    if (index >= 0 && index < paramsArray.length) {
      return escapeParam(paramsArray[index]);
    }
    return 'NULL';
  });

  // 3. Replace DuckDB-style getvariable('var_name') — LAST (see note above).
  sql = sql.replace(/getvariable\('([^']+)'\)/g, (match, varName) => {
    if (varName in params) {
      return escapeParam(params[varName]);
    }
    // Keep NULL for missing parameters
    return 'NULL';
  });

  return sql;
}

/**
 * Validate template output based on template type
 * @param {Array} rows - Query result rows
 * @param {Object} metadata - Template metadata
 * @throws {Error} If validation fails
 */
function validateTemplateOutput(rows, metadata) {
  if (rows.length === 0) {
    return; // Empty result is valid
  }

  const firstRow = rows[0];

  // Validate object templates
  if (metadata.template_type === 'object') {
    const requiredColumns = ['uuid', 'name', 'type'];
    const missingColumns = requiredColumns.filter(col => !(col in firstRow));

    if (missingColumns.length > 0) {
      throw createError(
        'TEMPLATE_ERROR',
        `Object template must return columns: ${requiredColumns.join(', ')}. Missing: ${missingColumns.join(', ')}`,
        { metadata, missingColumns }
      );
    }
  }

  // Validate content templates
  if (metadata.template_type === 'content') {
    // Support both lowercase and uppercase
    const hasContent = 'content' in firstRow || 'Content' in firstRow;

    if (!hasContent) {
      throw createError(
        'TEMPLATE_ERROR',
        'Content template must return a "content" column',
        { metadata, columns: Object.keys(firstRow) }
      );
    }
  }

  // Report templates have no column requirements
}

/**
 * Recursively walk a directory tree looking for `<templateName>.sql`.
 * Returns the directory containing the file, or null if not found.
 */
async function findTemplateDirRecursive(rootDir, templateName) {
  const filename = `${templateName}.sql`;
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const found = await findTemplateDirRecursive(full, templateName);
      if (found) return found;
    } else if (entry.name === filename) {
      return rootDir;
    }
  }
  return null;
}

/**
 * Sucht ein Template in den `queries/`-Subordnern aller Dashboard-Bundles.
 * Damit können System- und Custom-Bundles eigene Drilldown-Templates mitbringen,
 * die per `custom:<name>` (z.B. aus `_generic`) auflösbar sind — ohne dass die
 * Templates im globalen `sql-custom/` liegen müssen.
 *
 * Erwartete Layout: `<bundle-root>/<bundle-id>/queries/<templateName>.sql`
 * Pfad-Traversal-Schutz: `templateName` muss `[a-zA-Z0-9_-]+` matchen.
 */
async function findInBundleQueries(bundleRoots, templateName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(templateName)) return null;
  const filename = `${templateName}.sql`;
  for (const root of bundleRoots) {
    let bundles;
    try {
      bundles = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const b of bundles) {
      if (!b.isDirectory() || b.name.startsWith('.')) continue;
      const queriesDir = path.join(root, b.name, 'queries');
      try {
        await fs.access(path.join(queriesDir, filename));
        return queriesDir;
      } catch {
        // weiterprobieren
      }
    }
  }
  return null;
}

/**
 * Execute SQL template with parameters
 * @param {Object} ctx - Request context ({solution, requested})
 * @param {string} templateName - Template name (without .sql extension)
 * @param {Object} params - Template parameters
 * @param {string} source - 'query' or 'report' (determines directory)
 * @returns {Promise<Object>} Query results with metadata
 */
async function executeTemplate(ctx, templateName, params = {}, source = 'query') {
  try {
    // Determine template directory based on source
    const templateDir =
      source === 'report'
        ? environment.templates.dir // Standard templates for /report
        : environment.templates.customDir; // Custom templates for /query

    // Load template — bei 'query' wird in dieser Reihenfolge gesucht:
    //   1. templates/sql-custom/               (standalone Custom-Queries)
    //   2. templates/sql-custom-details/**/    (rekursiv — Detail-View-Templates für UI-Hooks)
    //   3. templates/dashboards*/<bundle>/queries/  (Bundle-eigene Drilldown-Templates,
    //                                                damit Dashboards self-contained sind)
    // Damit erscheinen Detail- und Bundle-Templates nicht im "Custom Queries"-Listing,
    // sind aber per `custom:<name>` aus _generic resolvbar.
    let template;
    try {
      template = await loadTemplate(templateName, templateDir);
    } catch (loadErr) {
      if (loadErr.code !== 'TEMPLATE_NOT_FOUND' || source !== 'query') {
        throw loadErr;
      }
      let foundDir = null;
      if (environment.templates.detailsDir) {
        foundDir = await findTemplateDirRecursive(
          environment.templates.detailsDir,
          templateName
        );
      }
      if (!foundDir) {
        const bundleRoots = [
          environment.templates.dashboardsCustomDir,
          environment.templates.dashboardsDir,
        ].filter(Boolean);
        foundDir = await findInBundleQueries(bundleRoots, templateName);
      }
      if (!foundDir) throw loadErr;
      template = await loadTemplate(templateName, foundDir);
    }

    // Interpolate parameters
    const sql = interpolateTemplate(template.content, params);

    // Execute query
    const result = await db.executeQuery(ctx, sql);

    // Validate output
    validateTemplateOutput(result.rows, template.metadata);

    // Convert BigInts to Numbers
    const convertBigInts = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(convertBigInts);
      } else if (obj !== null && typeof obj === 'object') {
        const converted = {};
        for (const [key, value] of Object.entries(obj)) {
          converted[key] = typeof value === 'bigint' ? Number(value) : convertBigInts(value);
        }
        return converted;
      }
      return obj;
    };

    return {
      data: convertBigInts(result.rows),
      meta: {
        ...result.meta,
        template_type: template.metadata.template_type,
        template_name: templateName,
        template_description: template.metadata.description,
        params_used: params,
      },
      sql, // Return interpolated SQL for debug mode
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('TEMPLATE_ERROR', `Template execution failed: ${error.message}`, {
      templateName,
      params,
      error: error.message,
    });
  }
}

/**
 * List all available templates in a directory
 * @param {string} source - 'query' or 'report'
 * @returns {Promise<Array>} List of template names and metadata
 */
async function listTemplates(source = 'query') {
  try {
    const templateDir =
      source === 'report' ? environment.templates.dir : environment.templates.customDir;

    const files = await fs.readdir(templateDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql'));

    const templates = await Promise.all(
      sqlFiles.map(async file => {
        const templateName = path.basename(file, '.sql');
        try {
          const template = await loadTemplate(templateName, templateDir);
          return {
            name: templateName,
            title: template.metadata.title,
            description: template.metadata.description,
            template_type: template.metadata.template_type,
            icon: template.metadata.icon,
            category: template.metadata.category,
            display: template.metadata.display,
            click_action: template.metadata.click_action,
            click_args: template.metadata.click_args,
            chip_filter: template.metadata.chip_filter,
            chip_param: template.metadata.chip_param,
            params: template.metadata.params,
            tags: template.metadata.tags,
            object_types: template.metadata.object_types,
            output_types: template.metadata.output_types,
            scope: template.metadata.scope,
            default_result: template.metadata.default_result,
          };
        } catch (error) {
          // Skip templates that fail to load
          return null;
        }
      })
    );

    return templates.filter(t => t !== null);
  } catch (error) {
    throw createError('TEMPLATE_ERROR', `Failed to list templates: ${error.message}`, {
      source,
      error: error.message,
    });
  }
}

/**
 * Lädt die Metadaten eines Templates über alle Such-Pfade (sql-custom →
 * sql-custom-details → bundle queries). Gibt null zurück, wenn nichts gefunden.
 *
 * Im Unterschied zu `listTemplates('query')` (das nur sql-custom enumeriert)
 * kann diese Funktion gezielt jedes auflösbare Template adressieren — wichtig
 * für `builtin:query_meta`, das Drilldown-Metadaten aus Bundle-eigenen Queries
 * lesen können muss.
 */
async function getTemplateMeta(templateName, source = 'query') {
  const templateDir =
    source === 'report'
      ? environment.templates.dir
      : environment.templates.customDir;
  let template;
  try {
    template = await loadTemplate(templateName, templateDir);
  } catch (err) {
    if (err.code !== 'TEMPLATE_NOT_FOUND' || source !== 'query') return null;
    let foundDir = null;
    if (environment.templates.detailsDir) {
      foundDir = await findTemplateDirRecursive(
        environment.templates.detailsDir,
        templateName
      );
    }
    if (!foundDir) {
      const bundleRoots = [
        environment.templates.dashboardsCustomDir,
        environment.templates.dashboardsDir,
      ].filter(Boolean);
      foundDir = await findInBundleQueries(bundleRoots, templateName);
    }
    if (!foundDir) return null;
    try {
      template = await loadTemplate(templateName, foundDir);
    } catch {
      return null;
    }
  }
  return { name: templateName, ...template.metadata };
}

/**
 * Wie getTemplateMeta, liefert aber zusätzlich den ROHEN SQL-Inhalt — für die
 * textuellen Scope-Prüfungen der Analysis Tests (M5/M5a/M5b in tests.service:
 * S-Block-Präsenz, 1:1-Kopplung scope_uuids↔file, Anker-Konsistenz).
 * Gibt null zurück, wenn das Template nirgends auflösbar ist.
 */
async function getTemplateSource(templateName, source = 'query') {
  const templateDir =
    source === 'report'
      ? environment.templates.dir
      : environment.templates.customDir;
  let template;
  try {
    template = await loadTemplate(templateName, templateDir);
  } catch (err) {
    if (err.code !== 'TEMPLATE_NOT_FOUND' || source !== 'query') return null;
    let foundDir = null;
    if (environment.templates.detailsDir) {
      foundDir = await findTemplateDirRecursive(environment.templates.detailsDir, templateName);
    }
    if (!foundDir) {
      const bundleRoots = [
        environment.templates.dashboardsCustomDir,
        environment.templates.dashboardsDir,
      ].filter(Boolean);
      foundDir = await findInBundleQueries(bundleRoots, templateName);
    }
    if (!foundDir) return null;
    try {
      template = await loadTemplate(templateName, foundDir);
    } catch {
      return null;
    }
  }
  return { name: templateName, content: template.content, metadata: template.metadata };
}

/**
 * Clear template cache (useful for development/testing)
 */
function clearCache() {
  templateCache.clear();
}

module.exports = {
  executeTemplate,
  listTemplates,
  getTemplateMeta,
  getTemplateSource,
  clearCache,
  // Export for testing
  parseTemplateMetadata,
  interpolateTemplate,
  validateTemplateOutput,
};
