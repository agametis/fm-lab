import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DashboardHost } from './DashboardHost';
import { SubPageHeader } from '../components';
import { buildBreadcrumb } from '../lib/navigation';

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

  // Titel + Description kommen aus dem Manifest des Eintrags (echter Titel +
  // reiche Beschreibung) → DashboardHost rendert die Titelbox. Hier nur die
  // Breadcrumb-Wurzel; der Breadcrumb-Titel bleibt die Slug-Ableitung.
  const breadcrumbs = buildBreadcrumb({ kind: 'dashboard', title: idToTitle(id) }, t);

  return (
    <div className="app">
      <SubPageHeader breadcrumbs={breadcrumbs} />
      <DashboardHost id={id} params={params} showManifestTitle />
    </div>
  );
}

function idToTitle(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
