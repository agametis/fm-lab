const express = require('express');
const Joi = require('joi');
const router = express.Router({ caseSensitive: false });
const dashboardController = require('../controllers/dashboard.controller');
const { SUPPORTED_LANGUAGE_CODES } = require('../config/languages');

/**
 * Dashboard Routes
 * PRD: project/prd_dashboards.md §7.2
 */

const langSchema = Joi.string().valid(...SUPPORTED_LANGUAGE_CODES);

function validateLangQuery(req, res, next) {
  if (req.query.lang === undefined) return next();
  const { error } = langSchema.validate(req.query.lang);
  if (error) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Invalid lang: ${req.query.lang}. Supported: ${SUPPORTED_LANGUAGE_CODES.join(', ')}`,
      },
    });
  }
  return next();
}

router.get('/dashboards',                     validateLangQuery, dashboardController.listDashboards);
router.get('/dashboards/:id',                 validateLangQuery, dashboardController.getDashboard);
router.get('/dashboards/:id/data',            dashboardController.getDashboardData);
router.get('/dashboards/:id/data/:dataset',   dashboardController.getDashboardDataset);

module.exports = router;
