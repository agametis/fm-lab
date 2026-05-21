import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const handler = () => setReloadTick(n => n + 1);
    window.addEventListener('fmlab:reload-dashboard', handler);
    return () => window.removeEventListener('fmlab:reload-dashboard', handler);
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
