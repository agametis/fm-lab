import React from 'react';
import { useTranslation } from 'react-i18next';
import { useScriptTokens } from '../hooks/useScriptTokens';
import { useApiLang } from '../hooks/useApiLang';
import { ScriptViewer } from './ScriptViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface ScriptDetailProps {
  uuid: string;
  /** Cross-reference highlight (PRD §7.2): highlight tokens that match these UUIDs. */
  highlightRefUuids?: Set<string> | null;
  /** Reicht die im ScriptViewer gezählten Highlight-Treffer hoch zur RefOriginPill. */
  onLiveMatchCount?: (count: number) => void;
}

export const ScriptDetail: React.FC<ScriptDetailProps> = ({ uuid, highlightRefUuids, onLiveMatchCount }) => {
  const { t } = useTranslation(['detail']);
  const lang = useApiLang();
  const { data, loading, error, retry } = useScriptTokens(uuid, lang);

  if (loading) return <LoadingSpinner message={t('detail:loadingObject') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || !data.lines || data.lines.length === 0) {
    return <div className="no-references">{t('detail:noReferences')}</div>;
  }

  return <ScriptViewer tokens={data} highlightRefUuids={highlightRefUuids} onLiveMatchCount={onLiveMatchCount} />;
};
