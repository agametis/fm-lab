import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from './Breadcrumbs';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSelector } from './LanguageSelector';
import type { BreadcrumbItem } from '../types';

interface SubNavProps {
  /** Breadcrumb chain (built via `buildBreadcrumb()`), starting with Home. */
  breadcrumbs: BreadcrumbItem[];
  /**
   * Optional slot rendered left of the meta navi (language + theme), e.g. a
   * view-specific toggle button.
   */
  actions?: ReactNode;
}

/**
 * SubNav — Ebene 3: the unified sub-page top bar.
 *
 *   🏠  Home / Search / …                       [actions] [Lang] [Theme]
 *
 * Home icon → `/`, breadcrumb chain, and the meta navi (LanguageSelector +
 * ThemeToggle) which from now on appears on **every** page.
 */
export function SubNav({ breadcrumbs, actions }: SubNavProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(['nav']);

  return (
    <div className="sub-nav">
      <button
        type="button"
        className="sub-nav__home"
        onClick={() => navigate('/')}
        aria-label={t('nav:crumbs.home') as string}
        title={t('nav:crumbs.home') as string}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </button>
      <Breadcrumbs items={breadcrumbs} />
      <div className="sub-nav__meta">
        {actions}
        <LanguageSelector />
        <ThemeToggle />
      </div>
    </div>
  );
}
