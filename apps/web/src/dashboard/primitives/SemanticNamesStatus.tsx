import { API_BASE } from '../../config/apiBase';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
// Die `.sn-*`-Styles leben in dashboard.css. Auf `/xml-import` lädt DashboardHost
// sie; auf `/cluster` (React-Page ohne DashboardHost) müssen sie mit der Komponente
// reisen — sonst wäre der Heil-Block bei einem /cluster-Deeplink unstyled.
import '../dashboard.css';

/**
 * SemanticNamesStatus — Block 3 der „XML Import"-View. Liest das
 * Dataset `xml_semantic_names` (zwei Drift-Kennzahlen) und zeigt GENAU ZWEI
 * Zeilen mit je EINER Ampel und EINER Aktion — bewusst asymmetrisch:
 *
 *   ① Struktur   NN% geclustert   [ Communities neu ]   ← Button (Frontend heilt)
 *   ② Benennung  NN% benannt      ⧉ /fm-graph-cluster   ← Befehl (nur User, CLI)
 *
 * ① ruft `POST /api/graph/recluster` (SSE, billige Re-Partition). ② ist NUR ein
 * kopierbarer Befehl — das Frontend kann den LLM-Skill nicht starten. Die rote
 * Ampel zeigt damit eindeutig auf ihr Heilmittel.
 */

const STATUS_EVENT = 'fmlab:xml-convert-status';
const REFRESH_EVENT = 'fmlab:refresh-datasets';
const SKILL_COMMAND = '/fm-graph-cluster';
const COPY_FEEDBACK_MS = 1200;
/** Max. im Rebuild-Log gehaltene Zeilen (Tail, wie der Block-2-Ring). */
const REBUILD_LOG_CAP = 300;

type DriftState = 'none' | 'ok' | 'warn' | 'critical';

interface MetricPayload {
  state: DriftState;
  coverage_pct: number | null;
  unpartitioned?: number;
  unnamed_nodes?: number;
  thresholds?: { warn: number; crit: number };
}

interface SemanticNamesPayload {
  available: boolean;
  universe_nodes?: number;
  structure?: MetricPayload;
  naming?: MetricPayload;
  named_communities?: number;
  total_communities?: number;
  sources?: { skill: number; user: number; restored: number };
  engine?: string | null;
}

/** Ampel-Klasse einer Zeile aus ihrem Drift-Zustand. */
function rowClass(state: DriftState | undefined): string {
  if (state === 'warn') return 'sn-row sn-row--warn';
  if (state === 'critical') return 'sn-row sn-row--critical';
  return 'sn-row';
}

/**
 * Props: auf `/xml-import` läuft die Komponente als Dashboard-Primitive
 * (`datasets.xml_semantic_names`, Soft-Refresh über DashboardHost). Auf `/cluster`
 * (eigene React-Page, kein DashboardHost) wird sie direkt gemountet — dann liefert
 * entweder ein `payload`-Prop die Daten oder die Komponente holt sie selbst per
 * `GET /api/xml/status` (Self-Fetch, lauscht auf `fmlab:refresh-datasets`). Der
 * `context`-Prop blendet den „Communities zeigen"-Button aus, sobald man bereits
 * auf `/cluster` ist.
 */
type SemanticNamesStatusProps = Partial<PrimitiveProps> & {
  payload?: SemanticNamesPayload | null;
  context?: 'xmlImport' | 'cluster';
  compact?: boolean;
};

