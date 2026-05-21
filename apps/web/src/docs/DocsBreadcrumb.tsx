import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Crumb-Typen vom Backend (siehe rest-api/src/services/docs-source.js
 * buildBreadcrumb). `kind: 'current'` markiert das aktive (letzte) Element.
 */
export interface DocsCrumb {
  kind: 'root' | 'docset' | 'category' | 'current';
  label: string;
  href: string | null;
}

interface DocsBreadcrumbProps {
  items: DocsCrumb[];
  ariaLabel?: string;
}

/**
 * Spezialisierte Breadcrumb für die Docs-Hierarchie (Docs → Set → Category →
 * Function). Behandelt React-Router-Navigation für `href`-Strings; das letzte
 * Element ist `aria-current="page"` und nicht klickbar.
 */
export const DocsBreadcrumb: React.FC<DocsBreadcrumbProps> = ({ items, ariaLabel = 'Docs-Navigation' }) => {
  const navigate = useNavigate();

  return (
    <nav className="docs-breadcrumb" aria-label={ariaLabel}>
      <ol className="docs-breadcrumb__list">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.kind}-${idx}`} className={`docs-breadcrumb__item docs-breadcrumb__item--${item.kind}`}>
              {item.href ? (
                <button
                  type="button"
                  className="docs-breadcrumb__link"
                  onClick={() => navigate(item.href!)}
                >
                  {item.label}
                </button>
              ) : (
                <span aria-current="page" className="docs-breadcrumb__current">{item.label}</span>
              )}
              {!isLast && <span aria-hidden="true" className="docs-breadcrumb__sep">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
