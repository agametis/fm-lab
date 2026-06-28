import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BreadcrumbItem } from '../types';

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb Navigation Component
 * Renders the navigation path, e.g. `Home / Search / {Type} / {Name}`.
 * The last item is the active page (no link, `aria-current="page"`).
 *
 * The full chain is always shown — the middle crumbs carry the most context
 * (front and back are already visible elsewhere in the navigation). When the
 * chain is too wide for the viewport it simply wraps to multiple lines
 * (`flex-wrap` on `.breadcrumbs__list`); depths are usually only 3–4 levels.
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  const navigate = useNavigate();
  const { t } = useTranslation(['nav']);

  return (
    <nav className="breadcrumbs" aria-label={t('nav:breadcrumbs.ariaLabel') as string}>
      <ol className="breadcrumbs__list">
        {items.map((item, index) => (
          <li key={index} className="breadcrumbs__item">
            {item.path !== null ? (
              <>
                <button
                  onClick={() => navigate(item.path!)}
                  className="breadcrumb-link"
                  aria-label={t('nav:breadcrumbs.linkAria', { label: item.label }) as string}
                >
                  {item.label}
                </button>
                <span className="breadcrumbs__sep" aria-hidden="true">/</span>
              </>
            ) : (
              <span aria-current="page" className="breadcrumbs__current">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};
