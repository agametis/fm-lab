import { useEffect, useState } from 'react';
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
  const [envelope, setEnvelope] = useState<DashboardEnvelope | null>(null);
  const [datasets, setDatasets] = useState<DashboardDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEnvelope(null);
    setDatasets(null);

    (async () => {
      try {
        const [env, data] = await Promise.all([
          getDashboard(id),
          getDashboardData(id, params),
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
  }, [id, JSON.stringify(params || {})]);

  if (loading) {
    return <div className="dash-host dash-host--loading">Dashboard wird geladen …</div>;
  }
  if (error) {
    return (
      <div className="dash-host dash-host--error">
        <strong>Dashboard konnte nicht geladen werden:</strong>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!envelope || !datasets) {
    return <div className="dash-host">Keine Daten.</div>;
  }

  return (
    <div className={`dash-host dash-host--${envelope.manifest.id}`}>
      <DashboardRenderer layout={envelope.layout} datasets={datasets} />
    </div>
  );
}