export function SemanticNamesStatus(props: SemanticNamesStatusProps) {
  const { node, datasets } = props;
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const context = props.context ?? 'xmlImport';
  const compact = props.compact ?? node?.props?.compact === true;

  // Payload-Quelle: explizites Prop > gebundenes Dataset (/xml-import) >
  // Self-Fetch (/cluster ohne durchgereichten Payload).
  const datasetBound = !!datasets && 'xml_semantic_names' in datasets;
  const datasetPayload = (datasets?.xml_semantic_names?.data?.[0] ?? null) as unknown as SemanticNamesPayload | null;
  const selfFetch = props.payload === undefined && !datasetBound;
  const [fetchedPayload, setFetchedPayload] = useState<SemanticNamesPayload | null>(null);

  useEffect(() => {
    if (!selfFetch) return;
    let cancelled = false;
    const apiBase = API_BASE.replace(/\/+$/, '');
    const load = async () => {
      try {
        const r = await fetch(`${apiBase}/api/xml/status`);
        const json = await r.json();
        const data = json?.data ?? json;
        if (!cancelled) setFetchedPayload((data?.semantic_names ?? null) as SemanticNamesPayload | null);
      } catch {
        /* Self-Fetch bleibt still — bei Fehler kein Payload (Empty-State). */
      }
    };
    void load();
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [selfFetch]);

  const payload: SemanticNamesPayload | null =
    props.payload !== undefined ? props.payload : (datasetBound ? datasetPayload : fetchedPayload);
  const available = payload?.available === true;
  const structure = available ? payload?.structure : undefined;
  const naming = available ? payload?.naming : undefined;

  const [rebuildState, setRebuildState] = useState<'idle' | 'running' | 'error'>('idle');
  // Mehrzeiliges Rebuild-Log (analog Block 2): alle cluster.sh-Zeilen, gekappt,
  // in einem scrollbaren Monospace-Block statt einer einzelnen abgeschnittenen Zeile.
  const [rebuildLines, setRebuildLines] = useState<string[]>([]);
  const [importRunning, setImportRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimer = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Auto-Scroll ans Log-Ende (wie XmlConvertLog).
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [rebuildLines]);

  // Import-Running aus dem Status-Bus (XmlConvertControl) → Rebuild sperren
  // (gleicher Master-Lock → der Endpoint würde sonst 409 liefern).
  useEffect(() => {
    const onStatus = (e: Event) => {
      const d = (e as CustomEvent).detail as { status?: string } | undefined;
      if (d?.status) setImportRunning(d.status === 'running');
    };
    window.addEventListener(STATUS_EVENT, onStatus);
    return () => window.removeEventListener(STATUS_EVENT, onStatus);
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
  }, []);

  // Hängt eine Log-Zeile an (gekappt auf die letzten REBUILD_LOG_CAP).
  const appendRebuildLine = useCallback((line: string) => {
    setRebuildLines(prev => {
      const next = prev.length >= REBUILD_LOG_CAP ? [...prev.slice(1), line] : [...prev, line];
      return next;
    });
  }, []);

  const rebuild = useCallback(async () => {
    if (rebuildState === 'running' || importRunning) return;
    setRebuildState('running');
    setRebuildLines([]);
    const ac = new AbortController();
    abortRef.current = ac;
    const apiBase = API_BASE.replace(/\/+$/, '');
    try {
      const res = await fetch(`${apiBase}/api/graph/recluster`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: '{}',
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        setRebuildState('error');
        appendRebuildLine(`HTTP ${res.status}: ${text}`.trim());
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let doneOk: boolean | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const p = line.slice(5).trimStart();
            if (!p) continue;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(p); } catch { continue; }
            if (evt.event === 'log' && typeof evt.msg === 'string') {
              // Volle cluster.sh-Ausgabe zeilenweise (scrollbarer Block, analog Block 2).
              appendRebuildLine(evt.msg as string);
            } else if (evt.event === 'error' && typeof evt.message === 'string') {
              appendRebuildLine(evt.message as string);
            } else if (evt.event === 'done') {
              doneOk = evt.ok !== false;
            }
          }
        }
      }
      if (doneOk === false) {
        setRebuildState('error');
        appendRebuildLine(t('semanticNames.rebuildFailed', { defaultValue: 'Re-Clustering fehlgeschlagen.' }) as string);
      } else {
        setRebuildState('idle');
        // Beide Kennzahlen neu laden (② kann danach STEIGEN — neue Module als
        // unbenannt sichtbar).
        window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setRebuildState('error');
      appendRebuildLine((err as Error).message || String(err));
    } finally {
      abortRef.current = null;
    }
  }, [rebuildState, importRunning, appendRebuildLine, t]);

  const copyCommand = useCallback(() => {
    void navigator.clipboard?.writeText(SKILL_COMMAND).catch(() => { /* clipboard blocked */ });
    setCopied(true);
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, []);

  const rebuilding = rebuildState === 'running';
  const rebuildDisabled = rebuilding || importRunning;

  // ── ① Struktur-Zeile ──
  const structNone = !available || structure?.state === 'none' || structure == null;
  const structValue = structNone
    ? t('semanticNames.dash', { defaultValue: '--' }) as string
    : t('semanticNames.structValue', { defaultValue: '{{pct}}% geclustert', pct: structure?.coverage_pct ?? 0 }) as string;
  const structHint = structNone
    ? t('semanticNames.structNone', { defaultValue: 'noch nicht geclustert' }) as string
    : structure?.state === 'critical'
      ? t('semanticNames.structCritHint', { defaultValue: 'neue Objekte nicht geclustert' }) as string
      : structure?.state === 'warn'
        ? t('semanticNames.structWarnHint', { defaultValue: 'neue Objekte nicht geclustert' }) as string
        : '';

  // ② wird über die AKTUELLE Partition bewertet → vorläufig, solange ① < WARN.
  const structBelowWarn = available && (structure?.state === 'warn' || structure?.state === 'critical');

  // ── ② Benennung-Zeile ──
  const nameNone = !available || naming?.state === 'none' || naming == null;
  const nameValue = nameNone
    ? t('semanticNames.dash', { defaultValue: '--' }) as string
    : t('semanticNames.nameValue', { defaultValue: '{{pct}}% benannt', pct: naming?.coverage_pct ?? 0 }) as string;
  const nameHint = nameNone
    ? t('semanticNames.nameNone', { defaultValue: 'noch nie benannt' }) as string
    : naming?.state === 'critical'
      ? t('semanticNames.nameCritHint', { defaultValue: 'neue Module unbenannt' }) as string
      : naming?.state === 'warn'
        ? t('semanticNames.nameWarnHint', { defaultValue: 'neue Module unbenannt' }) as string
        : '';

  return (
    <div className={`semantic-names-status${compact ? ' semantic-names-status--compact' : ''}`}>
      {/* ① Struktur — Heilung Button */}
      <div className={rowClass(structure?.state)}>
        <span className="sn-row__label">
          {t('semanticNames.structureLabel', { defaultValue: 'Struktur' }) as string}
        </span>
        <span className="sn-row__value">
          {structValue}
          {structHint && <span className="sn-row__hint"> · {structHint}</span>}
        </span>
        <span className="sn-row__action">
          {/* Feature D: nur auf /xml-import — auf /cluster ist man schon dort. */}
          {context === 'xmlImport' && (
            <button
              type="button"
              className="sn-open-cluster-btn"
              onClick={() => navigate('/cluster')}
              title={t('semanticNames.openClusterHint', { defaultValue: 'Zur Cluster-Übersicht' }) as string}
            >
              {t('semanticNames.openCluster', { defaultValue: 'Communities zeigen' }) as string}
            </button>
          )}
          <button
            type="button"
            className="sn-rebuild-btn"
            onClick={rebuild}
            disabled={rebuildDisabled}
            title={t('semanticNames.rebuildHint', { defaultValue: 'Communities neu erkennen (Re-Partition, kein Re-Import)' }) as string}
          >
            {rebuilding
              ? (t('semanticNames.rebuilding', { defaultValue: 'Wird neu geclustert …' }) as string)
              : (t('semanticNames.rebuild', { defaultValue: 'Communities neu' }) as string)}
          </button>
        </span>
      </div>

      {/* ② Benennung — Heilung Skill (nur kopierbarer Befehl) */}
      <div className={rowClass(naming?.state)}>
        <span className="sn-row__label">
          {t('semanticNames.namingLabel', { defaultValue: 'Benennung' }) as string}
        </span>
        <span className="sn-row__value">
          {nameValue}
          {nameHint && <span className="sn-row__hint"> · {nameHint}</span>}
          {!nameNone && structBelowWarn && (
            <span className="sn-row__hint sn-row__hint--provisional">
              {' · '}
              {t('semanticNames.evaluateAfterRebuild', { defaultValue: 'nach Re-Clustering bewerten' }) as string}
            </span>
          )}
        </span>
        <span className="sn-row__action">
          <button
            type="button"
            className="sn-copy-cmd"
            onClick={copyCommand}
            title={t('semanticNames.copyCommand', { defaultValue: 'Befehl kopieren' }) as string}
          >
            <span aria-hidden="true">⧉</span>{' '}
            <code>{SKILL_COMMAND}</code>
            {copied && (
              <span className="sn-copy-cmd__feedback">
                {' '}
                {t('semanticNames.copied', { defaultValue: 'kopiert' }) as string}
              </span>
            )}
          </button>
        </span>
      </div>

      {/* Sequenz-Hinweis: ① zuerst (nur wenn ① warn/critical, nicht compact). */}
      {!compact && structBelowWarn && (
        <div className="sn-sequence-hint">
          {t('semanticNames.sequenceHint', {
            defaultValue: 'Neue Objekte nicht geclustert – erst „Communities neu", danach Benennung neu bewerten.',
          }) as string}
        </div>
      )}

      {/* Rebuild-Log: mehrzeilig, scrollbar (analog Block 2). `white-space: pre`
          → breite cluster.sh-Tabellenzeilen scrollen horizontal statt abzuschneiden. */}
      {(rebuilding || rebuildLines.length > 0) && (
        <div
          ref={logRef}
          className={`sn-rebuild-log${rebuildState === 'error' ? ' sn-rebuild-log--error' : ''}`}
          role="log"
          aria-live="polite"
        >
          {rebuildLines.length === 0 ? (
            <div className="sn-rebuild-log__line">
              {t('semanticNames.rebuilding', { defaultValue: 'Wird neu geclustert …' }) as string}
            </div>
          ) : (
            rebuildLines.map((l, i) => (
              <div key={i} className="sn-rebuild-log__line">{l}</div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
