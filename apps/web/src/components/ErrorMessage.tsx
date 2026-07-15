import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isSchemaDriftError, parseSchemaDrift } from '../lib/errors';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

/**
 * Schema-Drift-Hinweis: die geladene Lösung wurde mit einem älteren Katalog-
 * Schema importiert als die App-Templates erwarten. Statt der rohen DuckDB-
 * Binder-Fehlermeldung zeigen wir eine ruhige, handlungsfähige Karte mit dem
 * einen Ausweg: XML neu konvertieren (die Schema-Drift-Erkennung des Importers
 * baut die Objekt-Tabellen dann im aktuellen Schema neu auf).
 */
const SchemaDriftNotice: React.FC<{ message: string }> = ({ message }) => {
  const { t } = useTranslation(['errors']);
  const navigate = useNavigate();
  const versions = parseSchemaDrift(message);

  return (
    <div
      className="error-detail error-detail--drift"
      role="status"
      style={{
        padding: '2rem',
        textAlign: 'center',
        background: '#2a2417',
        border: '1px solid #6b5a1f',
        borderRadius: '8px',
        color: '#e0c86b',
      }}
    >
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }} aria-hidden="true">⟳</div>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{t('errors:schemaDrift.heading')}</h3>
      <p style={{ margin: '0 0 0.5rem', color: '#ccc' }}>{t('errors:schemaDrift.body')}</p>
      {versions && versions.dbVersion && versions.appVersion && (
        <p style={{ margin: '0 0 1rem', color: '#999', fontSize: '0.85rem' }}>
          {t('errors:schemaDrift.versions', {
            dbVersion: versions.dbVersion,
            appVersion: versions.appVersion,
          })}
        </p>
      )}
      <button
        onClick={() => navigate('/xml-import')}
        style={{ padding: '0.5rem 1.5rem' }}
      >
        {t('errors:schemaDrift.action')}
      </button>
    </div>
  );
};

/**
 * Error Message Component
 * Displays an error with optional retry button. Recognises the backend's
 * SCHEMA_DRIFT marker (stable across UI locales) and renders a dedicated,
 * actionable notice instead of the raw error — central here so every detail
 * view that renders <ErrorMessage> benefits at once.
 */
export const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onRetry }) => {
  const { t } = useTranslation(['errors']);

  if (isSchemaDriftError(message)) {
    return <SchemaDriftNotice message={message} />;
  }

  return (
    <div
      className="error-detail"
      role="alert"
      style={{
        padding: '2rem',
        textAlign: 'center',
        background: '#4a1a1a',
        border: '1px solid #8a2a2a',
        borderRadius: '8px',
        color: '#ff6b6b',
      }}
    >
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>!</div>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{t('errors:loadHeading')}</h3>
      <p style={{ margin: '0 0 1rem', color: '#ccc' }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ padding: '0.5rem 1.5rem' }}
          aria-label={t('errors:retryAria') as string}
        >
          {t('errors:retryLabel')}
        </button>
      )}
    </div>
  );
};
