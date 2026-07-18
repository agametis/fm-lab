const codegenService = require('../services/codegen.service');
const { buildSuccess } = require('../utils/response-builder');

/**
 * Codegen controller — stateless fmgen pipeline endpoints.
 * `X-Solution` (request context) selects the catalog used for resolution.
 */

async function lint(req, res, next) {
  try {
    const result = await codegenService.lint(req.solutionContext, {
      text: req.body.text,
    });
    res.json(buildSuccess(result));
  } catch (err) {
    next(err);
  }
}

async function compile(req, res, next) {
  try {
    const result = await codegenService.compile(req.solutionContext, {
      text: req.body.text,
      file: req.body.file,
    });
    res.json(buildSuccess(result));
  } catch (err) {
    next(err);
  }
}

async function decompile(req, res, next) {
  try {
    const result = await codegenService.decompile(req.solutionContext, {
      xml: req.body.xml,
      file: req.body.file,
    });
    res.json(buildSuccess(result));
  } catch (err) {
    next(err);
  }
}

module.exports = { lint, compile, decompile };
