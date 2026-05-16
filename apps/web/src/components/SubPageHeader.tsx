import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Breadcrumbs } from './Breadcrumbs';
import { ThemeToggle } from './ThemeToggle';
import type { BreadcrumbItem } from '../types';

interface SubPageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  /**
   * Custom Back-Handler. Default: History zurück, mit Fallback auf "/".
   */
  onBack?: () => void;
  /**
   * Optionale Slot-Elemente, die zwischen Breadcrumb und ThemeToggle in der
   * oberen Aktionsleiste landen (z.B. zusätzliche Toggle-Buttons).
   */
  actions?: ReactNode;
}

/**
 * SubPageHeader — einheitlicher Kopfbereich für Sub-Pages (Dashboards,
 * Queries, ggf. weitere Detail-Ansichten).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ ← Zurück   Crumb / Crumb / Page          [actions] [ThemeToggle] │
 *   │ Title                                                            │
 *   │ optional subtitle                                                │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Konsistent zum Pattern der `DetailView` (Back + Breadcrumb + ThemeToggle).
 */
export function SubPageHeader({
  title,
  subtitle,
  breadcrumbs,
  onBack,
  actions,
}: SubPageHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack =
    onBack ??
    (() => {
      if (location.key !== 'default') navigate(-1);
      else navigate('/');
    });

  return (
    <header className="sub-page-header">
      <div className="sub-page-header__nav">
        <button
          type="button"
          onClick={handleBack}
          className="back-button"
          aria-label="Zurück zur vorherigen Ansicht"
          title="Zurück zur vorherigen Ansicht"
        >
          ← Zurück
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
