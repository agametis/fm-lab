import { API_BASE } from '../../config/apiBase';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';

/**
 * XmlConvertControl — Top-Level-Primitive für das Sub-Dashboard "xml_convert"
 * (Default-Modus `run`) und für das Home-Dashboard (Modus `navigate`).
 *
 * Modi (via `node.props.mode`):
 *   - "run" (Default): Klick startet die Konvertierung sofort und streamt den
 *     Fortschritt via SSE. Fortschrittsbalken ersetzt den Button.
 *   - "navigate": Klick navigiert zum xml_convert-Sub-Dashboard und führt
 *     dort *keine* automatische Konvertierung aus. Der eigentliche Trigger
 *     liegt immer im Sub-Dashboard — der Home-Button ist nur ein Einstieg.
 *
 * Während eines Convert-Laufs sendet die Komponente pro empfangenem
 * NDJSON-Event ein `fmlab:xml-convert-event` Window-CustomEvent.
 * XmlConvertLog (Log-Block in derselben View) lauscht darauf und hängt die
 * Zeilen live an. Nach `done.ok=true` wird zusätzlich `fmlab:reload-dashboard`
 * ausgelöst, damit die Datei-Status-Tabelle die neuen ✅-Werte zeigt.
 */

const PROGRESS_EVENT = 'fmlab:xml-convert-event';
const STATUS_EVENT = 'fmlab:xml-convert-status';
/** Bittet den DashboardHost um einen nicht-destruktiven In-place-Refresh der
 *  Datasets (ohne die View zu leeren). Vom „Neu scannen"-Button gefeuert, damit
 *  neu im xml/-Verzeichnis abgelegte Dateien ohne Convert-Lauf sichtbar werden.
 */
const REFRESH_EVENT = 'fmlab:refresh-datasets';

/** Dauer der Dissolve-Ausblendung am Lauf-Ende (muss zur CSS-Animation passen). */
const DISSOLVE_MS = 600;
/** Kurzes „Aktualisiert …"-Feedback nach einem Klick auf „Neu scannen". */
const RESCAN_FEEDBACK_MS = 600;

/**
 * Die SQL-Pipeline als beschriftete Balken-Segmente. `start`/`end` sind die
 * globalen Fortschrittsgrenzen und spiegeln das Phasen-Budget des Backends
 * (`set_phase_budget`): chunk:0-25 import:25-70 resolve:70-78 details:78-84
 * catalog:84-90 homes:90-94 validate:94-97 cluster:97-100. Opt 1 (v2): Das frühere
 * `extract`-Segment (P1) ist in zwei sichtbare Pässe aufgeteilt — `chunk`
 * (Phase S: XML in Chunks splitten, 🔥/🟢) und `import` (Phase D/C: Chunks →
 * DuckDB → Master, ✴️/✅). Das Import-Segment wird aktiv, sobald der erste
 * Phase-D-Worker ein `phase=import`-Event sendet. Sync/Reload faltet sich ans
 * Ende von `validate`. (Der CLI-only Nicht-Turbo-Pfad sendet weiter `phase=extract`,
 * für das es hier kein Segment gibt — die Fill-Berechnung leitet sich aus dem
 * globalen pct ab, sodass chunk+import trotzdem korrekt füllen.)
 *
 * `indeterminate`: Die SQL-Einzelschritt-Phasen (resolve/details/catalog/homes) senden
 * nur EIN `phase_progress <phase> 0`-Event (pct = Segmentstart) und danach bis zur
 * nächsten Phase nichts mehr — die SQL läuft als ein blockierender Aufruf. Der globale
 * pct klebt dadurch am Segmentstart → `fill` = 0 über die ganze (bei P2-Resolve ~20 s
 * lange) Laufzeit, und der Orange-Puls, der nur auf dem `__fill`-Element liegt, wäre
 * unsichtbar (= Wartezeit ohne Feedback). Solche Segmente füllen den Puls deshalb im
 * aktiven Zustand über die volle Breite (indeterminates „läuft gerade"). chunk/import
 * (laufende Sub-Events) und validate (0→100, P6-Checks) bleiben determinierte Füllungen.
 * `cluster` (P7 Auto-Clustering + Sync) ist indeterminate — cluster.sh-Laufzeit ist
 * unvorhersehbar; bei inkrementellem Import wird P7 übersprungen, der Sync füllt das
 * Segment trotzdem auf 100 (Backend faltet den Sync in `cluster`).
 */
