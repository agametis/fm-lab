const express = require('express');
const router = express.Router({ caseSensitive: false });
const systemController = require('../controllers/system.controller');
const { validate } = require('../middleware/validator');

/**
 * System Routes
 * Routes for system information endpoints
 */

// GET /api/version - API version and health
router.get('/version', systemController.version);

// GET /api/info - Solution information
router.get('/info', validate('info'), systemController.info);

// GET /api/system/config - Public client configuration (default language, API URL override, …)
router.get('/system/config', systemController.config);

// PUT /api/system/config - Persist client configuration (REST-API URL override)
router.put('/system/config', systemController.updateConfig);

module.exports = router;
