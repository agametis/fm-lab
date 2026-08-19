import { useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DashboardHost } from './DashboardHost';
import { SubPageHeader } from '../components';
import { buildBreadcrumb } from '../lib/navigation';
import type { DashboardDataResponse } from '../api/dashboardApi';

/**
 * Route view for `/query/:queryName`. Thin wrapper around the `_generic`
 * dashboard with the query name as a parameter. Additional URL search
 * params (e.g. `?file=...`) are forwarded to the dashboard.
 */
export function QueryView() {
  const { t } = useTranslation(['nav']);
  const { queryName } = useParams<{ queryName: string }>();
  const [searchParams] = useSearchParams();
  // Breadcrumb source: the `query_meta` dataset the generic bundle loads
  // anyway. A query's identity lives in the DATA, not in the bundle manifest —
  // `_generic` is the same bundle for every query. Until it arrives, the slug
  // derivation stands in, so the chain grows by the category instead of jumping.
  const [crumbSource, setCrumbSource] = useState<{ title: string; category: string | null } | null>(null);

  const handleDatasets = useCallback((datasets: DashboardDataResponse) => {
    const row = datasets.query_meta?.data?.[0] as Record<string, unknown> | undefined;
    if (!row) return;
    setCrumbSource({
      title: typeof row.title === 'string' && row.title ? row.title : titleize(String(row.query ?? '')),
      category: typeof row.category === 'string' && row.category ? row.category : null,
    });
  }, []);

  if (!queryName) {
    return <div className="dash-host dash-host--error">{t('nav:errors.noQueryName')}</div>;
  }

  const params: Record<string, unknown> = { query: queryName };
  for (const [k, v] of searchParams.entries()) {
    if (k !== 'query') params[k] = v;
  }

  const breadcrumbs = buildBreadcrumb(
    {
      kind: 'query',
      name: crumbSource?.title ?? titleize(queryName),
      category: crumbSource?.category,
    },
    t,
  );

  // Kein Frontend-Titel: das _generic-Bundle rendert den *echten* Query-Titel
  // (aus den Daten, nicht der Slug-Ableitung) als Hero-Titelbox. Die Krume
  // benutzt jetzt dieselbe Quelle, beide können also nicht mehr auseinanderlaufen.
  return (
    <div className="app">
      <SubPageHeader breadcrumbs={breadcrumbs} />
      <DashboardHost id="_generic" params={params} onDatasetsLoaded={handleDatasets} />
    </div>
  );
}

/** Loading-state stand-in only: `layout_overlap_explorer` → "Layout Overlap Explorer". */
function titleize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
