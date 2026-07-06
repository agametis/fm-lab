import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiLang } from '../hooks/useApiLang';
import { useCurrentFile } from '../lib/currentFileContext';
import { useCustomMenuTokens } from '../hooks/useCustomMenuTokens';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { CalcTokenList } from './CalcTokenSpan';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import './CustomMenuDetail.css';

interface CustomMenuDetailProps {
  uuid: string;
  /** 'CustomMenu' (Default) oder 'CustomMenuItem' — steuert nur die Überschrift. */
  objectType?: string;
  highlightRefUuids?: Set<string> | null;
  onLiveMatchCount?: (count: number) => void;
}

/**
 * Custom-Menu-Detailansicht. Kombiniert die textuelle Übersicht (Eigenschaften,
 * Item-Liste, Referenzen — via /api/get-details) mit einer tokenisierten
 * „Berechnungen"-Sektion (via /api/get-details?format=tokens&enrich=<lang>): die
 * Menü-eigenen und pro-Item-Berechnungen (Install-Bedingung, berechneter Name)
 * werden mit Funktions-/Feld-/Variablen-Token-Erkennung, Mouseover-Tooltips und
 * Cross-Navigation gerendert — analog Script/CustomFunction.
 */
export const CustomMenuDetail: React.FC<CustomMenuDetailProps> = ({ uuid, objectType = 'CustomMenu' }) => {
  const { t } = useTranslation(['common', 'detail']);
  const lang = useApiLang();
  const currentFile = useCurrentFile();

  const tokensState = useCustomMenuTokens(uuid, lang, currentFile);
  const contentState = useObjectDetails(uuid, currentFile);

  const contentLines = useMemo(() => {
    if (!contentState.data) return null;
    return contentState.data.map((row, index) => (
      <span key={index} className="content-line">
        {String(row.content)}
        {'\n'}
      </span>
    ));
  }, [contentState.data]);

  if (contentState.loading || tokensState.loading) {
    return <LoadingSpinner message={t('common:loading') as string} />;
  }
  if (contentState.error) {
    return <ErrorMessage message={contentState.error} onRetry={contentState.retry} />;
  }

  const calcs = tokensState.data?.calcs ?? [];

  return (
    <div className="object-detail" aria-label={objectType}>
      <h2 className="type-detail-heading">
        {t(`detail:headings.${objectType}`, { defaultValue: objectType === 'CustomMenuItem' ? 'Custom Menu Item' : 'Custom Menu' })}
      </h2>

      {contentLines && (
        <pre className="content-text">
          <code>{contentLines}</code>
        </pre>
      )}

      {calcs.length > 0 && (
        <div className="fm-menu-calcs" aria-label="Berechnungen">
          <h3 className="fm-menu-calcs-heading">
            {t('detail:customMenu.calculations', { defaultValue: 'Berechnungen' })}
          </h3>
          {tokensState.error && (
            <div className="fm-menu-calcs-error">{tokensState.error}</div>
          )}
          {calcs.map((calc, i) => (
            <div key={i} className="fm-menu-calc">
              <div className="fm-menu-calc-label">
                {calc.label}
                {calc.isStatic && <span className="fm-menu-calc-static"> · statisch</span>}
              </div>
              <pre className="fm-menu-calc-body">
                <code>
                  <CalcTokenList tokens={calc.tokens} />
                </code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