const SEGMENTS: ReadonlyArray<{ id: string; labelKey: string; def: string; start: number; end: number; indeterminate?: boolean }> = [
  { id: 'chunk',    labelKey: 'xmlConvert.phaseChunk',    def: 'Aufteilen',   start: 0,  end: 25 },
  { id: 'import',   labelKey: 'xmlConvert.phaseImport',   def: 'Importieren', start: 25, end: 70 },
  { id: 'resolve',  labelKey: 'xmlConvert.phaseResolve',  def: 'Auflösen',    start: 70, end: 78, indeterminate: true },
  { id: 'details',  labelKey: 'xmlConvert.phaseDetails',  def: 'Details',     start: 78, end: 84, indeterminate: true },
  { id: 'catalog',  labelKey: 'xmlConvert.phaseCatalog',  def: 'Katalog',     start: 84, end: 90, indeterminate: true },
  { id: 'homes',    labelKey: 'xmlConvert.phaseHomes',    def: 'Verknüpfen',  start: 90, end: 94, indeterminate: true },
  { id: 'validate', labelKey: 'xmlConvert.phaseValidate', def: 'Prüfen',      start: 94, end: 97 },
  { id: 'cluster',  labelKey: 'xmlConvert.phaseCluster',  def: 'Communities', start: 97, end: 100, indeterminate: true },
];

export interface XmlConvertEventDetail {
  evt: Record<string, unknown>;
}

export interface XmlConvertStatusDetail {
  status: 'idle' | 'running' | 'done' | 'error';
  ok?: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorCount?: number;
}

function dispatchEvent(evt: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent<XmlConvertEventDetail>(PROGRESS_EVENT, { detail: { evt } }));
}

function dispatchStatus(detail: XmlConvertStatusDetail) {
  window.dispatchEvent(new CustomEvent<XmlConvertStatusDetail>(STATUS_EVENT, { detail }));
}

