import { useParams, useSearchParams } from 'react-router-dom';
import { DashboardHost } from './DashboardHost';
import { SubPageHeader } from '../components';
import type { BreadcrumbItem } from '../types';

/**
 * Route-View für `/query/:queryName`. Ist ein dünner Wrapper um das
 * `_generic`-Dashboard mit dem Query-Namen als Param. URL-Suchparameter
 * (z.B. `?file=...`) werden zusätzlich an das Dashboard weitergereicht.
 *
 * PRD: project/prd_dashboards_phase2.md §AP6.
 */
export function QueryView() {
  const { queryName } = useParams<{ queryName: string }>();
  const [searchParams] = useSearchParams();

  if (!queryName) {
    return <div className="dash-host dash-host--error">Kein Query-Name angegeben.</div>;
  }

  const params: Record<string, unknown> = { query: queryName };
  for (const [k, v] of searchParams.entries()) {
    if (k !== 'query') params[k] = v;
  }

  const title = titleize(queryName);
  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Suche', path: '/' },
    { label: 'Analysen', path: '/dashboard/custom_queries' },
    { label: title, path: null },
  ];

  return (
    <div className="app">
      <SubPageHeader title={title} breadcrumbs={breadcrumbs} />
      <DashboardHost id="_generic" params={params} />
    </div>
  );
}

function titleize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
