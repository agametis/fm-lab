import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './NoDataYet.css';

interface NoDataYetProps {
  /** Optional override for the message body (defaults to the generic "no solution imported yet" text). */
  message?: string;
}

/**
 * Neutral empty-state for data-driven entry pages (hierarchy tree, atlas) when
 * no FileMaker solution has been imported yet. The underlying analysis views
 * (FolderHierarchy, ClusterEdges, …) only exist after an import, so instead of
 * surfacing the raw DuckDB catalog error we show a calm notice with a single
 * way out: back to the start page, where the guided import card lives.
 */
export const NoDataYet: React.FC<NoDataYetProps> = ({ message }) => {
  const { t } = useTranslation(['nav']);
  const navigate = useNavigate();

  return (
    <div className="no-data-yet" role="status">
      <div className="no-data-yet__icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
          <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
        </svg>
      </div>
      <h2 className="no-data-yet__title">{t('nav:noData.title')}</h2>
      <p className="no-data-yet__message">{message ?? t('nav:noData.message')}</p>
      <button
        type="button"
        className="no-data-yet__button"
        onClick={() => navigate('/')}
      >
        {t('nav:noData.backToStart')}
      </button>
    </div>
  );
};
