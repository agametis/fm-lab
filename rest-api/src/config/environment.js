const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

/**
 * Environment configuration with defaults and validation
 */
const environment = {
  // Server Configuration
  port: parseInt(process.env.PORT) || 3003,
  host: process.env.HOST || 'localhost',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database Configuration (paths relative to rest-api/)
  // Default: lokale READ_ONLY-Kopie der Master-DB, die von convert-xml
  // synchronisiert wird. Siehe project/plan-db-architektur.md.
  duckdb: {
    path: process.env.DUCKDB_PATH || './db/fm_catalog.duckdb',
    maxMemory: process.env.DUCKDB_MAX_MEMORY || '2GB',
    threads: parseInt(process.env.DUCKDB_THREADS) || 4,
  },

  // Admin-Endpoint (Reload-Token). Leer = offener Zugriff (Dev-Default).
  admin: {
    reloadToken: process.env.ADMIN_RELOAD_TOKEN || '',
  },

  // Template Configuration
  templates: {
    dir: process.env.TEMPLATE_DIR || path.resolve(__dirname, '../../templates/sql'),
    customDir: process.env.TEMPLATE_CUSTOM_DIR || path.resolve(__dirname, '../../templates/sql-custom'),
    // Detail-View-Templates (intern, von UI-Hooks/Controllern via /api/query geladen,
    // erscheinen aber nicht im "Custom Queries"-Dashboard). Rekursiver Fallback-Lookup
    // im Template-Service, wenn ein Template nicht in customDir gefunden wird.
    detailsDir: process.env.TEMPLATE_DETAILS_DIR || path.resolve(__dirname, '../../templates/sql-custom-details'),
    // Dashboard-Bundles: System-Bundles (home, _generic, Navigation) liegen in dashboardsDir,
    // Custom-/Plugin-Bundles in dashboardsCustomDir. Custom-Bundles haben Vorrang bei
    // ID-Kollisionen (Override-Pattern für lokale Erweiterungen).
    dashboardsDir: process.env.DASHBOARDS_DIR || path.resolve(__dirname, '../../templates/dashboards'),
    dashboardsCustomDir: process.env.DASHBOARDS_CUSTOM_DIR || path.resolve(__dirname, '../../templates/dashboards-custom'),
    cacheEnabled: process.env.TEMPLATE_CACHE_ENABLED !== 'false',
    cacheTTL: parseInt(process.env.TEMPLATE_CACHE_TTL) || 3600000, // 1 hour
  },

  // XML Import Configuration
  xml: {
    dir: process.env.XML_DIR || '../xml',
    convertScript: process.env.CONVERT_XML_SCRIPT || '../sql/convert-xml/convert_xml_01_extract.sql',
    catalogsScript: process.env.CREATE_CATALOGS_SCRIPT || '../sql/convert-xml/convert_xml_04_catalog.sql',
  },

  // Obsidian Documentation
  obsidian: {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || null,
  },

  // Plugin-Funktions-Dokumentation (MBS, künftig weitere Quellen)
  // Pfade relativ zur rest-api/ — Default zeigt auf docs/mbs/ im Projekt-Root.
  pluginDocs: {
    mbsPath: process.env.PLUGIN_DOCS_MBS_PATH || '../docs/mbs',
    cacheTTL: parseInt(process.env.PLUGIN_DOCS_CACHE_TTL_MS) || 3600000, // 1h
    cacheMaxDocs: parseInt(process.env.PLUGIN_DOCS_CACHE_MAX_DOCS) || 500,
    cacheMaxPaths: parseInt(process.env.PLUGIN_DOCS_CACHE_MAX_PATHS) || 1000,
  },

  // Reference-DB (Script Steps + Functions, lokalisierte Claris-Metadaten)
  // Pfade relativ zur rest-api/. ATTACH-Alias 'ref' wird in database.js gesetzt.
  // htmlCacheRoot zeigt auf den vom Skill `install-claris-docs` gepflegten Mirror.
  reference: {
    duckdbPath:    process.env.REFERENCE_DUCKDB_PATH    || './db/fm_reference.duckdb',
    htmlCacheRoot: process.env.REFERENCE_HTML_ROOT     || '../docs/claris-help',
    htmlSubdir:    'content',                                  // <lang>/content/<slug>.html
    cacheTtlMs:    parseInt(process.env.REFERENCE_CACHE_TTL_MS) || 3600000,       // DB-Meta 1h
    htmlCacheTtlMs: parseInt(process.env.REFERENCE_HTML_CACHE_TTL_MS) || 86400000, // HTML 24h
    defaultLang:   process.env.REFERENCE_DEFAULT_LANG || 'en',
  },

  // API Configuration
  api: {
    defaultLimit: parseInt(process.env.DEFAULT_LIMIT) || 100,
    maxLimit: parseInt(process.env.MAX_LIMIT) || 10000,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000,
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/api.log',
  },

  // CORS Configuration
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origin: process.env.CORS_ORIGIN || '*',
  },
};

/**
 * Validate required environment variables
 */
function validate() {
  const errors = [];

  // Check if DuckDB path exists (when not in development mode for initial setup)
  if (environment.nodeEnv !== 'development') {
    const fs = require('fs');
    const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);
    if (!fs.existsSync(dbPath)) {
      errors.push(`DuckDB database not found at: ${dbPath}`);
    }
  }

  if (errors.length > 0) {
    console.error('Environment validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

// Validate on module load
if (process.env.NODE_ENV !== 'test') {
  validate();
}

module.exports = environment;
