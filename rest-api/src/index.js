const express = require('express');
const environment = require('./config/environment');
const db = require('./config/database');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error-handler');
const logger = require('./middleware/logger');
const corsMiddleware = require('./middleware/cors');
const normalizeQueryKeys = require('./middleware/query-normalizer');
const debugSessionMiddleware = require('./middleware/debug-session');

/**
 * FileMaker DuckDB Analysis API
 * Express application setup
 */

const app = express();

// Custom query parser that normalizes keys to lowercase
app.set('query parser', (queryString) => {
  const parsed = require('querystring').parse(queryString);
  const normalized = {};
  for (const [key, value] of Object.entries(parsed)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
});

// Middleware
app.use(corsMiddleware);
app.use(logger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug-Session: hängt req.debug an + loggt Request-Lifecycle in die korrelierte
// Zeitachse (nur aktiv bei DEBUG_SESSION=1 oder X-Debug-Session-Header). Nach
// dem Body-Parser, damit die Ingestion-Route den Body schon hat.
app.use(debugSessionMiddleware);

// API Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'FileMaker DuckDB Analysis API',
    version: require('../package.json').version,
    endpoints: {
      version: '/api/version',
      versionManifest: '/api/version-manifest',
      info: '/api/info',
      get: '/api/get?uuid=<uuid>',
      getDetails: '/api/get-details?uuid=<uuid>',
      list: '/api/list?type=<type>',
      count: '/api/count',
      search: '/api/search?name=<pattern>',
      searchCount: '/api/search/count?name=<pattern>',
      references: '/api/references?uuid=<uuid>',
      query: '/api/query?template=<name>',
      report: '/api/report?template=<name>',
      pluginDocs: '/api/plugin-docs/:source/:function',
      referenceCategories: '/api/reference/categories?lang=<lang>',
      referenceSteps: '/api/reference/steps?lang=<lang>',
      referenceStepDetail: '/api/reference/steps/:idOrSlug?lang=<lang>&content=<meta|summary|full>',
      referenceFunctions: '/api/reference/functions?lang=<lang>',
      referenceFunctionDetail: '/api/reference/functions/:nameOrId?lang=<lang>&content=<meta|summary|full>',
      referenceLookup: '/api/reference/lookup?token=<token>&lang=<lang>',
      referenceHelp: '/api/reference/help/:lang/:slug',
      referenceHelpStatus: '/api/reference/help/status',
      adminReload: 'POST /api/admin/reload',
    },
    documentation: 'See README.md for full API documentation',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

/**
 * Start server
 */
async function start() {
  try {
    // Initialize database connection
    console.log('Initializing database connection...');
    await db.initialize();

    // Initialize the writable annotations sidecar (Noise-Filter & semantic
    // enrichment). Guarded: if it can't be opened, the feature stays off and the
    // rest of the API runs unchanged.
    await require('./config/annotations-db').initialize();

    // Load the last persisted fmIDE scan into memory (no DB query). The scan
    // itself runs on plugin activation and on explicit Rescan, not every boot.
    try {
      require('./plugins/fmide/fmide.service').loadPersistedStatuses();
    } catch (err) {
      console.warn(`fmIDE status load skipped: ${err.message}`);
    }

    // Start HTTP server
    const server = app.listen(environment.port, environment.host, () => {
      console.log('');
      console.log('========================================');
      console.log('FileMaker DuckDB Analysis API');
      console.log('========================================');
      console.log(`Environment: ${environment.nodeEnv}`);
      console.log(`Server: http://${environment.host}:${environment.port}`);
      console.log(`API Endpoints: http://${environment.host}:${environment.port}/api`);
      console.log('========================================');
      console.log('');
      console.log('Available endpoints:');
      console.log(`  GET  /api/version        - API version and health`);
      console.log(`  GET  /api/version-manifest - Module version manifest`);
      console.log(`  GET  /api/info           - Solution information`);
      console.log(`  GET  /api/get            - Get object by UUID`);
      console.log(`  GET  /api/get-details    - Type-specific object details`);
      console.log(`  GET  /api/list           - List objects by type`);
      console.log(`  GET  /api/count          - Count objects`);
      console.log(`  GET  /api/search         - Search objects by name`);
      console.log(`  GET  /api/search/count   - Count search results`);
      console.log(`  GET  /api/references     - Get object references`);
      console.log(`  GET  /api/query          - Execute custom SQL template`);
      console.log(`  GET  /api/report         - Execute report SQL template`);
      console.log(`  GET  /api/plugin-docs    - Plugin function documentation (MBS, ...)`);
      console.log(`  GET  /api/reference/*    - FileMaker Reference (Steps, Functions, Help)`);
      console.log('');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM signal received: closing HTTP server');
      server.close(async () => {
        console.log('HTTP server closed');
        await db.close();
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('\nSIGINT signal received: closing HTTP server');
      server.close(async () => {
        console.log('HTTP server closed');
        await db.close();
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start if not in test mode
if (require.main === module) {
  start();
}

module.exports = app;
