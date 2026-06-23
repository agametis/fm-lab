import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCustomFunctionTokens } from '../hooks/useCustomFunctionTokens';
import { useApiLang } from '../hooks/useApiLang';
import { CustomFunctionViewer } from './CustomFunctionViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface CustomFunctionDetailProps {
  uuid: string;
  /** Cross-reference highlight: highlight tokens that match these UUIDs. */
  highlightRefUuids?: Set<string> | null;
}

/**
 * Wrapper for the token-based custom-function view. Loads
 * `/api/get-details?format=tokens&enrich=<lang>` and renders the
 * token sequence with reference-DB tooltips for engine functions.
 *
 * The language tracks the active i18n language via `useApiLang()`.
 */
export const CustomFunctionDetail: React.FC<CustomFunctionDetailProps> = ({ uuid, highlightRefUuids }) => {
  const { t } = useTranslation(['detail']);
  const lang = useApiLang();
  const { data, loading, error, retry } = useCustomFunctionTokens(uuid, lang);

  if (loading) return <LoadingSpinner message={t('detail:loadingFunction') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || !data.tokens || data.tokens.length === 0) {
    return <div className="no-references">{t('detail:noReferences')}</div>;
  }

  return <CustomFunctionViewer data={data} highlightRefUuids={highlightRefUuids} />;
};
