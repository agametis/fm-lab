import { API_BASE } from '../../config/apiBase';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import type { XmlConvertEventDetail, XmlConvertStatusDetail } from './XmlConvertControl';

/**
 * XmlConvertLog — Statuszeile + persistenter Log-Block für das Sub-Dashboard
 * "xml_convert". Lädt initial den letzten Run-Record via GET /api/xml/last-run/log
 * und hängt während einer laufenden Konvertierung neue Events live an, die per
 * `fmlab:xml-convert-event`-Window-Event vom XmlConvertControl gesendet werden.
 */

const PROGRESS_EVENT = 'fmlab:xml-convert-event';
const STATUS_EVENT = 'fmlab:xml-convert-status';

interface LastRun {
  run_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  ok: boolean | null;
  processed: number;
  total: number;
  error_count: number;
  events: Record<string, unknown>[];
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')} min`;
}

interface LogLine {
  ts?: string;
  text: string;
  level?: 'info' | 'warn' | 'error';
}

function eventToLine(evt: Record<string, unknown>): LogLine | null {
  switch (evt.event) {
    case 'start':
      return { text: '── Start ──', level: 'info' };
    case 'progress': {
      const phase = String(evt.phase ?? '');
      const pct = typeof evt.pct === 'number' ? evt.pct : Number(evt.pct ?? 0);
      const msg = evt.msg ? `: ${String(evt.msg)}` : '';
      return { text: `[${phase} ${pct}%]${msg}`, level: 'info' };
    }
    case 'file': {
      // Opt 2 (Log-Entrümpelung): Unveränderte/übersprungene Dateien erzeugen keine
      // Log-Zeile — die ⏭️-Status-Tabelle (file_skip) deckt sie ab. Die Live-Zähler
      // (processed/total) laufen unabhängig in der pushEvent-Logik weiter.
      const status = String(evt.status ?? '');
      if (status === 'unchanged' || status === 'skipped') return null;
      const filename = String(evt.filename ?? '');
      const idx = typeof evt.index === 'number' ? evt.index : Number(evt.index ?? 0);
      const total = typeof evt.total === 'number' ? evt.total : Number(evt.total ?? 0);
      const ok = evt.ok !== false;
      const marker = ok ? '✓' : '✗';
      return {
        text: `[${idx}/${total}] ${marker} ${filename}`,
        level: ok ? 'info' : 'error',
      };
    }
    case 'phase': {
      // Per-Phasen-Marker der 6-Phasen-Pipeline (P1–P6). `begin` als Divider
      // (wie Start/Beendet), `done` mit Dauer + produziertem Ergebnis.
      const id = String(evt.id ?? '');
      const name = String(evt.name ?? '');
      const head = [id, name].filter(Boolean).join(' · ');
      if (evt.state === 'done') {
        const dur = evt.duration ? ` · ${String(evt.duration)}` : '';
        const prod = evt.produced ? ` · ${String(evt.produced)}` : '';
        return { text: `✔ ${head}${dur}${prod}`, level: 'info' };
      }
      return { text: `── ${head} ──`, level: 'info' };
    }
    case 'log': {
      const level = (evt.level === 'warn' || evt.level === 'error') ? evt.level : 'info';
      return { text: String(evt.msg ?? ''), level };
    }
    case 'error':
      return { text: String(evt.message ?? evt.msg ?? 'Error'), level: 'error' };
    case 'reload':
      return {
        text: evt.ok === false
          ? `Reload fehlgeschlagen: ${String(evt.error ?? '')}`
          : 'Reload erfolgreich.',
        level: evt.ok === false ? 'error' : 'info',
      };
    case 'done':
      return {
        text: evt.ok === false
          ? `── Beendet mit Fehler (exit ${evt.exit_code ?? '?'}) ──`
          : '── Beendet ──',
        level: evt.ok === false ? 'error' : 'info',
      };
    default:
      return null;
  }
}

