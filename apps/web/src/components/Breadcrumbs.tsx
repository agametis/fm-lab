import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BreadcrumbItem } from '../types';

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb Navigation Component
 * Shows the navigation path: Search > ObjectType > ObjectName
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  const navigate = useNavigate();
  const { t } = useTranslation(['nav']);

  return (
    <nav className="breadcrumbs" aria-label={t('nav:breadcrumbs.ariaLabel') as string}>
      <ol style={{
        display: 'flex',
        gap: '0.5rem',
        listStyle: 'none',
        padding: 0,
        margin: 0,
        fontSize: '0.9rem',
        color: '#888',
        flexWrap: 'wrap',
      }}>
        {items.map((item, index) => (
          <li key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {item.path !== null ? (
              <>
                <button
                  onClick={() => navigate(item.path!)}
                  className="breadcrumb-link"
                  aria-label={t('nav:breadcrumbs.linkAria', { label: item.label }) as string}
                >
                  {item.label}
                </button>
                <span aria-hidden="true" style={{ color: '#555' }}>/</span>
              </>
            ) : (
              <span aria-current="page" style={{ color: '#fff' }}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};
