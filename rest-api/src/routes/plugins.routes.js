const express = require('express');
const Joi = require('joi');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/plugins.controller');
const { SUPPORTED_LANGUAGE_CODES } = require('../config/languages');

/**
 * Plugins Routes
 * Core endpoint (not plugin-provided) — must be mounted before loadPlugins().
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

router.get('/plugins',                    validateLangQuery, controller.list);
router.get('/plugins/:name',              validateLangQuery, controller.get);
router.patch('/plugins/:name', express.json(), validateLangQuery, controller.patch);

module.exports = router;
