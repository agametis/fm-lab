#!/usr/bin/env node
/**
 * Register or update a documentation source in the docs install-state overlay
 * `.fmlab/docs.installed.json` (v2 schema).
 *
 * Called by the `install-*-docs` skills at the end of their install / update
 * flow. Updates an entry in the `installed[]` list — the maintainer-curated
 * `catalog[]` in `.fmlab/docs.json` stays untouched.
 *
 * Usage (from any installer script):
 *
 *     node tools/register_docs.mjs \
 *         --id mbs \
 *         --directory docs/mbs \
 *         --version 2026-05-20 \
 *         --languages en \
 *         --categories 168 \
 *         --functions 7298
 *
 * Multiple `--languages` flags are supported (or pass a comma-separated list).
 * Numeric fields accept `none` to mark "not applicable" — useful for plain
 * markdown docs without a function index (e.g. fmIDE wiki). Both `--flag value`
 * and `--flag=value` are accepted.
 *
 * The overlay is rewritten atomically. Existing entries with the same `id` in
 * `installed[]` are replaced (not merged) so installers stay the single source
 * of truth for their own runtime metadata. Other entries are left untouched.
 *
 * Node standard library only (Node >= 22) — no Python required.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_SCHEMA_VERSION = 2;

// Value flags → key in `opts`. Legacy v1 flags (--name, --description, --skill,
// --source-url) are accepted but ignored so existing installer scripts keep
// working; catalog metadata lives in catalog[] of .fmlab/docs.json.
const VALUE_FLAGS = {
  '--id': 'id',
  '--directory': 'directory',
  '--version': 'version',
  '--languages': 'languages',
  '--categories': 'categories',
  '--functions': 'functions',
  '--index-ok': 'indexOk',
  '--installed-at': 'installedAt',
  '--name': null,
  '--description': null,
  '--skill': null,
  '--source-url': null,
};

function usageError(msg) {
  process.stderr.write(`register_docs: error: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { languages: [], remove: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--remove') { opts.remove = true; continue; }
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (!(flag in VALUE_FLAGS)) usageError(`unrecognized argument: ${arg}`);
    let value;
    if (eq > 0) {
      value = arg.slice(eq + 1);
    } else {
      if (i + 1 >= argv.length) usageError(`argument ${flag}: expected one argument`);
      value = argv[++i];
    }
    const key = VALUE_FLAGS[flag];
    if (key === 'languages') opts.languages.push(value);
    else if (key) opts[key] = value;
  }
  if (!opts.id) usageError('the following arguments are required: --id');
  if (!opts.directory && !opts.remove) usageError('the following arguments are required: --directory');
  return opts;
}

function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: here,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (out && fs.existsSync(out)) return out;
  } catch {
    // not a git checkout (e.g. extracted release) — fall through
  }
  return path.dirname(here);
}

function parseIntOrNull(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (t === '' || ['none', 'null'].includes(t.toLowerCase())) return null;
  if (!/^[+-]?\d+$/.test(t)) {
    process.stderr.write(`register_docs: ignoring non-integer value '${t}'\n`);
    return null;
  }
  return Number.parseInt(t, 10);
}

function parseLanguages(values) {
  const out = [];
  for (const v of values) {
    for (const part of v.split(',')) {
      const p = part.trim();
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

function parseBoolOrNull(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim().toLowerCase();
  if (['', 'none', 'null'].includes(t)) return null;
  if (['true', 'yes', '1', 'ok'].includes(t)) return true;
  if (['false', 'no', '0'].includes(t)) return false;
  return null;
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.docs.${process.pid}.${Date.now()}.json`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Runtime install-state list from the overlay (.fmlab/docs.installed.json).
 *
 * The overlay is gitignored and holds ONLY sets registered by install-*-docs
 * runs, so a `git pull` never conflicts with local install state. It is
 * intentionally NOT seeded from docs.json: the shipped docs.json carries the
 * catalog[] plus any pre-installed skill-less sets in its own installed[]; the
 * reader (docs-manifest.js) merges that baseline with this overlay. Seeding here
 * would duplicate the baseline into the overlay and let it drift. Absent overlay
 * → empty (the baseline still shows via the merge).
 */
function loadInstalled(overlayPath) {
  if (!fs.existsSync(overlayPath)) return [];
  return JSON.parse(fs.readFileSync(overlayPath, 'utf8')).installed || [];
}

function writeInstalled(overlayPath, installed) {
  writeAtomic(overlayPath, { $schema_version: CURRENT_SCHEMA_VERSION, installed });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const overlayPath = path.join(repoRoot(), '.fmlab', 'docs.installed.json');
  const others = loadInstalled(overlayPath).filter((d) => !d || d.id !== opts.id);

  if (opts.remove) {
    writeInstalled(overlayPath, others);
    console.log(`register_docs: removed '${opts.id}' from installed[] in ${overlayPath}`);
    return;
  }

  const entry = {
    id: opts.id,
    directory: opts.directory,
    version: opts.version ?? null,
    installed_at: opts.installedAt || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    languages: parseLanguages(opts.languages),
    stats: {
      categories: parseIntOrNull(opts.categories),
      functions: parseIntOrNull(opts.functions),
      index_ok: parseBoolOrNull(opts.indexOk),
    },
  };

  writeInstalled(overlayPath, [...others, entry]);
  console.log(`register_docs: '${opts.id}' written to installed[] in ${overlayPath}`);
}

main();
