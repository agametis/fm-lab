import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { InlineControlProps } from './inlineControls';

/**
 * DocsetInstallControl
 *
 * Inline-Control für eine Zeile in der "Verfügbar"-Liste des docs_overview-
 * Dashboards. Rendert einen "Installieren"-Button und streamt den Fortschritt
 * über POST /api/docs/install/:id (Server-Sent Events).
 *
 * Multi-Sprach-Sets (claris-help): Zusätzlicher Caret (▾) öffnet ein Popover
 * mit Sprach-Checkboxen + zwei Buttons ("Auswahl installieren" / "Alle"). Die
 * Auswahl wird als `--langs=de,fr,it` (sanitized) an den Installer übergeben;
 * "Alle" als `--all`. Bereits installierte Sprachen und die Reference-Sprache
 * EN sind im Popover ausgegraut und vorausgewählt.
 *
 * EventSource ist GET-only, daher fetch + ReadableStream-Parsing für SSE.
 */

const REFERENCE_LANG = 'en';

function readLanguages(row: Record<string, unknown>): string[] {
  const v = row.languages;
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

function readInstalledLanguages(row: Record<string, unknown>): string[] {
  const v = row.installed_languages;
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

export function DocsetInstallControl({ row, setExtra }: InlineControlProps) {
  const { t } = useTranslation('dashboard');
  const id = String(row.id || '');
  const skill = row.skill ? String(row.skill) : '';
  const name = String(row.name || id);

  const allLanguages = useMemo(() => readLanguages(row), [row]);
  const installedLanguages = useMemo(() => readInstalledLanguages(row), [row]);
  const isMultiLang = allLanguages.length > 1;

  const installedSet = useMemo(() => new Set(installedLanguages), [installedLanguages]);
  // Languages "Install all" would still add — used to disable the main button
  // and decide whether the caret/popover is shown at all.
  const missingLangs = useMemo(
    () => allLanguages.filter(l => !installedSet.has(l)),
    [allLanguages, installedSet]
  );

  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const [selectedLangs, setSelectedLangs] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Recompute popover position relative to the viewport. Anchored to the
  // split-button, right-aligned with the wrap. Tries below the button first;
  // flips above if it would overflow, and as a last resort clamps into the
  // viewport. Re-runs on scroll/resize.
  //
  // Two-pass: the first call (right after open) uses an estimated popover
  // height because popoverRef is not yet mounted; a requestAnimationFrame
  // re-runs the calculation with the real measured height. Guarded with a
  // prev-equality check so we don't loop.
  const updatePopoverPos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popHeight = popoverRef.current?.getBoundingClientRect().height ?? 300;
    const margin = 8;

    let top = rect.bottom + 4;
    if (top + popHeight + margin > window.innerHeight) {
      const above = rect.top - popHeight - 4;
      if (above >= margin) {
        top = above;
      } else {
        top = Math.max(margin, window.innerHeight - popHeight - margin);
      }
    }
    const right = Math.max(0, window.innerWidth - rect.right);

    setPopoverPos(prev => {
      if (prev && Math.abs(prev.top - top) < 1 && Math.abs(prev.right - right) < 1) {
        return prev;
      }
      return { top, right };
    });
  }, []);

  useLayoutEffect(() => {
    if (!popoverOpen) return;
    updatePopoverPos();
    // Pass 2: re-measure once the popover DOM is in place, so flip/clamp
    // decisions use the actual rendered height, not the 300px estimate.
    const raf = requestAnimationFrame(() => updatePopoverPos());
    return () => cancelAnimationFrame(raf);
  }, [popoverOpen, updatePopoverPos]);

  // Close popover on outside click or Escape; reposition on scroll/resize.
  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    const onReposition = () => updatePopoverPos();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReposition, true); // capture: catches nested scroll
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [popoverOpen, updatePopoverPos]);

  // Push progress block into the row's extra slot during a run.
  useEffect(() => {
    if (!setExtra) return;
    if (status === 'running') {
      const label = phase ? `${phase} · ${progress}%` : `${progress}%`;
      setExtra(
        <div className="docs-install-progress" role="progressbar" aria-label={label}
             aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="docs-install-progress__bar" style={{ width: `${progress}%` }} />
        </div>
      );
    } else {
      setExtra(null);
    }
  }, [status, progress, phase, setExtra]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const startInstall = useCallback(async (extraArgs: string[] = []) => {
    if (status === 'running' || !id) return;
    setPopoverOpen(false);
    setStatus('running');
    setProgress(0);
    setPhase('');

    const ac = new AbortController();
    abortRef.current = ac;

    const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3003').replace(/\/+$/, '');
    const url = `${apiBase}/api/docs/install/${encodeURIComponent(id)}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ extraArgs }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const msg = `HTTP ${res.status} ${res.statusText}`.trim();
        emitError(id, name, msg);
        setStatus('idle');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let hadError = false;
      let lastErrorMsg = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx;
        while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trimStart();
            if (!payload) continue;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(payload); } catch { continue; }
            switch (evt.event) {
              case 'progress': {
                const pct = typeof evt.pct === 'number' ? evt.pct : Number(evt.pct ?? 0);
                if (Number.isFinite(pct)) setProgress(Math.max(0, Math.min(100, pct)));
                if (typeof evt.phase === 'string') setPhase(evt.phase);
                break;
              }
              case 'log': {
                if (evt.level === 'error') {
                  hadError = true;
                  lastErrorMsg = String(evt.msg || lastErrorMsg);
                }
                break;
              }
              case 'error': {
                hadError = true;
                lastErrorMsg = String(evt.message || evt.msg || lastErrorMsg);
                break;
              }
              case 'done': {
                if (evt.ok === false) {
                  hadError = true;
                  if (!lastErrorMsg) lastErrorMsg = String(evt.msg || `Exit ${evt.exit_code}`);
                }
                break;
              }
            }
          }
        }
      }

      if (hadError) {
        emitError(id, name, lastErrorMsg || t('install.unknownError', { defaultValue: 'Unbekannter Fehler.' }) as string);
        setStatus('idle');
        setProgress(0);
        setPhase('');
        return;
      }

      setProgress(100);
      setStatus('done');
      setSelectedLangs(new Set());
      window.dispatchEvent(new CustomEvent('fmlab:reload-dashboard'));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      emitError(id, name, (err as Error).message || String(err));
      setStatus('idle');
      setProgress(0);
      setPhase('');
    } finally {
      abortRef.current = null;
    }
  }, [id, name, status, t]);

  // Sets without an installer skill (e.g. fm-lab) have nothing to do here.
  if (!skill) return null;

  const isRunning = status === 'running';
  const isDone = status === 'done';

  // Main button click:
  //   - Single-lang set: install with no extraArgs (default behaviour)
  //   - Multi-lang set:  install reference language (= no extraArgs → script
  //                      installs EN only). Disabled when EN is already there.
  const mainDisabled = isRunning || isDone
    || (isMultiLang && installedSet.has(REFERENCE_LANG));

  const mainLabel = isRunning
    ? (t('install.running', { defaultValue: 'Installiert…' }) as string)
    : isDone
    ? (t('install.done', { defaultValue: 'Installiert' }) as string)
    : (t('install.action', { defaultValue: 'Installieren' }) as string);

  const toggleLang = (lang: string) => {
    setSelectedLangs(prev => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang); else next.add(lang);
      return next;
    });
  };

  const installSelected = () => {
    if (selectedLangs.size === 0) return;
    const csv = Array.from(selectedLangs).join(',');
    startInstall([`--langs=${csv}`]);
  };

  const installAll = () => startInstall(['--all']);

  // Popover is only shown for multi-lang sets, and only if there's anything
  // still to install.
  const showCaret = isMultiLang && missingLangs.length > 0 && !isRunning && !isDone;

  return (
    <div className="docs-install-wrap" ref={wrapRef}>
      <div className={`docs-install-split${showCaret ? ' docs-install-split--has-caret' : ''}`}>
        <button
          type="button"
          className={`docs-install-btn docs-install-btn--${status}`}
          onClick={() => startInstall([])}
          disabled={mainDisabled}
        >
          {mainLabel}
        </button>
        {showCaret && (
          <button
            type="button"
            className="docs-install-caret"
            onClick={() => setPopoverOpen(o => !o)}
            aria-haspopup="true"
            aria-expanded={popoverOpen}
            aria-label={t('install.choose', { defaultValue: 'Sprachen wählen' }) as string}
            title={t('install.choose', { defaultValue: 'Sprachen wählen' }) as string}
          >
            ▾
          </button>
        )}
      </div>
      {popoverOpen && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="docs-install-popover"
          role="dialog"
          aria-label={t('install.choose', { defaultValue: 'Sprachen wählen' }) as string}
          style={{ position: 'fixed', top: popoverPos.top, right: popoverPos.right }}
        >
          <div className="docs-install-popover__title">
            {t('install.pickLanguages', { defaultValue: 'Sprachen wählen' })}
          </div>
          <ul className="docs-install-popover__list">
            {allLanguages.map(lang => {
              const isRef = lang === REFERENCE_LANG;
              const isInstalled = installedSet.has(lang);
              const disabled = isRef || isInstalled;
              const checked = disabled ? true : selectedLangs.has(lang);
              const noteKey = isInstalled
                ? 'install.langInstalled'
                : isRef ? 'install.langDefault' : null;
              const note = noteKey ? (t(noteKey, {
                defaultValue: isInstalled ? 'bereits installiert' : 'Standard',
              }) as string) : '';
              return (
                <li key={lang} className={`docs-install-popover__row${disabled ? ' is-disabled' : ''}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleLang(lang)}
                    />
                    <span className="docs-install-popover__code">{lang.toUpperCase()}</span>
                    {note && <span className="docs-install-popover__note">{note}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="docs-install-popover__actions">
            <button
              type="button"
              className="docs-install-btn"
              onClick={installSelected}
              disabled={selectedLangs.size === 0}
            >
              {t('install.actionSelected', { defaultValue: 'Auswahl installieren' })}
            </button>
            <button
              type="button"
              className="docs-install-btn"
              onClick={installAll}
            >
              {t('install.actionAll', { defaultValue: 'Alle installieren' })}
            </button>
          </div>
          <div className="docs-install-popover__hint">
            {t('install.skipsInstalled', {
              defaultValue: 'Bereits installierte Sprachen werden übersprungen.',
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * Globaler Error-Channel zwischen dem inline Control und dem Bezel unterhalb
 * der Available-Card. CustomEvent statt React-Context, weil die beiden
 * Komponenten in der dynamisch zusammengesetzten Layout-Baum strukturell
 * voneinander entkoppelt sind.
 */
export interface DocsInstallErrorDetail {
  id: string;
  name: string;
  message: string;
  ts: number;
}

function emitError(id: string, name: string, message: string) {
  const detail: DocsInstallErrorDetail = { id, name, message, ts: Date.now() };
  window.dispatchEvent(new CustomEvent<DocsInstallErrorDetail>('fmlab:docs-install-error', { detail }));
}
