const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const environment = require('../config/environment');
const { resolveDbPath } = require('../config/solutions');
const { createError } = require('../middleware/error-handler');

/**
 * Codegen service — wraps the fmgen pipeline (parse → resolve → emit → gate)
 * as a stateless compute step. No catalog write ever happens here: fmgen
 * opens the solution's catalog copy read-only for reference resolution.
 *
 * The fmgen CLI lives in the fm-generate-script skill; installations without
 * that skill respond with CODEGEN_NOT_AVAILABLE instead of failing weirdly.
 */

const REST_API_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(REST_API_ROOT, '..');

const FMGEN_SCRIPT =
  process.env.FMGEN_SCRIPT ||
  path.join(REPO_ROOT, '.claude/skills/fm-generate-script/scripts/fmgen.py');
const FMGEN_PYTHON = process.env.FMGEN_PYTHON || 'python3';
const FMGEN_TIMEOUT_MS = parseInt(process.env.FMGEN_TIMEOUT_MS) || 30000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function referenceDbPath() {
  return path.resolve(REST_API_ROOT, environment.reference.duckdbPath);
}

function assertAvailable() {
  if (!fs.existsSync(FMGEN_SCRIPT)) {
    throw createError(
      'CODEGEN_NOT_AVAILABLE',
      'fmgen pipeline is not installed (fm-generate-script skill missing)',
      { expectedPath: FMGEN_SCRIPT },
    );
  }
  if (!fs.existsSync(referenceDbPath())) {
    throw createError(
      'CODEGEN_NOT_AVAILABLE',
      'reference database fm_spec.duckdb not found',
      { expectedPath: referenceDbPath() },
    );
  }
}

function runFmgen(args) {
  return new Promise((resolve, reject) => {
    execFile(
      FMGEN_PYTHON,
      [FMGEN_SCRIPT, ...args],
      {
        timeout: FMGEN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
        cwd: REPO_ROOT,
      },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          return reject(
            createError('CODEGEN_TIMEOUT', 'fmgen exceeded the execution time limit', {
              timeoutMs: FMGEN_TIMEOUT_MS,
            }),
          );
        }
        // Exit code 2 = findings with severity error (a pipeline verdict,
        // not a transport failure) — surface it as data, not as HTTP error.
        const exitCode = err ? err.code : 0;
        if (err && typeof exitCode !== 'number') {
          return reject(
            createError('CODEGEN_ERROR', `fmgen could not be executed: ${err.message}`),
          );
        }
        if (exitCode !== 0 && exitCode !== 2) {
          return reject(
            createError('CODEGEN_ERROR', 'fmgen reported an environment/database problem', {
              exitCode,
              log: String(stderr).slice(-2000),
            }),
          );
        }
        resolve({ exitCode, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fmlab-codegen-'));
}

function cleanupTmpDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * POST /api/codegen/lint — parse + lint only (no catalog access).
 * Fast path for editor diagnostics on save.
 */
async function lint(ctx, { text }) {
  assertAvailable();
  const tmpDir = makeTmpDir();
  try {
    const draftPath = path.join(tmpDir, 'draft.fmscript');
    fs.writeFileSync(draftPath, text, 'utf8');

    const { exitCode, stdout } = await runFmgen([
      '--reference-db', referenceDbPath(),
      'parse', draftPath,
    ]);

    let ir;
    try {
      ir = JSON.parse(stdout);
    } catch {
      throw createError('CODEGEN_ERROR', 'fmgen parse returned no parseable JSON');
    }

    return {
      ok: exitCode === 0,
      lint: ir.lint ?? [],
      steps: (ir.steps ?? []).map(s => ({
        line: s.line,
        stepId: s.step_id,
        canonicalName: s.canonical_name,
        enabled: s.enabled,
      })),
      normalization: ir.normalization ?? null,
    };
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

/**
 * POST /api/codegen/compile — full pipeline (parse → resolve → emit → gate)
 * against the request context's solution catalog. Stateless; the snippet is
 * returned to the caller, nothing is written to the catalog.
 */
async function compile(ctx, { text, file }) {
  assertAvailable();
  const tmpDir = makeTmpDir();
  try {
    const draftPath = path.join(tmpDir, 'draft.fmscript');
    const outDir = path.join(tmpDir, 'out');
    fs.writeFileSync(draftPath, text, 'utf8');

    const catalogDb = resolveDbPath(ctx?.solution);
    if (!fs.existsSync(catalogDb)) {
      throw createError('CODEGEN_ERROR', 'solution catalog database not found', {
        solution: ctx?.solution ?? null,
      });
    }

    const { exitCode, stderr } = await runFmgen([
      '--reference-db', referenceDbPath(),
      '--catalog-db', catalogDb,
      'run', draftPath,
      '--file', file,
      '--out-dir', outDir,
    ]);

    const ir = readJsonIfExists(path.join(outDir, 'draft.ir.json'));
    const resolved = readJsonIfExists(path.join(outDir, 'draft.resolved.json'));
    const gate = readJsonIfExists(path.join(outDir, 'draft.gate.json'));
    const snippet = readTextIfExists(path.join(outDir, 'draft.xml'));

    return {
      ok: exitCode === 0 && snippet != null,
      exitCode,
      lint: ir?.lint ?? [],
      resolution: resolved?.resolution ?? null,
      gate,
      snippet,
      // Human-readable phase summary (one line per phase) for UI display.
      // The per-request tmp dir is deleted before the response leaves —
      // pointing users at it would be a dead reference.
      log: stderr
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-8)
        .map(line => line.split(tmpDir).join('…').replace(/ [—-] see …\S*/g, '')),
    };
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

/**
 * POST /api/codegen/decompile — fmxmlsnippet XML → canonical text form
 * (reverse direction, e.g. clipboard content copied out of FileMaker).
 * The catalog is only used to enrich layout references with their table
 * occurrence; decompilation itself is table-driven from fm_spec.
 */
async function decompile(ctx, { xml, file }) {
  assertAvailable();
  const tmpDir = makeTmpDir();
  try {
    const inputPath = path.join(tmpDir, 'snippet.xml');
    fs.writeFileSync(inputPath, xml, 'utf8');

    const args = ['--reference-db', referenceDbPath()];
    const catalogDb = resolveDbPath(ctx?.solution);
    if (fs.existsSync(catalogDb)) {
      args.push('--catalog-db', catalogDb);
    }
    args.push('decompile', inputPath, '--json');
    if (file) args.push('--file', file);

    const { exitCode, stdout } = await runFmgen(args);
    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw createError('CODEGEN_ERROR', 'fmgen decompile returned no parseable JSON');
    }
    if (payload.errors) {
      return { ok: false, errors: payload.errors, text: null, steps: [], lossy: 0 };
    }
    return {
      ok: exitCode === 0,
      text: payload.text,
      steps: payload.steps,
      lossy: payload.lossy,
    };
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

module.exports = { lint, compile, decompile };
