import { useParams, useSearchParams } from 'react-router-dom';
import { DashboardHost } from './DashboardHost';
import { SubPageHeader } from '../components';
import type { BreadcrumbItem } from '../types';

/**
 * Route-View für `/dashboard/:id`. Verpackt nur Routing-Params und gibt sie
 * als Dashboard-Props weiter. PRD: prd_dashboards.md §8.
 */
export function DashboardView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  if (!id) {
    return <div className="dash-host dash-host--error">Kein Dashboard-ID angegeben.</div>;
  }

  const params: Record<string, unknown> = {};
  for (const [k, v] of searchParams.entries()) {
    params[k] = v;
  }

  const title = idToTitle(id);
  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Suche', path: '/' },
    { label: title, path: null },
  ];

  return (
    <div className="app">
      <SubPageHeader title={title} breadcrumbs={breadcrumbs} />
      <DashboardHost id={id} params={params} />
    </div>
  );
}

function idToTitle(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
