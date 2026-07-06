import type { ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DashboardHost } from './DashboardHost';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { TitleBox } from '../components/TitleBox';
import { buildBreadcrumb, type BreadcrumbCtx } from '../lib/navigation';

/**
 * Leitseiten: clean top-level routes that render an
 * existing dashboard bundle with a hard-wired id and a proper breadcrumb —
 * replacing the generic `/dashboard/:id` detour for the index bundles.
 */

function titleize(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function BundlePage({
  id,
  ctx,
  params,
  pageTitle,
  pageDescription,
  titleActions,
}: {
  id: string;
  ctx: BreadcrumbCtx;
  params?: Record<string, unknown>;
  /**
   * Leitseiten pass title + description → rendered as a framed TitleBox; das
   * darunter liegende Bundle enthält dann nur noch die Einträge (kein eigener
   * Card-Titel/-Subtitel). Object-entry bundles (docset_home/category) lassen
   * beides weg und nutzen ihre eigene Hero-Titelbox.
   */
  pageTitle?: string;
  pageDescription?: string;
  /** Optional right-aligned quick-jump buttons on the title row. */
  titleActions?: ReactNode;
}) {
  const { t } = useTranslation(['nav']);
  return (
    <div className="app">
      <SubNav breadcrumbs={buildBreadcrumb(ctx, t)} />
      <StatusBar />
      {pageTitle && <TitleBox title={pageTitle} subtitle={pageDescription} actions={titleActions} />}
      <DashboardHost id={id} params={params} />
    </div>
  );
}

/**
 * `/file/:filename` → `file` bundle (per-file detail view). Breadcrumb
 * `Home / {Dateiname}`. The file name is passed both as the bundle param
 * (drives the `:file`-scoped datasets) and as the page title.
 */
export function FileDetailPage() {
  const { filename } = useParams<{ filename: string }>();
  const { t } = useTranslation(['nav']);
  const file = filename ?? '';
  const enc = encodeURIComponent(file);
  const titleActions = (
    <>
      <Link className="title-box__action" to={`/?file=${enc}`}>
        {t('nav:fileActions.search', { defaultValue: 'Search' })}
      </Link>
      <Link
        className="title-box__action"
        to={`/atlas?segment_by=file&seg=${enc}&seg_label=${enc}`}
      >
        {t('nav:fileActions.drilldown', { defaultValue: 'Drill-down' })}
      </Link>
    </>
  );
  return (
    <BundlePage
      id="file"
      ctx={{ kind: 'file', fileLabel: file }}
      params={{ file }}
      pageTitle={file}
      titleActions={titleActions}
    />
  );
}

/** `/dashboard` → `dashboards` bundle. Breadcrumb `Home / Dashboards`. */
export function DashboardsPage() {
  const { t } = useTranslation(['nav']);
  return (
    <BundlePage
      id="dashboards"
      ctx={{ kind: 'dashboards' }}
      pageTitle={t('nav:crumbs.dashboards') as string}
      pageDescription={t('nav:leitDescription.dashboards') as string}
    />
  );
}

/** `/query` → `custom_queries` bundle. Breadcrumb `Home / Custom Queries`. */
export function CustomQueriesPage() {
  const { t } = useTranslation(['nav']);
  return (
    <BundlePage
      id="custom_queries"
      ctx={{ kind: 'customQueries' }}
      pageTitle={t('nav:crumbs.customQueries') as string}
      pageDescription={t('nav:leitDescription.customQueries') as string}
    />
  );
}

/** `/docs` → `docs_overview` bundle. Breadcrumb `Home / Docs`. */
export function DocsOverviewPage() {
  const { t } = useTranslation(['nav']);
  return (
    <BundlePage
      id="docs_overview"
      ctx={{ kind: 'docs' }}
      pageTitle={t('nav:crumbs.docs') as string}
      pageDescription={t('nav:leitDescription.docs') as string}
    />
  );
}

/** `/xml-import` → `xml_convert` bundle. Breadcrumb `Home / XML Import`. */
export function XmlImportPage() {
  const { t } = useTranslation(['nav']);
  return (
    <BundlePage
      id="xml_convert"
      ctx={{ kind: 'xmlImport' }}
      pageTitle={t('nav:crumbs.xmlImport') as string}
      pageDescription={t('nav:leitDescription.xmlImport') as string}
    />
  );
}

/** `/docs/:setId` → `docset_home` bundle. Breadcrumb `Home / Docs / {Set}`. */
export function DocsSetPage() {
  const { set } = useParams<{ set: string }>();
  return (
    <BundlePage
      id="docset_home"
      ctx={{ kind: 'docsSet', setLabel: titleize(set ?? '') }}
      params={{ id: set }}
    />
  );
}

/** `/docs/:set/:category` → `docset_category`. Breadcrumb `Home / Docs / {Set} / {Category}`. */
export function DocsCategoryPage() {
  const { set, category } = useParams<{ set: string; category: string }>();
  return (
    <BundlePage
      id="docset_category"
      ctx={{
        kind: 'docsCategory',
        setId: set ?? '',
        setLabel: titleize(set ?? ''),
        categoryLabel: titleize(category ?? ''),
      }}
      params={{ docset: set, category }}
    />
  );
}
