import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiLang } from '../hooks/useApiLang';
import { getDashboard, getDashboardData } from '../api/dashboardApi';
import type {
  DashboardEnvelope,
  DashboardDataResponse,
} from '../api/dashboardApi';
import { DashboardRenderer } from './DashboardRenderer';
import './dashboard.css';

interface Props {
  id: string;
  params?: Record<string, unknown>;
}

/**
 * Dashboards, die ihre Datasets proaktiv (Fokus / Tab-Sichtbarkeit / Idle-Poll /
 * „Neu scannen"-Button) NICHT-destruktiv nachladen — ohne die View zu leeren.
 * Aktuell nur die XML-Konvertierung: neu im xml/-Verzeichnis abgelegte Dateien
 * sollen auftauchen, ohne dass erst ein Convert-Lauf nötig ist (der Server-Scan
 * `getStatus()` liefert sie längst, das Frontend fragte bisher nur nicht nach).
 * PRD: project/prd_webclient_xml_directory_rescan.md.
 */
const AUTO_REFRESH_DASHBOARDS = new Set(['xml_convert']);
/** Idle-Polling-Intervall für Auto-Refresh-Dashboards. */
const IDLE_POLL_MS = 6000;

/**
 * Lädt Manifest + Daten eines Dashboards und mountet den Renderer.
 * PRD: prd_dashboards.md §8.1.
 */
export function DashboardHost({ id, params }: Props) {
  const { t } = useTranslation();
  const lang = useApiLang();
  const [envelope, setEnvelope] = useState<DashboardEnvelope | null>(null);
  const [datasets, setDatasets] = useState<DashboardDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // External re-fetch trigger (e.g. after a successful docset install via
  // the DocsetInstallControl inline-control). Bumped from a window event.
  const [reloadTick, setReloadTick] = useState(0);
  // Tracks whether an XML convert run is active. Während eines Laufs pausiert der
  // Soft-Refresh — dann besitzt das Live-SSE-Overlay (useXmlConvertFileStates)
  // die Datei-Tabelle, und ein Re-Fetch der statischen Zeilen wäre unnötig/störend.
  const convertRunningRef = useRef(false);

  useEffect(() => {
    const handler = () => setReloadTick(n => n + 1);
    window.addEventListener('fmlab:reload-dashboard', handler);
    const onConvertStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ status?: string }>).detail;
      convertRunningRef.current = detail?.status === 'running';
    };
    window.addEventListener('fmlab:xml-convert-status', onConvertStatus);
    return () => {
      window.removeEventListener('fmlab:reload-dashboard', handler);
      window.removeEventListener('fmlab:xml-convert-status', onConvertStatus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEnvelope(null);
    setDatasets(null);

    (async () => {
      try {
        const [env, data] = await Promise.all([
          getDashboard(id, lang),
          getDashboardData(id, params, lang),
        ]);
        if (cancelled) return;
        setEnvelope(env);
        setDatasets(data);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, JSON.stringify(params || {}), lang, reloadTick]);

  // Nicht-destruktiver In-place-Refresh: lädt NUR die Dataset-Payload neu und
  // tauscht sie aus, OHNE `loading`/`datasets=null` zu setzen (das würde die View
  // leeren + den Renderer remounten = Flackern, und die lokalen Tabellen-States
  // wie Suche/Sortierung verwerfen). Bei laufendem Convert oder verstecktem Tab
  // wird übersprungen; bei identischer Payload (Idle-Poll ohne Änderung) entfällt
  // das setState, sodass kein Re-Render anfällt.
  const softRefresh = useCallback(async () => {
    if (convertRunningRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      const data = await getDashboardData(id, params, lang);
      setDatasets(prev => {
        if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
    } catch {
      // Soft-Refresh bleibt still — bei transienten Fehlern die aktuelle View halten.
    }
  }, [id, JSON.stringify(params || {}), lang]);

  // Auto-Refresh-Trigger (Fokus / Tab-Sichtbarkeit / Idle-Poll / „Neu scannen") —
  // nur für opt-in-Dashboards (AUTO_REFRESH_DASHBOARDS) und erst nach dem
  // Erst-Load (envelope vorhanden). Hält die XML-Datei-Tabelle mit dem
  // xml/-Verzeichnis synchron, ohne einen Convert-Lauf zu erzwingen.
  useEffect(() => {
    if (!AUTO_REFRESH_DASHBOARDS.has(id) || !envelope) return;

    const trigger = () => { void softRefresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void softRefresh(); };

    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('fmlab:refresh-datasets', trigger);

    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void softRefresh();
    }, IDLE_POLL_MS);

    return () => {
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('fmlab:refresh-datasets', trigger);
      window.clearInterval(poll);
    };
  }, [id, envelope, softRefresh]);

  if (loading) {
    return <div className="dash-host dash-host--loading">{t('dashboard.loading')}</div>;
  }
  if (error) {
    return (
      <div className="dash-host dash-host--error">
        <strong>{t('dashboard.loadError', { message: '' }).replace(/:\s*$/, ':')}</strong>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!envelope || !datasets) {
    return <div className="dash-host">{t('dashboard.noData')}</div>;
  }

  return (
    <div className={`dash-host dash-host--${envelope.manifest.id}`}>
      <DashboardRenderer layout={envelope.layout} datasets={datasets} />
    </div>
  );
}
