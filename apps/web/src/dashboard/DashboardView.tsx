import { useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DashboardHost } from './DashboardHost';
import { SubPageHeader } from '../components';
import { buildBreadcrumb } from '../lib/navigation';
import type { DashboardEnvelope } from '../api/dashboardApi';
import type { BreadcrumbItem } from '../types';

/**
 * Route view for `/dashboard/:id`. Forwards routing/query params to the
 * dashboard host.
 */
export function DashboardView() {
  const { t } = useTranslation(['nav']);
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // Breadcrumb source: the envelope the host loads anyway — no second request.
  // Holds the localized manifest title and the rubric crumbs; until it arrives
  // the slug derivation stands in, so the chain grows by the folder segments
  // instead of jumping (the line is already there, no height change).
  const [crumbSource, setCrumbSource] = useState<{ title: string; folderCrumbs: BreadcrumbItem[] } | null>(null);

  const handleEnvelope = useCallback((env: DashboardEnvelope) => {
    setCrumbSource({
      title: env.manifest.title || idToTitle(env.manifest.id),
      folderCrumbs: (env.nav?.crumbs ?? []).map(c => ({
        label: c.label,
        path: `/dashboard?folder=${encodeURIComponent(c.path)}`,
      })),
    });
  }, []);

  if (!id) {
    return <div className="dash-host dash-host--error">{t('nav:errors.noDashboardId')}</div>;
  }

  const params: Record<string, unknown> = {};
  for (const [k, v] of searchParams.entries()) {
    params[k] = v;
  }

  // Title + description are rendered by DashboardHost (TitleBox); the crumb
  // uses the SAME manifest title, so the two can no longer disagree.
  const breadcrumbs = buildBreadcrumb(
    {
      kind: 'dashboard',
      title: crumbSource?.title ?? idToTitle(id),
      folderCrumbs: crumbSource?.folderCrumbs,
    },
    t,
  );

  return (
    <div className="app">
      <SubPageHeader breadcrumbs={breadcrumbs} />
      <DashboardHost id={id} params={params} showManifestTitle onEnvelopeLoaded={handleEnvelope} />
    </div>
  );
}

/** Loading-state stand-in only: `custom_function_without_comment` → "Custom Function Without Comment". */
function idToTitle(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
