const express = require('express');
const router = express.Router({ caseSensitive: false });

const objectRoutes = require('./object.routes');
const systemRoutes = require('./system.routes');
const queryRoutes = require('./query.routes');
const adminRoutes = require('./admin.routes');
const pluginsRoutes = require('./plugins.routes');
const pluginDocsRoutes = require('./plugin-docs.routes');
const relationshipGraphRoutes = require('./relationshipGraph.routes');
const referenceRoutes = require('./reference.routes');
const dashboardRoutes = require('./dashboard.routes');
const { loadPlugins } = require('../plugins/loader');

/**
 * Route Aggregator
 * Combines all route modules
 */

// Object-related routes (/api/get, /api/list, etc.)
router.use('/', objectRoutes);

// System routes (/api/version, /api/info)
router.use('/', systemRoutes);

// Query & Report routes (/api/query, /api/report)
router.use('/', queryRoutes);

// Admin routes (/api/admin/reload)
router.use('/', adminRoutes);

// Plugins metadata API (/api/plugins) — must be mounted before loadPlugins()
router.use('/', pluginsRoutes);

// Plugin function documentation (/api/plugin-docs)
router.use('/', pluginDocsRoutes);

// Relationship Graph (/api/relationship-graph/:fileName)
router.use('/', relationshipGraphRoutes);

// Reference-DB (Script Steps + Functions + Claris-Hilfe-Mirror)
router.use('/', referenceRoutes);

// Dashboards (deklarative Bundles aus templates/dashboards/)
router.use('/', dashboardRoutes);

// Plugin routes (dynamically discovered)
loadPlugins(router);

module.exports = router;
