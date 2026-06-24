import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldTokens } from '../hooks/useFieldTokens';
import { useApiLang } from '../hooks/useApiLang';
import { useCurrentFile } from '../lib/currentFileContext';
import { FieldViewer } from './FieldViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface FieldDetailProps {
  uuid: string;
  /** Cross-reference highlight: highlight tokens that match these UUIDs. */
  highlightRefUuids?: Set<string> | null;
}

/**
 * Wrapper for the token-based field view. Loads
 * `/api/get-details?format=tokens&enrich=<lang>` for fields with
 * a Calculation or AutoEnter-Calculation formula and renders metadata +
 * token sequence with reference-DB tooltips.
 */
export const FieldDetail: React.FC<FieldDetailProps> = ({ uuid, highlightRefUuids }) => {
  const { t } = useTranslation(['detail']);
  const lang = useApiLang();
  const currentFile = useCurrentFile();
  const { data, loading, error, retry } = useFieldTokens(uuid, lang, currentFile);

  if (loading) return <LoadingSpinner message={t('detail:loadingObject') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data) return <div className="no-references">{t('detail:noReferences')}</div>;

  return <FieldViewer data={data} highlightRefUuids={highlightRefUuids} />;
};
