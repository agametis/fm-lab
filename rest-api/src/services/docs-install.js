const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const docsManifest = require('./docs-manifest');
const settingsStore = require('../plugins/settings-store');

/**
 * Doc-Set-Installer Bridge
 *
 * Spawnt die Installer-Skills unter `.claude/skills/install-<id>-docs/scripts/`
 * im `--quiet`-Modus und parst deren NDJSON-Ausgabe Zeile für Zeile zu
 * strukturierten Events. Wird von `POST /api/docs/install/:id` (SSE) und
 * `GET /api/docs/:id/check` benutzt.
 *
 * Sicherheit (siehe PRD §5.3):
 *   - ID-Allowlist: nur Doc-Sets, die im Manifest-Katalog stehen, dürfen
 *     installiert werden.
 *   - ID-Format: strikt `[a-z][a-z0-9-]{0,63}` → keine Pfad-/Argument-Injection.
 *   - Kommando-Pfad ist fix verdrahtet: `.claude/skills/install-<id>-docs/
 *     scripts/install_<id>_docs.sh`. Nutzer-Input fließt nur in die ID, nicht
 *     in den Argument-Vektor.
 */

const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SKILL_RE = /^install-([a-z][a-z0-9-]{0,63})-docs$/;

/**
 * Leitet den Pfad zum Installer-Skript aus dem `skill`-Eintrag des Catalogs
 * ab — NICHT aus der Doc-Set-ID. Hintergrund: `claris-help` (ID) ↔
 * `install-claris-docs` (Skill-Folder) sind historisch entkoppelt.
 *
 * Erwartete Skill-Namen folgen dem Muster `install-<slug>-docs`. Das Skript
 * darin heißt nach derselben Konvention `install_<slug>_docs.sh`.
 */
function scriptPathFor(skill) {
  const m = String(skill || '').match(SKILL_RE);
  if (!m) return null;
  const slug = m[1];
  const root = settingsStore.resolveRepoRoot();
  return path.join(
    root,
    '.claude',
    'skills',
    skill,
    'scripts',
    `install_${slug}_docs.sh`
  );
}

function assertAllowedId(id) {
  if (!ID_RE.test(id)) {
    const err = new Error(`Invalid doc-set id: ${id}`);
    err.code = 'INVALID_ID';
    throw err;
  }
  const entry = docsManifest.getCatalogEntry(id);
  if (!entry) {
    const err = new Error(`Unknown doc-set id: ${id}`);
    err.code = 'UNKNOWN_ID';
    throw err;
  }
  if (!entry.skill) {
    const err = new Error(`Doc-set "${id}" has no installer skill (manually maintained).`);
    err.code = 'NO_SKILL';
    throw err;
  }
  if (!SKILL_RE.test(entry.skill)) {
    const err = new Error(`Doc-set "${id}" has an invalid skill name: ${entry.skill}`);
    err.code = 'INVALID_SKILL';
    throw err;
  }
  return entry;
}

function ensureScriptExists(id) {
  const entry = assertAllowedId(id);
  const p = scriptPathFor(entry.skill);
  if (!p || !fs.existsSync(p)) {
    const err = new Error(`Installer script not found: ${p}`);
    err.code = 'SCRIPT_NOT_FOUND';
    throw err;
  }
  return p;
}

/**
 * Spawnt das Installer-Skript und ruft `onEvent(evt)` für jede NDJSON-Zeile
 * auf. Resolvet mit dem Exit-Code, sobald der Prozess beendet ist.
 *
 * mode      "install" oder "check" — wird als --install/--check übergeben.
 * extraArgs Zusätzliche Argumente (z.B. ["--lang=de"]), strikt vom Backend
 *           kontrolliert — NICHT aus User-Input ohne weitere Validierung.
 * onEvent   Callback (evt) => void. Erhält geparste NDJSON-Objekte; nicht
 *           parsebare Zeilen werden als { event: 'log', ... } weitergereicht.
 * signal    Optionales AbortSignal, um den Prozess vorzeitig zu beenden.
 */
function runInstaller({ id, mode = 'install', extraArgs = [], onEvent, signal }) {
  const scriptPath = ensureScriptExists(id);

  return new Promise((resolve, reject) => {
    const args = [scriptPath, `--${mode}`, '--quiet', ...extraArgs];
    const child = spawn('bash', args, {
      cwd: settingsStore.resolveRepoRoot(),
      env: { ...process.env, FMLAB_INSTALL_QUIET: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const buffers = { stdout: '', stderr: '' };

    const dispatchLine = (channel, raw) => {
      const line = raw.trim();
      if (!line) return;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        evt = {
          event: 'log',
          level: channel === 'stderr' ? 'warn' : 'info',
          msg: line,
        };
      }
      try { onEvent(evt); } catch (err) { /* never break the pipe */ console.warn('[docs-install] onEvent threw:', err.message); }
    };

    const onChunk = (channel) => (chunk) => {
      buffers[channel] += chunk.toString();
      let idx;
      while ((idx = buffers[channel].indexOf('\n')) >= 0) {
        const line = buffers[channel].slice(0, idx);
        buffers[channel] = buffers[channel].slice(idx + 1);
        dispatchLine(channel, line);
      }
    };

    child.stdout.on('data', onChunk('stdout'));
    child.stderr.on('data', onChunk('stderr'));

    if (signal) {
      signal.addEventListener('abort', () => {
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }, { once: true });
    }

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (buffers.stdout) dispatchLine('stdout', buffers.stdout);
      if (buffers.stderr) dispatchLine('stderr', buffers.stderr);
      resolve(code ?? 0);
    });
  });
}

/**
 * Convenience wrapper für den `--check`-Modus: sammelt alle Events in einem
 * Array und gibt das letzte `check`-Event zurück (oder null, wenn das Skript
 * keines emittiert hat).
 */
async function checkDocset(id) {
  const events = [];
  const exitCode = await runInstaller({
    id,
    mode: 'check',
    onEvent: (evt) => events.push(evt),
  });
  const checkEvt = [...events].reverse().find(e => e.event === 'check') || null;
  return { exit_code: exitCode, check: checkEvt, events };
}

module.exports = {
  scriptPathFor,
  assertAllowedId,
  ensureScriptExists,
  runInstaller,
  checkDocset,
};
