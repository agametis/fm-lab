const express = require('express');
const router = express.Router({ caseSensitive: false });
const dashboardController = require('../controllers/dashboard.controller');

/**
 * Dashboard Routes
 * PRD: project/prd_dashboards.md §7.2
 */

router.get('/dashboards', dashboardController.listDashboards);
router.get('/dashboards/:id', dashboardController.getDashboard);
router.get('/dashboards/:id/data', dashboardController.getDashboardData);
router.get('/dashboards/:id/data/:dataset', dashboardController.getDashboardDataset);

module.exports = router;
