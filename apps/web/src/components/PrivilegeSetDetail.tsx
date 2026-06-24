import React from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { useCurrentFile } from '../lib/currentFileContext';
import { PrivilegeSetViewer } from './PrivilegeSetViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface PrivilegeSetDetailProps {
  uuid: string;
  /** Cross-reference highlight: highlight tokens that match these UUIDs. */
  highlightRefUuids?: Set<string> | null;
}

/**
 * Wrapper für den Privilege-Set-Detail-View. Lädt die strukturierte Projektion
 * via /api/get-details (Template object_details_privilegeset) und rendert
 * Standard-Rechte + Custom Record/Field/Object Privileges. Record-Access-Calcs
 * werden mit lesbarer (und via /api/get-calc klickbarer) Formel dargestellt.
 */
export const PrivilegeSetDetail: React.FC<PrivilegeSetDetailProps> = ({ uuid, highlightRefUuids }) => {
  const { t } = useTranslation(['common', 'detail']);
  const currentFile = useCurrentFile();
  const { data, meta, loading, error, retry } = useObjectDetails(uuid, currentFile);

  if (loading) return <LoadingSpinner message={t('common:loading') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <div className="no-references">{t('common:noData')}</div>;

  return (
    <PrivilegeSetViewer
      data={data}
      objectName={meta?.object_name ?? null}
      fileName={meta?.file_name ?? null}
      highlightRefUuids={highlightRefUuids}
    />
  );
};
