#!/usr/bin/env node
/**
 * Claris Online Help Crawler — downloads a complete language set of the Claris
 * FileMaker Pro online help (help.claris.com) to a local mirror directory.
 *
 * Crawls BFS starting from <root>/content/index.html, follows all internal links
 * to .html pages within the same /content/ scope, and downloads referenced
 * assets (CSS, JS, images) from /Skins/, /Resources/ and /assets/.
 *
 * Transport is curl (one process per file, run in parallel): it honours
 * HTTP(S)_PROXY / NO_PROXY on every platform and Node version, which Node's
 * built-in fetch does not. Node standard library only (Node >= 22) — no Python.
 *
 * Usage:
 *     node claris_crawler.mjs --lang=<code> --output=<dir> [--max-workers=N] [--dry-run] [--quiet]
 *
 * Exit codes:
 *     0  Success
 *     1  Invalid arguments
 *     2  Network/setup error before any download
 *     3  Crawl completed but with significant errors (>5% pages failed)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// -------------------- Configuration --------------------

const BASE = 'https://help.claris.com';
const USER_AGENT = 'Mozilla/5.0 (compatible; fm-lab-claris-installer/1.0; +https://github.com/anthropics/claude-code)';
const TIMEOUT = 30; // seconds: connect timeout and stall timeout (no data for TIMEOUT s)
const RETRIES = 3;
const RETRY_BACKOFF = 2.0;

// Reasonable safety cap — actual help is ~1000-1500 pages
const MAX_PAGES = 5000;

// -------------------- Regex --------------------

const HREF_RE = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
const CSS_URL_RE = /url\(\s*["']?([^)"']+)["']?\s*\)/g;
const CSS_IMPORT_RE = /@import\s+(?:url\()?["']([^"')]+)["']/gi;

// -------------------- HTTP (curl) --------------------

class HttpError extends Error {
  constructor(code) {
    super(`HTTP ${code}`);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let tmpCounter = 0;
const uniqueSuffix = () => `.tmp-${process.pid}-${++tmpCounter}`;

/** One curl download into `dest`. Resolves on success, rejects with HttpError / Error. */
function curlOnce(url, dest) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '-sS', '-L', '--fail',
      '-A', USER_AGENT,
      '--connect-timeout', String(TIMEOUT),
      '--speed-limit', '1', '--speed-time', String(TIMEOUT),
      '-o', dest,
      '-w', '%{http_code}',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`curl: ${e.message}`)));
    child.on('close', (rc) => {
      if (rc === 0) return resolve();
      fs.rmSync(dest, { force: true });
      const status = parseInt(out.trim(), 10);
      if (rc === 22 && status >= 400) return reject(new HttpError(status));
      reject(new Error(`curl exit ${rc}: ${err.trim().split('\n').pop() || 'transfer failed'}`));
    });
  });
}

/** Fetch URL into `dest` with retries; permanent errors (404/410) are not retried. */
async function httpGet(url, dest) {
  let lastErr = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      await curlOnce(url, dest);
      return;
    } catch (e) {
      if (e instanceof HttpError && (e.code === 404 || e.code === 410)) throw e;
      lastErr = e;
    }
    if (attempt < RETRIES - 1) await sleep(RETRY_BACKOFF * (attempt + 1) * 1000);
  }
  throw lastErr || new Error(`failed: ${url}`);
}

// -------------------- URL helpers --------------------

/**
 * Map a Claris-help URL to a local filesystem path.
 *
 *   https://help.claris.com/<lang>/pro-help/content/foo.html  → <out>/<lang>/content/foo.html
 *   https://help.claris.com/<lang>/pro-help/Skins/x.css       → <out>/<lang>/Skins/x.css
 *   https://help.claris.com/<lang>/pro-help/Resources/x.js    → <out>/<lang>/Resources/x.js
 *   https://help.claris.com/assets/css/x.css                  → <out>/<lang>/assets/css/x.css
 */
function urlToLocalPath(url, lang, outputRoot) {
  const p = new URL(url).pathname;
  const langRoot = `/${lang}/pro-help/`;
  if (p.startsWith(langRoot)) return path.join(outputRoot, lang, p.slice(langRoot.length));
  if (p.startsWith('/assets/')) return path.join(outputRoot, lang, p.slice(1));
  return null; // other paths: skip (external)
}

