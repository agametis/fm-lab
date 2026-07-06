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
    // Default großzügig (Graph-Analyse lohnt v.a. auf großen Lösungen). Bei
    // Überschreitung spillt DuckDB auf DUCKDB_TEMP_DIR statt zu crashen.
    maxMemory: process.env.DUCKDB_MAX_MEMORY || '8GB',
    threads: parseInt(process.env.DUCKDB_THREADS) || 4,
    // Thread-Deckel für Overview/Atlas-Queries (graph.service.js). Ihr Buffer-Peak
    // skaliert mit der Thread-Zahl; gedeckelt bleibt der Per-Query-Footprint klein,
    // sodass auch auf sehr großen Graphen ein Atlas-Klick den Buffer nicht allein
    // auffrisst. 0 = kein Deckel (volle DUCKDB_THREADS).
    overviewThreads: Number.isFinite(parseInt(process.env.DUCKDB_OVERVIEW_THREADS))
      ? parseInt(process.env.DUCKDB_OVERVIEW_THREADS)
      : 4,
    // Obere Tiefen-Grenze für den Graph Explorer (Schieberegler-Erweiterung + Walk-
    // Deckel des depth-profile). GUI-Default bleibt 4; nur die Opt-in-Erweiterung
    // („tiefer") geht bis hierher. Auch der Runaway-Schutz des depth-profile-Walks.
    graphMaxDepth: Number.isFinite(parseInt(process.env.GRAPH_MAX_DEPTH))
      ? Math.max(4, parseInt(process.env.GRAPH_MAX_DEPTH))
      : 16,
  },

  // Admin-Endpoint (Reload-Token). Leer = offener Zugriff (Dev-Default).
  admin: {
    reloadToken: process.env.ADMIN_RELOAD_TOKEN || '',
  },

  // User-Annotationen (Sidecar-DB). Eigene SCHREIBBARE DuckDB-Datei, von der API
  // RW gehalten — getrennt von der READ_ONLY-Analyse-Kopie und damit lock-frei
  // gegenüber convert-xml/cluster.sh (die fm_catalog.duckdb exklusiv sperren).
  // Hält Node-Sichtbarkeit + Community-Namen/Notizen (Noise-Filter & semantische
  // Anreicherung). Default: Projekt-Root db/, kanonisch geteilt mit cluster.sh
  // (P4 Offline-Survival). enabled=false schaltet das Feature komplett ab (No-op).
  annotations: {
    enabled: process.env.ANNOTATIONS_ENABLED !== 'false',
    path: process.env.ANNOTATIONS_DB_PATH || '../db/fm_annotations.duckdb',
    // Schreib-Token analog zum Reload-Token. Leer = offener Zugriff (Dev-Default).
    writeToken: process.env.ANNOTATIONS_WRITE_TOKEN || '',
  },

  // R4 — zwei orthogonale Drift-Schwellenpaare für den semantic_names-Block
  // ① Struktur strenger (95/80): schon wenige nicht-geclusterte
  // Objekte rechtfertigen einen billigen Button-Klick. ② Benennung lockerer
  // (90/75): ein Skill-Lauf (LLM) ist teurer. Werte landen via
  // semantic_names.thresholds in der Payload → Frontend liest sie aus der
  // Antwort (keine Neukompilierung).
  semanticNames: {
    structDrift: {
      warn: parseInt(process.env.STRUCT_DRIFT_WARN) || 95,
      crit: parseInt(process.env.STRUCT_DRIFT_CRIT) || 80,
    },
    nameDrift: {
      warn: parseInt(process.env.NAME_DRIFT_WARN) || 90,
      crit: parseInt(process.env.NAME_DRIFT_CRIT) || 75,
    },
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
    // Exportierte Library-Pakete (.zip) aus dem Ordner-Export (Feature C/D, E1).
    dashboardsPackagesDir: process.env.DASHBOARDS_PACKAGES_DIR || path.resolve(__dirname, '../../templates/dashboards-packages'),
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

  // Debug-Session-Logging (korrelierte Frontend-Interaktion + Backend-Prozesse
  // + DuckDB-Memory-Deltas in EIN JSONL). Zwei Schalter (kombiniert):
  //   master  — DEBUG_SESSION=1 loggt JEDEN Request (auch parallele Tabs/Hintergrund
  //             — fängt Nebenläufigkeit/OOM am vollständigsten).
  //   focused — Frontend ?debug=1 markiert eine Session-ID (Header X-Debug-Session),
  //             die immer geloggt wird, auch ohne master.
  // Aktiv-geloggt wird ein Request, wenn master ODER eine Session-ID anliegt.
  debugSession: {
    master: process.env.DEBUG_SESSION === '1' || process.env.DEBUG_SESSION === 'true',
    file: process.env.DEBUG_SESSION_FILE || './logs/debug-session.jsonl',
    // DuckDB-Memory-Probe pro Query (kostet eine Extra-Abfrage auf duckdb_memory()).
    // Default an, wenn überhaupt geloggt wird; per ENV abschaltbar.
    probeMemory: process.env.DEBUG_SESSION_MEMORY !== '0',
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
