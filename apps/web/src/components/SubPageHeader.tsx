import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from './Breadcrumbs';
import { ThemeToggle } from './ThemeToggle';
import type { BreadcrumbItem } from '../types';

interface SubPageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  /** Custom back handler. Default: navigate(-1), fallback to "/". */
  onBack?: () => void;
  /**
   * Optional slot rendered between the breadcrumb and the ThemeToggle in the
   * top action bar (e.g. additional toggle buttons).
   */
  actions?: ReactNode;
}

/**
 * SubPageHeader — unified top bar for sub pages (dashboards, queries, and
 * other detail views).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ ← Back   Crumb / Crumb / Page          [actions] [ThemeToggle]   │
 *   │ Title                                                            │
 *   │ optional subtitle                                                │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Mirrors the pattern of `DetailView` (back + breadcrumb + ThemeToggle).
 */
export function SubPageHeader({
  title,
  subtitle,
  breadcrumbs,
  onBack,
  actions,
}: SubPageHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack =
    onBack ??
    (() => {
      if (location.key !== 'default') navigate(-1);
      else navigate('/');
    });

  const backLabel = t('backToPrevious');

  return (
    <header className="sub-page-header">
      <div className="sub-page-header__nav">
        <button
          type="button"
          onClick={handleBack}
          className="back-button"
          aria-label={backLabel as string}
          title={backLabel as string}
        >
          ← {t('back')}
        </button>
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <div className="sub-page-header__actions">
          {actions}
          <ThemeToggle />
        </div>
      </div>
      <div className="sub-page-header__title-row">
        <h1 className="sub-page-header__title">{title}</h1>
        {subtitle && <div className="sub-page-header__subtitle">{subtitle}</div>}
      </div>
    </header>
  );
}
