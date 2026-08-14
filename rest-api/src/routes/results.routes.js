const express = require('express');
const router = express.Router({ caseSensitive: false });
const resultsController = require('../controllers/results.controller');

/**
 * Results Routes — unified result layer over dashboards / queries / tests.
 * Read endpoints only ever read the server cache; POST /run is the explicit
 * trigger (synchronous with a concurrency cap — the frontend chunks a full
 * root run per top-level folder).
 */

router.get('/results/summary',    resultsController.getSummary);
router.get('/results/aggregate',  resultsController.getAggregate);
router.get('/results/registry',   resultsController.getRegistry);
router.post('/results/run',       resultsController.postRun);

module.exports = router;
