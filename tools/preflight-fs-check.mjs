#!/usr/bin/env node
// preflight-fs-check.mjs — detects the macOS/VirtioFS "async open EPERM" bug BEFORE the
// Vite dev server surfaces it as a cryptic overlay ("EPERM: operation not permitted, open
// '.../apps/web/index.html'").
//
// WHY a dedicated Node probe (and not a shell `test -r`/`cat`): the failure is specific to
// Node's ASYNCHRONOUS open path (fs.promises.open → libuv threadpool). On some Docker
// Desktop/macOS VirtioFS versions the async open returns EPERM while the SYNCHRONOUS open
// (readFileSync, and a plain `cat`) on the very same file succeeds. Vite reads index.html
// via fs.promises.readFile, so only an async probe reproduces what Vite hits. A shell check
// would give a false all-clear.
//
// Exit codes (consumed by tools/start-servers.sh):
//   0  ok        — async read succeeded on every attempt; the FS is fine for Vite.
//   2  sync-fail — even the synchronous read fails: a genuine permission/ownership problem
//                  (wrong file owner, ACL, immutable flag) or the file is missing.
//   3  async-fail— sync read works but async open throws EPERM at least once: the VirtioFS
//                  async-open bug. This is what makes Vite serve a white page.
//
// The check emits ONE JSON line on stderr (machine-readable for the caller) and is silent
// on stdout. It never throws uncaught — every path maps to a defined exit code.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Target defaults to the file Vite actually reads first; overridable as argv[2].
const target = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(process.cwd(), 'apps/web/index.html');

// A few async attempts: the EPERM can be intermittent (it flipped between transient and
// persistent during diagnosis), so a single lucky read must not mask a broken mount.
const ATTEMPTS = 8;

function emit(obj) {
  process.stderr.write(JSON.stringify({ target, ...obj }) + '\n');
}

// 1) Synchronous baseline. If this fails, the problem is NOT the async-open bug — it is a
//    real permission/ownership/missing-file issue, which needs a different fix.
try {
  readFileSync(target);
} catch (e) {
  emit({ status: 'sync-fail', code: e.code ?? 'UNKNOWN' });
  process.exit(2);
}

// 2) Asynchronous path — the exact code path Vite uses. Repeat to catch intermittent EPERM.
let asyncFails = 0;
let lastCode = null;
for (let i = 0; i < ATTEMPTS; i++) {
  try {
    await readFile(target);
  } catch (e) {
    asyncFails++;
    lastCode = e.code ?? 'UNKNOWN';
  }
}

if (asyncFails > 0) {
  emit({ status: 'async-fail', code: lastCode, failed: asyncFails, attempts: ATTEMPTS });
  process.exit(3);
}

emit({ status: 'ok', attempts: ATTEMPTS });
process.exit(0);