/** Resolve a possibly-relative ref against baseUrl. Strip fragments and queries. */
function normalizeUrl(baseUrl, ref) {
  if (!ref || ref.startsWith('javascript:') || ref.startsWith('mailto:') || ref.startsWith('#')) return null;
  try {
    const u = new URL(ref, baseUrl);
    u.hash = '';
    u.search = '';
    return u.href;
  } catch {
    return null;
  }
}

/** Only crawl URLs within our language's pro-help tree or global /assets/. */
function isInScope(url, lang) {
  const u = new URL(url);
  if (u.host !== '' && u.host !== 'help.claris.com') return false;
  return u.pathname.startsWith(`/${lang}/pro-help/`) || u.pathname.startsWith('/assets/');
}

/** Is this a content HTML page that we should parse for further links? */
function isHtmlPage(url, lang) {
  const p = new URL(url).pathname;
  return p.startsWith(`/${lang}/pro-help/content/`) && p.endsWith('.html');
}

function extractLinks(text, baseUrl, regexes) {
  const out = [];
  for (const re of regexes) {
    for (const m of text.matchAll(re)) {
      const n = normalizeUrl(baseUrl, m[1]);
      if (n) out.push(n);
    }
  }
  return out;
}

// -------------------- Crawl --------------------

/** Run `fn` over `items` with at most `limit` concurrent calls. */
async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

async function crawlLanguage({ lang, outputRoot, maxWorkers = 8, dryRun = false, verbose = true }) {
  const stats = {
    htmlPages: 0,
    assets: 0,
    htmlFailures: new Map(), // critical: pages we couldn't download (url → reason)
    assetFailures: new Map(), // less critical: missing icons / fonts
    bytes: 0,
  };
  const startTs = Date.now();
  const log = (msg) => { if (verbose) console.log(msg); };

  // Dry run downloads into a scratch dir that is removed afterwards.
  const scratch = dryRun ? fs.mkdtempSync(path.join(os.tmpdir(), 'claris-crawl-')) : null;

  /** Download url → local path (atomic: unique temp file + rename). Returns the text if wanted. */
  async function download(url, local, wantText) {
    const dest = dryRun
      ? path.join(scratch, `f${uniqueSuffix()}`)
      : local + uniqueSuffix();
    if (!dryRun) fs.mkdirSync(path.dirname(local), { recursive: true });
    await httpGet(url, dest);
    try {
      const size = fs.statSync(dest).size;
      const text = wantText ? fs.readFileSync(dest, 'utf8') : null;
      if (dryRun) fs.rmSync(dest, { force: true });
      else fs.renameSync(dest, local);
      return { size, text };
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw e;
    }
  }

  const reason = (e) => (e instanceof HttpError ? `HTTP ${e.code}` : `${e.name}: ${e.message}`);

  // Phase 1: BFS crawl all HTML pages, collecting asset refs
  const startUrl = `${BASE}/${lang}/pro-help/content/index.html`;
  const seen = new Set([startUrl]);
  const assetUrls = new Set();
  const queue = [startUrl];
  let pagesProcessed = 0;
  let capped = false;

  log(`[${lang}] Discovering pages from index.html...`);

  async function fetchAndParseHtml(url) {
    let links = null;
    try {
      const local = urlToLocalPath(url, lang, outputRoot);
      const { size, text } = await download(url, local, true);
      stats.htmlPages += 1;
      stats.bytes += size;
      links = extractLinks(text, url, [HREF_RE]);
    } catch (e) {
      stats.htmlFailures.set(url, reason(e));
    }
    if (capped) return;
    pagesProcessed += 1;
    if (pagesProcessed % 50 === 0) {
      log(`[${lang}] ${pagesProcessed} pages crawled, ${stats.htmlPages} HTML, ${assetUrls.size} assets discovered`);
    }
    if (pagesProcessed >= MAX_PAGES) {
      log(`[${lang}] WARN: MAX_PAGES (${MAX_PAGES}) reached`);
      capped = true;
      return;
    }
    for (const link of links || []) {
      if (!isInScope(link, lang)) continue;
      if (isHtmlPage(link, lang)) {
        if (!seen.has(link)) {
          seen.add(link);
          queue.push(link);
        }
      } else {
        // Treat as asset (CSS, JS, image, font)
        assetUrls.add(link);
      }
    }
  }

  // Dynamic worker pool: workers keep pulling from the queue until it is empty
  // AND no page is in flight (an in-flight page may still enqueue new links).
  await new Promise((resolve) => {
    let active = 0;
    const pump = () => {
      while (!capped && active < maxWorkers && queue.length) {
        active += 1;
        fetchAndParseHtml(queue.shift()).finally(() => {
          active -= 1;
          pump();
        });
      }
      if (active === 0 && (capped || !queue.length)) resolve();
    };
    pump();
  });

  log(`[${lang}] HTML phase done: ${stats.htmlPages} pages, ${stats.htmlFailures.size} failures, ${assetUrls.size} assets queued`);

  // Phase 2: Download all assets (no parsing for further references except CSS)
  // CSS may reference more assets (fonts, images) so we do one more level
  const cssRefs = new Set();

  async function fetchAsset(url, parseCss) {
    const local = urlToLocalPath(url, lang, outputRoot);
    if (!local) return;
    const isCss = parseCss && url.toLowerCase().endsWith('.css');
    try {
      const { size, text } = await download(url, local, isCss);
      stats.assets += 1;
      stats.bytes += size;
      if (isCss && text) {
        for (const ref of extractLinks(text, url, [CSS_URL_RE, CSS_IMPORT_RE])) {
          if (isInScope(ref, lang) && !assetUrls.has(ref)) cssRefs.add(ref);
        }
      }
    } catch (e) {
      stats.assetFailures.set(url, reason(e));
    }
  }

  log(`[${lang}] Downloading ${assetUrls.size} assets (${maxWorkers} workers)...`);
  let doneCount = 0;
  await pool(assetUrls, maxWorkers, async (url) => {
    await fetchAsset(url, true);
    doneCount += 1;
    if (doneCount % 25 === 0) log(`[${lang}]   asset ${doneCount}/${assetUrls.size}`);
  });

  // Phase 2b: download CSS-referenced assets
  if (cssRefs.size) {
    log(`[${lang}] Downloading ${cssRefs.size} CSS-referenced assets...`);
    await pool(cssRefs, maxWorkers, (url) => fetchAsset(url, false));
  }

  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });

  const duration = (Date.now() - startTs) / 1000;
  const mb = stats.bytes / 1024 / 1024;
  const htmlFailures = [...stats.htmlFailures.entries()];

  // "Incomplete" = HTML pages failed at >5%. Asset 404s are non-critical
  // (often broken CSS references to icons/fonts that don't affect content).
  const incomplete = stats.htmlPages === 0 || htmlFailures.length > Math.max(5, stats.htmlPages * 0.05);

  log(`[${lang}] Done: ${stats.htmlPages} HTML + ${stats.assets} assets, ${mb.toFixed(1)} MB, ${duration.toFixed(1)}s, `
    + `${htmlFailures.length} HTML failures, ${stats.assetFailures.size} asset failures`);

  return {
    lang,
    html_pages: stats.htmlPages,
    asset_files: stats.assets,
    total_size_bytes: stats.bytes,
    duration_seconds: Math.round(duration * 10) / 10,
    html_failures: htmlFailures,
    asset_failures_count: stats.assetFailures.size,
    incomplete,
  };
}

