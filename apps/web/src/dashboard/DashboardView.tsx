import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DashboardHost } from './DashboardHost';
import { SubPageHeader } from '../components';
import type { BreadcrumbItem } from '../types';

/**
 * Route view for `/dashboard/:id`. Forwards routing/query params to the
 * dashboard host.
 */
export function DashboardView() {
  const { t } = useTranslation(['nav']);
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  if (!id) {
    return <div className="dash-host dash-host--error">{t('nav:errors.noDashboardId')}</div>;
  }

  const params: Record<string, unknown> = {};
  for (const [k, v] of searchParams.entries()) {
    params[k] = v;
  }

  const title = idToTitle(id);
  const breadcrumbs: BreadcrumbItem[] = [
    { label: t('nav:breadcrumbs.search') as string, path: '/' },
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