export function XmlConvertControl({ node, datasets }: PrimitiveProps) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Auto-Start-Intent aus dem Empty-State (?autostart=1) — genau einmal beim Mount
  // ausgewertet (Ref, damit ein Re-Render durch das URL-Säubern nicht erneut feuert).
  const autostartRef = useRef(searchParams.get('autostart') === '1');
  const mode = (node.props?.mode as string) === 'navigate' ? 'navigate' : 'run';

  // Dataset für die Disable-Logik: bevorzugt `directory_status` (im
  // xml_convert-Bundle), Fallback `xml_directory_listing` (z. B. im
  // Home-Dashboard, wo nur die einfache Liste geladen ist). Wenn weder noch
  // existiert, lassen wir den Button aktiv — das Backend liefert dann ggf.
  // einen sauberen "Verzeichnis leer"-Fehler.
  const directoryRows = (datasets?.directory_status?.data
    ?? datasets?.xml_directory_listing?.data
    ?? null) as Array<Record<string, unknown>> | null;
  const directoryEmpty = directoryRows != null && directoryRows.length === 0;

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  // "Nur geänderte Dateien" (Manifest-Skip auf Datei-Ebene) ist Default; nur
  // geänderte XML werden neu geparst. Toggle aus → voller (Turbo-)Build aller Dateien.
  const [changedOnly, setChangedOnly] = useState(true);
  // Dissolve-Ausblendung: nach Lauf-Ende bleibt der Balken kurz (~600 ms) im
  // finalen Zustand sichtbar und blendet animiert aus, bevor wieder der Button
  // erscheint.
  const [dissolving, setDissolving] = useState(false);
  // Kurzes Klick-Feedback für „Neu scannen" (der eigentliche Refresh läuft im
  // DashboardHost und tauscht die Tabelle in-place aus).
  const [rescanning, setRescanning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const dissolveTimer = useRef<number | null>(null);
  const rescanTimer = useRef<number | null>(null);

  // Unmount-Cleanup: abortRef hält jetzt NUR den Stream-fetch (Feature E). Sein
  // Abbruch löst den Client vom SSE-Stream — der Lauf läuft SERVERSEITIG WEITER
  // (kein child.kill mehr). Damit killt Wegnavigieren den Import nicht länger.
  useEffect(() => () => {
    abortRef.current?.abort();
    if (dissolveTimer.current != null) window.clearTimeout(dissolveTimer.current);
    if (rescanTimer.current != null) window.clearTimeout(rescanTimer.current);
  }, []);

  const handleRescan = useCallback(() => {
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
    setRescanning(true);
    if (rescanTimer.current != null) window.clearTimeout(rescanTimer.current);
    rescanTimer.current = window.setTimeout(() => {
      setRescanning(false);
      rescanTimer.current = null;
    }, RESCAN_FEEDBACK_MS);
  }, []);

  const triggerDissolve = useCallback(() => {
    setDissolving(true);
    if (dissolveTimer.current != null) window.clearTimeout(dissolveTimer.current);
    dissolveTimer.current = window.setTimeout(() => {
      setDissolving(false);
      dissolveTimer.current = null;
    }, DISSOLVE_MS);
  }, []);

  /**
   * Konsumiert den SSE-Stream `GET /api/xml/convert/stream`.
   * EIN Render-Pfad: sowohl der startende Tab (nach POST 202) als auch jeder
   * Wiedereintritt rendern AUSSCHLIESSLICH aus diesem Stream — der Ring-Replay
   * holt einen Spät-Eintritt auf den aktuellen Stand (Phase/Progress/Log). Der
   * Stream hängt am LAUF, nicht an der Anfrage → der „Default-State"-Bug ist
   * strukturell unmöglich. `startedAt` = Lauf-Start (POST jetzt, oder active_run).
   */
  const subscribeToStream = useCallback(async (startedAt: string) => {
    const ac = new AbortController();
    abortRef.current = ac;
    const apiBase = (API_BASE).replace(/\/+$/, '');
    try {
      const res = await fetch(`${apiBase}/api/xml/convert/stream`, {
        headers: { Accept: 'text/event-stream' },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setStatus('idle');
        setProgress(0);
        setPhase('');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let hadError = false;
      let finishedAt: string | undefined;
      let errorCount = 0;
      let doneOk: boolean | null = null;
      let idle = false;

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
            dispatchEvent(evt);

            switch (evt.event) {
              case 'progress': {
                const pct = typeof evt.pct === 'number' ? evt.pct : Number(evt.pct ?? 0);
                if (Number.isFinite(pct)) setProgress(Math.max(0, Math.min(100, pct)));
                if (typeof evt.phase === 'string') setPhase(evt.phase as string);
                break;
              }
              case 'log': {
                if (evt.level === 'error') hadError = true;
                break;
              }
              case 'file': {
                if (evt.ok === false) errorCount += 1;
                break;
              }
              case 'idle': {
                // Stream ohne aktiven Lauf (Race) → nichts läuft.
                idle = true;
                break;
              }
              case 'aborted': {
                idle = true;
                break;
              }
              case 'done': {
                doneOk = evt.ok !== false;
                if (evt.ok === false) hadError = true;
                finishedAt = new Date().toISOString();
                break;
              }
            }
          }
        }
      }

      if (doneOk !== null) {
        setProgress(100);
        const durationMs = finishedAt
          ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
          : undefined;
        if (hadError || doneOk === false) {
          setStatus('error');
          dispatchStatus({ status: 'error', ok: false, startedAt, finishedAt, durationMs, errorCount });
        } else {
          setStatus('done');
          dispatchStatus({ status: 'done', ok: true, startedAt, finishedAt, durationMs, errorCount: 0 });
          // Datei-Tabelle UND Community-Gauges neu laden.
          window.dispatchEvent(new CustomEvent('fmlab:reload-dashboard'));
          window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
        }
        triggerDissolve();
      } else if (idle) {
        // Kein Lauf (mehr) → zurück auf den Button-Zustand, kein Dissolve.
        setStatus('idle');
        setProgress(0);
        setPhase('');
        dispatchStatus({ status: 'idle' });
      }
    } catch (err) {
      // AbortError = Unmount: der Lauf läuft SERVERSEITIG WEITER (Feature E), wir
      // lösen uns nur vom Stream. Kein child.kill, kein Fehlerzustand.
      if ((err as Error).name === 'AbortError') return;
      setStatus('error');
      setProgress(0);
      setPhase('');
      dispatchEvent({ event: 'log', level: 'error', msg: (err as Error).message || String(err) });
      dispatchStatus({ status: 'error' });
    } finally {
      abortRef.current = null;
    }
  }, [triggerDissolve]);

  /**
   * Startet einen Lauf: POST /api/xml/convert (202, streamt NICHT mehr selbst) →
   * danach `subscribeToStream`. 409 (bereits aktiv) → freundlich auf den Stream
   * abonnieren (Catch-up) statt einen Fehler zu zeigen.
   */
  const startConvert = useCallback(async () => {
    if (status === 'running') return;
    const startedAt = new Date().toISOString();
    if (dissolveTimer.current != null) {
      window.clearTimeout(dissolveTimer.current);
      dissolveTimer.current = null;
    }
    setDissolving(false);
    setStatus('running');
    setProgress(0);
    setPhase('');
    dispatchStatus({ status: 'running', startedAt });

    const apiBase = (API_BASE).replace(/\/+$/, '');
    try {
      const res = await fetch(`${apiBase}/api/xml/convert`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedOnly }),
      });
      if (res.status === 409) {
        // Es läuft bereits (anderer Tab/CLI) → einfach auf den Stream aufspringen.
        await subscribeToStream(startedAt);
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const msg = `HTTP ${res.status} ${res.statusText}: ${text}`.trim();
        setStatus('error');
        setProgress(0);
        setPhase('');
        dispatchEvent({ event: 'log', level: 'error', msg });
        dispatchStatus({ status: 'error' });
        return;
      }
      await subscribeToStream(startedAt);
    } catch (err) {
      setStatus('error');
      setProgress(0);
      setPhase('');
      dispatchEvent({ event: 'log', level: 'error', msg: (err as Error).message || String(err) });
      dispatchStatus({ status: 'error' });
    }
  }, [status, changedOnly, subscribeToStream]);

  // Mount-Detektion: fragt den Server, ob bereits ein Lauf
  // aktiv ist. Falls ja → OHNE POST auf den Stream abonnieren (Wiedereintritt
  // zeigt sofort „läuft" + Live-Log statt des Default-States). Nur im run-Modus.
  useEffect(() => {
    if (mode !== 'run') return;
    let cancelled = false;
    (async () => {
      try {
        const apiBase = (API_BASE).replace(/\/+$/, '');
        const res = await fetch(`${apiBase}/api/xml/status`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const data = json?.data ?? json;
        if (cancelled) return;

        // Auto-Start-Parameter genau einmal konsumieren und aus der URL entfernen,
        // damit Reload/Back keinen erneuten Lauf auslöst.
        const wantAutostart = autostartRef.current;
        if (wantAutostart) {
          autostartRef.current = false;
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('autostart');
            return next;
          }, { replace: true });
        }

        if (data?.running) {
          const startedAt = data.active_run?.started_at ?? new Date().toISOString();
          setStatus('running');
          setProgress(0);
          setPhase(data.active_run?.phase ?? '');
          dispatchStatus({ status: 'running', startedAt });
          await subscribeToStream(startedAt);
          return;
        }

        // Nichts läuft → Auto-Start aus dem Empty-State feuern (nur wenn Dateien da sind).
        if (wantAutostart && !directoryEmpty) {
          startConvert();
        }
      } catch {
        /* status check best-effort */
      }
    })();
    return () => { cancelled = true; };
    // Nur beim Mount auswerten — subscribeToStream/startConvert sind stabil (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleClick = useCallback(() => {
    if (mode === 'navigate') {
      navigate('/xml-import');
      return;
    }
    startConvert();
  }, [mode, navigate, startConvert]);

  const isRunning = status === 'running';
  const disabled = isRunning || directoryEmpty;
  const label = isRunning
    ? (t('xmlConvert.running', { defaultValue: 'XML wird konvertiert …' }) as string)
    : (t('xmlConvert.start', { defaultValue: 'XML konvertieren' }) as string);

  const showBar = isRunning || dissolving;

  return (
    <div className="xml-convert-control">
      {showBar ? (
        <div
          className={`xml-convert-progress xml-convert-progress--segmented${dissolving ? ' xml-convert-progress--dissolving' : ''}`}
          role="progressbar"
          aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}
          aria-label={phase ? `${phase} · ${progress}%` : `${progress}%`}
        >
          {SEGMENTS.map(seg => {
            const span = seg.end - seg.start;
            const fill = span > 0 ? Math.max(0, Math.min(1, (progress - seg.start) / span)) : 0;
            // Aktives Segment über die Phasen-ID bestimmen (robuster als
            // pct-Schwellen). Während des Dissolve ist nichts mehr aktiv.
            const isActiveSeg = !dissolving && phase === seg.id;
            const isDone = fill >= 1 && !isActiveSeg;
            // Indeterminate SQL-Phasen (resolve/details/catalog/homes) senden nur EIN
            // phase_progress-Event am Segmentstart und danach bis zur nächsten Phase
            // nichts mehr → fill bleibt 0 über die ganze (bei P2-Resolve ~20 s) Laufzeit.
            // Damit der Nutzer Feedback bekommt, füllt der Orange-Puls in diesem Fall
            // die volle Segmentbreite (siehe Kommentar an SEGMENTS). isDone nutzt weiter
            // den echten fill, sodass das Segment beim Phasenwechsel sauber auf "fertig"
            // (Accent, volle Breite) umschaltet.
            const visualFill = isActiveSeg && seg.indeterminate ? 1 : fill;
            const segClass = [
              'xml-convert-segment',
              isActiveSeg ? 'xml-convert-segment--active' : '',
              isDone ? 'xml-convert-segment--done' : '',
            ].filter(Boolean).join(' ');
            return (
              <div key={seg.id} className={segClass}>
                <div className="xml-convert-segment__fill" style={{ width: `${visualFill * 100}%` }} />
                <span className="xml-convert-segment__label">
                  {t(seg.labelKey, { defaultValue: seg.def }) as string}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {mode === 'run' && (
            <label className="xml-convert-changed-only">
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(e) => setChangedOnly(e.target.checked)}
                disabled={disabled}
              />
              <span>
                {t('xmlConvert.changedOnly', { defaultValue: 'Nur geänderte Dateien' }) as string}
              </span>
            </label>
          )}
          {mode === 'run' && (
            <button
              type="button"
              className="xml-convert-btn xml-convert-btn--outline"
              onClick={handleRescan}
              disabled={rescanning}
              title={t('xmlConvert.rescanHint', { defaultValue: 'XML-Verzeichnis neu einlesen, ohne zu konvertieren' }) as string}
            >
              {rescanning
                ? (t('xmlConvert.rescanning', { defaultValue: 'Aktualisiert …' }) as string)
                : (t('xmlConvert.rescan', { defaultValue: 'Neu scannen' }) as string)}
            </button>
          )}
          <button
            type="button"
            className={`xml-convert-btn${mode === 'navigate' ? ' xml-convert-btn--outline' : ''}`}
            onClick={handleClick}
            disabled={disabled}
          >
            {label}
          </button>
        </>
      )}
    </div>
  );
}
