import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DashboardHost } from './DashboardHost';
import { SubPageHeader } from '../components';
import type { BreadcrumbItem } from '../types';

/**
 * Route view for `/query/:queryName`. Thin wrapper around the `_generic`
 * dashboard with the query name as a parameter. Additional URL search
 * params (e.g. `?file=...`) are forwarded to the dashboard.
 */
export function QueryView() {
  const { t } = useTranslation(['nav']);
  const { queryName } = useParams<{ queryName: string }>();
  const [searchParams] = useSearchParams();

  if (!queryName) {
    return <div className="dash-host dash-host--error">{t('nav:errors.noQueryName')}</div>;
  }

  const params: Record<string, unknown> = { query: queryName };
  for (const [k, v] of searchParams.entries()) {
    if (k !== 'query') params[k] = v;
  }

  const title = titleize(queryName);
  const breadcrumbs: BreadcrumbItem[] = [
    { label: t('nav:breadcrumbs.search') as string, path: '/' },
    { label: t('nav:breadcrumbs.analyses') as string, path: '/dashboard/custom_queries' },
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