export function XmlConvertLog({}: PrimitiveProps) {
  const { t, i18n } = useTranslation('dashboard');
  const lang = i18n.language;
  const [run, setRun] = useState<LastRun | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [liveCounts, setLiveCounts] = useState<{ processed: number; total: number; errorCount: number }>({
    processed: 0,
    total: 0,
    errorCount: 0,
  });
  const logRef = useRef<HTMLDivElement | null>(null);
  // Block 2 als Disclosure: erzwungen offen während eines Laufs, sonst
  // nach User-Toggle. Nach Lauf-Ende/Wiedereintritt default zugeklappt.
  const [userToggled, setUserToggled] = useState(false);

  // Initial-Load: persistierter Run-Record.
  useEffect(() => {
    let cancelled = false;
    const apiBase = (API_BASE).replace(/\/+$/, '');
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/xml/last-run/log`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const data = json?.data as LastRun | undefined;
        if (!data || !data.run_id) return;
        setRun(data);
        const initialLines: LogLine[] = [];
        for (const evt of data.events || []) {
          const line = eventToLine(evt);
          if (line) initialLines.push(line);
        }
        setLines(initialLines);
        setLiveCounts({
          processed: data.processed || 0,
          total: data.total || 0,
          errorCount: data.error_count || 0,
        });
      } catch {
        /* keine Daten verfügbar */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live-Append: lauscht auf fmlab:xml-convert-event vom Control.
  useEffect(() => {
    const onEvt = (e: Event) => {
      const detail = (e as CustomEvent<XmlConvertEventDetail>).detail;
      if (!detail || !detail.evt) return;
      const evt = detail.evt;
      const line = eventToLine(evt);
      if (line) setLines(prev => [...prev, line]);

      if (evt.event === 'file_start') {
        // Gesamtzahl steht damit schon vor dem ersten abgeschlossenen File —
        // sonst zeigt die Statuszeile beim ersten File "0 von ?".
        const total = typeof evt.total === 'number' ? evt.total : Number(evt.total ?? 0);
        if (total) setLiveCounts(prev => ({ ...prev, total }));
      }
      if (evt.event === 'file') {
        const idx = typeof evt.index === 'number' ? evt.index : Number(evt.index ?? 0);
        const total = typeof evt.total === 'number' ? evt.total : Number(evt.total ?? 0);
        const okFile = evt.ok !== false;
        setLiveCounts(prev => ({
          processed: okFile ? Math.max(prev.processed, idx) : prev.processed,
          total: total || prev.total,
          errorCount: okFile ? prev.errorCount : prev.errorCount + 1,
        }));
      }
      if (evt.event === 'start') {
        // Bei Neustart Log und Counter resetten — der persistierte Record
        // wird beim done.ok=true gleich überschrieben.
        setLines([{ text: '── Start ──', level: 'info' }]);
        setLiveCounts({ processed: 0, total: 0, errorCount: 0 });
      }
    };
    window.addEventListener(PROGRESS_EVENT, onEvt);
    return () => window.removeEventListener(PROGRESS_EVENT, onEvt);
  }, []);

  // Status-Bus: Control teilt running/done/error mit.
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<XmlConvertStatusDetail>).detail;
      if (!detail) return;
      setStatus(detail.status);
      if (detail.status === 'done' || detail.status === 'error') {
        setRun(prev => ({
          run_id: prev?.run_id || new Date().toISOString(),
          started_at: detail.startedAt || prev?.started_at || null,
          finished_at: detail.finishedAt || new Date().toISOString(),
          duration_ms: detail.durationMs ?? prev?.duration_ms ?? null,
          ok: detail.ok ?? (detail.status === 'done'),
          processed: liveCounts.processed,
          total: liveCounts.total,
          error_count: detail.errorCount ?? liveCounts.errorCount,
          events: [],
        }));
      }
    };
    window.addEventListener(STATUS_EVENT, onStatus);
    return () => window.removeEventListener(STATUS_EVENT, onStatus);
  }, [liveCounts]);

  // Auto-Scroll auf neuestes Log-Ende.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  // Statuszeile: drei Varianten — laufend, erfolgreich, fehlerhaft.
  // Bei abgeschlossenem Run zeigen wir zusätzlich die Dauer ("0:57 min")
  // an, sofern Backend bzw. Frontend `duration_ms` gesetzt haben.
  let statusText = '';
  let statusClass = 'xml-convert-status';
  if (status === 'running') {
    statusText = t('xmlConvert.statusRunning', {
      defaultValue: 'XML-Konvertierung läuft: {{processed}} von {{total}} Dateien verarbeitet',
      processed: liveCounts.processed,
      total: liveCounts.total || '?',
    }) as string;
    statusClass += ' xml-convert-status--running';
  } else if (run && run.finished_at) {
    const dt = new Date(run.finished_at);
    const tsLabel = Number.isNaN(dt.getTime()) ? run.finished_at : dt.toLocaleString(lang);
    const durLabel = formatDuration(run.duration_ms);
    if (run.ok && (run.error_count || 0) === 0) {
      statusText = durLabel
        ? (t('xmlConvert.statusOkWithDuration', {
            defaultValue: 'Datum: {{ts}}, Dauer: {{dur}}, erfolgreich ✅',
            ts: tsLabel,
            dur: durLabel,
          }) as string)
        : (t('xmlConvert.statusOk', {
            defaultValue: 'Datum: {{ts}}, erfolgreich ✅',
            ts: tsLabel,
          }) as string);
      statusClass += ' xml-convert-status--ok';
    } else {
      statusText = durLabel
        ? (t('xmlConvert.statusErrorWithDuration', {
            defaultValue: 'Datum: {{ts}}, Dauer: {{dur}}, {{count}} Fehler 🚫',
            ts: tsLabel,
            dur: durLabel,
            count: run.error_count || (run.ok === false ? 1 : 0),
          }) as string)
        : (t('xmlConvert.statusError', {
            defaultValue: 'Datum: {{ts}}, {{count}} Fehler 🚫',
            ts: tsLabel,
            count: run.error_count || (run.ok === false ? 1 : 0),
          }) as string);
      statusClass += ' xml-convert-status--error';
    }
  } else {
    statusText = t('xmlConvert.statusIdle', {
      defaultValue: 'Noch keine Konvertierung in dieser Sitzung gelaufen.',
    }) as string;
    statusClass += ' xml-convert-status--idle';
  }

  // open = running (erzwungen) || userToggled. Die Summary-Statuszeile bleibt
  // IMMER sichtbar; nur der Log-Body klappt auf/zu.
  const open = status === 'running' || userToggled;

  return (
    <details
      className="xml-convert-log-wrap"
      open={open}
      onToggle={(e) => setUserToggled((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className={`${statusClass} xml-convert-log-summary`}>{statusText}</summary>
      <div ref={logRef} className="xml-convert-log" role="log" aria-live="polite">
        {lines.length === 0 ? (
          <div className="xml-convert-log__empty">
            {t('xmlConvert.logEmpty', {
              defaultValue: 'Noch kein Log vorhanden.',
            })}
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`xml-convert-log__line xml-convert-log__line--${l.level || 'info'}`}>
              {l.text}
            </div>
          ))
        )}
      </div>
    </details>
  );
}