// -------------------- Main --------------------

function parseArgs(argv) {
  const opts = { maxWorkers: 8, dryRun: false, quiet: false };
  const fail = (msg) => {
    process.stderr.write(`claris_crawler: error: ${msg}\n`
      + 'usage: claris_crawler.mjs --lang=<code> --output=<dir> [--max-workers=N] [--dry-run] [--quiet]\n');
    process.exit(1);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg === '--quiet') { opts.quiet = true; continue; }
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (!['--lang', '--output', '--max-workers'].includes(flag)) fail(`unrecognized argument: ${arg}`);
    let value;
    if (eq > 0) value = arg.slice(eq + 1);
    else if (i + 1 < argv.length) value = argv[++i];
    else fail(`argument ${flag}: expected one argument`);
    if (flag === '--lang') opts.lang = value;
    else if (flag === '--output') opts.output = value;
    else {
      opts.maxWorkers = Number.parseInt(value, 10);
      if (!Number.isInteger(opts.maxWorkers) || opts.maxWorkers < 1) fail(`argument --max-workers: invalid int value: '${value}'`);
    }
  }
  if (!opts.lang || !opts.output) fail('the following arguments are required: --lang, --output');
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const result = await crawlLanguage({
  lang: opts.lang,
  outputRoot: opts.output,
  maxWorkers: opts.maxWorkers,
  dryRun: opts.dryRun,
  verbose: !opts.quiet,
});

// Print JSON result on last line (for parent script to consume)
console.log('---CRAWL-RESULT---');
console.log(JSON.stringify(result));

if (result.incomplete) process.exit(3);
if (result.html_pages === 0) process.exit(2);
process.exit(0);
