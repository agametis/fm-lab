import React from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { useCurrentFile } from '../lib/currentFileContext';
import { BaseTableViewer } from './BaseTableViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface BaseTableDetailProps {
  uuid: string;
}

/**
 * Wrapper für den BaseTable-Detail-View. Lädt die strukturierte Projektion
 * via /api/get-details (Template object_details_basetable) und rendert
 * Feld-Typ-Statistik, Felder- und Table-Occurrence-Tabellen statt des
 * generischen Text-Blocks.
 */
export const BaseTableDetail: React.FC<BaseTableDetailProps> = ({ uuid }) => {
  const { t } = useTranslation(['common']);
  const currentFile = useCurrentFile();
  const { data, loading, error, retry } = useObjectDetails(uuid, currentFile);

  if (loading) return <LoadingSpinner message={t('common:loading') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <div className="no-references">{t('common:noData')}</div>;

  return <BaseTableViewer data={data} />;
};
