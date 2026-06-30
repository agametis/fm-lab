import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiLang } from '../hooks/useApiLang';
import { getDashboard, getDashboardData } from '../api/dashboardApi';
import type {
  DashboardEnvelope,
  DashboardDataResponse,
} from '../api/dashboardApi';
import { DashboardRenderer } from './DashboardRenderer';
import { TitleBox } from '../components/TitleBox';
import './dashboard.css';

interface Props {
  id: string;
  params?: Record<string, unknown>;
  /**
   * Render a framed TitleBox from the manifest (title + description) above the
   * grid — for object-entry dashboards (/dashboard/:id), where the manifest
   * carries the authoritative title + rich description. Leitseiten/Query/Docset
   * bundles render their own title and leave this off.
   */
  showManifestTitle?: boolean;
}

/**
 * Dashboards, die ihre Datasets proaktiv (Fokus / Tab-Sichtbarkeit / Idle-Poll /
 * „Neu scannen"-Button) NICHT-destruktiv nachladen — ohne die View zu leeren.
 * Aktuell nur die XML-Konvertierung: neu im xml/-Verzeichnis abgelegte Dateien
 * sollen auftauchen, ohne dass erst ein Convert-Lauf nötig ist (der Server-Scan
 * `getStatus()` liefert sie längst, das Frontend fragte bisher nur nicht nach).
 */
const AUTO_REFRESH_DASHBOARDS = new Set(['xml_convert']);
/**
 * Dashboards, die NUR im Leerzustand (noch kein Katalog importiert) auto-refreshen.
 * Das Home zeigt dann die „erst XML konvertieren"-Karte; per Poll/Focus erscheint eine
 * neu in xml/ abgelegte Datei live (Button aktiviert sich), ohne Seiten-Reload — derselbe
 * Server-Scan (`getStatus()` → `xml_directory_listing`) wie auf der XML-Import-Seite.
 * Sobald der Katalog gefüllt ist, entfällt der Poll wieder (die Home-Daten sind dann statisch).
 */
const AUTO_REFRESH_WHEN_EMPTY_DASHBOARDS = new Set(['home']);
/** Idle-Polling-Intervall für Auto-Refresh-Dashboards. */
const IDLE_POLL_MS = 6000;

/**
 * Lädt Manifest + Daten eines Dashboards und mountet den Renderer.
 */
export function DashboardHost({ id, params, showManifestTitle }: Props) {
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

  // Leerzustand des Katalogs (spiegelt XmlEmptyStateCard): steuert, ob das Home
  // im Ausgangszustand mit-pollt. project_summary.db_empty kommt aus dem (gestubten)
  // leeren Katalog; file_count==null ist der gleiche „nichts importiert"-Marker.
  const summaryRow = datasets?.project_summary?.data?.[0] as Record<string, unknown> | undefined;
  const catalogEmpty = !!summaryRow && (
    summaryRow.db_empty === true || summaryRow.db_empty === 1
    || summaryRow.file_count == null || summaryRow.file_count === 0
  );
  const autoRefresh = AUTO_REFRESH_DASHBOARDS.has(id)
    || (AUTO_REFRESH_WHEN_EMPTY_DASHBOARDS.has(id) && catalogEmpty);

  // Auto-Refresh-Trigger (Fokus / Tab-Sichtbarkeit / Idle-Poll / „Neu scannen") —
  // für opt-in-Dashboards (AUTO_REFRESH_DASHBOARDS) bzw. das Home im Leerzustand
  // (AUTO_REFRESH_WHEN_EMPTY_DASHBOARDS), erst nach dem Erst-Load (envelope vorhanden).
  // Hält das xml/-Verzeichnis-Listing synchron, ohne einen Convert-Lauf zu erzwingen.
  useEffect(() => {
    if (!autoRefresh || !envelope) return;

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
  }, [autoRefresh, envelope, softRefresh]);

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
      {showManifestTitle && envelope.manifest.title && (
        <TitleBox title={envelope.manifest.title} subtitle={envelope.manifest.description} />
      )}
      <DashboardRenderer layout={envelope.layout} datasets={datasets} />
    </div>
  );
}
