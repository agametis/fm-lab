import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { useCurrentFile } from '../lib/currentFileContext';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

export interface GenericObjectDetailProps {
  uuid: string;
  objectType: string;
  /**
   * Origin-Name für Substring-Highlight in Content-Views.
   */
  highlightText?: string | null;
}

/**
 * Highlight-Substring rendern: zerlegt Text an allen Vorkommen von `needle`
 * und wrappt diese in <mark>. Case-insensitive. Bei leerem needle: Text 1:1.
 */
function highlightSubstring(text: string, needle: string | null | undefined): React.ReactNode {
  if (!needle || needle.length < 2) return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: React.ReactNode[] = [];
  let start = 0;
  let idx = lowerText.indexOf(lowerNeedle, start);
  while (idx !== -1) {
    if (idx > start) out.push(text.slice(start, idx));
    out.push(
      <mark key={`m-${idx}`} className="fm-content-highlight">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    start = idx + needle.length;
    idx = lowerText.indexOf(lowerNeedle, start);
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * Generic non-Layout detail view: lädt content via /api/get-details und rendert
 * als formatierten Text-Block. Eigene Komponente, damit ihre Hooks in einer
 * eigenen Aufruf-Reihenfolge stehen und nicht mit dem Layout-Pfad kollidieren.
 *
 * `highlightText` legt einen Substring-Highlight über alle Zeilen.
 */
export const GenericObjectDetail: React.FC<GenericObjectDetailProps> = ({ uuid, objectType, highlightText }) => {
  const { t } = useTranslation(['common', 'detail']);
  const currentFile = useCurrentFile();
  const { data, loading, error, retry } = useObjectDetails(uuid, currentFile);

  const renderedLines = useMemo(() => {
    if (!data) return null;
    return data.map((row, index) => (
      <span key={index} className="content-line">
        {highlightSubstring(String(row.content), highlightText)}
        {'\n'}
      </span>
    ));
  }, [data, highlightText]);

  if (loading) return <LoadingSpinner message={t('common:loading') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) {
    return <div className="no-references">{t('common:noData')}</div>;
  }

  const heading = t(`detail:headings.${objectType}`, { defaultValue: 'Details' });
  const countLabel = objectType === 'Script' ? ` ${t('detail:scriptViewer.stepCount', { count: data.length })}` : '';

  return (
    <div className="object-detail" aria-label={heading as string}>
      <h2 className="type-detail-heading">{heading}{countLabel}</h2>
      <pre className="content-text">
        <code>{renderedLines}</code>
      </pre>
    </div>
  );
};
