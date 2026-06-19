import React from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { RelationshipViewer } from './RelationshipViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface RelationshipDetailProps {
  uuid: string;
}

/**
 * Wrapper für den Relationship-Detail-View. Lädt die strukturierte Projektion
 * via /api/get-details (Template object_details_relationship) und rendert die
 * grafische Beziehungs-Darstellung (zwei TO-Boxen, Join-Prädikate, Optionen
 * je Seite) statt des generischen Text-Blocks.
 */
export const RelationshipDetail: React.FC<RelationshipDetailProps> = ({ uuid }) => {
  const { t } = useTranslation(['common']);
  const { data, loading, error, retry } = useObjectDetails(uuid);

  if (loading) return <LoadingSpinner message={t('common:loading') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <div className="no-references">{t('common:noData')}</div>;

  return <RelationshipViewer data={data} />;
};
