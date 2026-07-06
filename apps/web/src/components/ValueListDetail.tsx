import React from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { useCurrentFile } from '../lib/currentFileContext';
import { ValueListViewer } from './ValueListViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface ValueListDetailProps {
  uuid: string;
}

/**
 * Wrapper für den ValueList-Detail-View. Lädt die strukturierte Projektion
 * via /api/get-details (Template object_details_valuelist) und rendert
 * Custom Values als Tabelle bzw. Field-/External-Quelle als klickbare Chunks
 * statt des generischen Text-Blocks.
 */
export const ValueListDetail: React.FC<ValueListDetailProps> = ({ uuid }) => {
  const { t } = useTranslation(['common']);
  const currentFile = useCurrentFile();
  const { data, loading, error, retry } = useObjectDetails(uuid, currentFile);

  if (loading) return <LoadingSpinner message={t('common:loading') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <div className="no-references">{t('common:noData')}</div>;

  return <ValueListViewer data={data} />;
};
