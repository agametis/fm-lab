const express = require('express');
const Joi = require('joi');
const router = express.Router({ caseSensitive: false });
const testsController = require('../controllers/tests.controller');
const { SUPPORTED_LANGUAGE_CODES } = require('../config/languages');

/**
 * Analysis Tests Routes
 * Read-only in v1 — the editor CRUD (v1.1) mounts its own guarded routes.
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

router.get('/tests',                        validateLangQuery, testsController.listTests);
// Must mount before /tests/:id — "context" would otherwise resolve as a test id.
router.get('/tests/context',                testsController.getContext);
router.get('/tests/:id',                    validateLangQuery, testsController.getTest);
router.get('/tests/:id/run',                testsController.runTest);
router.get('/tests/:id/run/:memberIndex',   testsController.runTestMember);

module.exports = router;
