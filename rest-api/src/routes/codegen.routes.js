const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/codegen.controller');
const { validate } = require('../middleware/validator');

/**
 * Codegen Routes — fmgen pipeline as stateless compute endpoints.
 * No catalog write; the solution context (X-Solution) only selects the
 * catalog copy used for reference resolution. Mounted under /api.
 */

// POST /api/codegen/lint — parse + lint a script draft (editor diagnostics)
router.post('/codegen/lint', validate('codegenLint', 'body'), controller.lint);

// POST /api/codegen/compile — full pipeline: parse → resolve → emit → gate
router.post('/codegen/compile', validate('codegenCompile', 'body'), controller.compile);

// POST /api/codegen/decompile — fmxmlsnippet → kanonische Textform (Paste-Import)
router.post('/codegen/decompile', validate('codegenDecompile', 'body'), controller.decompile);

module.exports = router;
