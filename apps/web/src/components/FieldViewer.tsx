import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldTokens } from '../script/calcTokens';
import { HighlightRefContext } from '../script/highlightContext';
import { CalcTokenSpan } from './CalcTokenSpan';
import './CustomFunctionViewer.css';
import './FieldViewer.css';

interface FieldViewerProps {
  data: FieldTokens;
  /** Cross-Reference Highlight: Token-Match auf Tokens mit `uuid ∈ Set`. */
  highlightRefUuids?: Set<string> | null;
  /** Reicht die gezählten Highlight-Treffer hoch zur RefOriginPill. */
  onLiveMatchCount?: (count: number) => void;
}

/**
 * Renderer für die Feld-Details. Zeigt die Feld-Metadaten (Tabelle, Typ,
 * Datentyp, Kommentar etc.) als Property-Liste und — falls vorhanden — die
 * Calculation-Formel als Token-Sequenz (analog CustomFunctionViewer).
 *
 * Tokens werden über `CalcTokenSpan` gerendert, identisch zu CustomFunctions:
 * Engine-Funktionen erhalten einen Reference-DB-Tooltip, Field- und CF-Refs
 * werden zu klickbaren Links. Variablen, Plugin-Funktionen und Kommentare
 * bekommen ihre jeweilige Highlight-Klasse.
 */
export const FieldViewer: React.FC<FieldViewerProps> = ({ data, highlightRefUuids, onLiveMatchCount }) => {
  const { t } = useTranslation(['detail']);
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightSig = highlightRefUuids ? Array.from(highlightRefUuids).sort().join(',') : '';
  useEffect(() => {
    if (!highlightSig || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector('.fm-ref--highlighted');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightSig]);

  // Live-Match-Count: zählt Calc-Tokens mit UUID im Highlight-Set. Für die
  // RefOriginPill — der server-seitige back_references-Count liefert für
  // Token-Container keinen (Field) bzw. nur einen Self-Link-Repräsentanten,
  // nicht die tatsächliche Anzahl Vorkommen in der Formel (analog ScriptViewer).
  const liveMatchCount = useMemo(() => {
    if (!highlightRefUuids || highlightRefUuids.size === 0) return 0;
    let n = 0;
    for (const tok of data.tokens) {
      if (tok.uuid && highlightRefUuids.has(tok.uuid)) n++;
    }
    return n;
  }, [data.tokens, highlightRefUuids]);
  useEffect(() => {
    onLiveMatchCount?.(liveMatchCount);
  }, [liveMatchCount, onLiveMatchCount]);

  const field = data.field;
  const hasFormula = data.tokens && data.tokens.length > 0;
  const formulaLabel = field?.autoEnterType === 'Calculated'
    ? t('detail:fieldViewer.autoEnterCalculation')
    : t('detail:fieldViewer.calculationFormula');

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <div ref={rootRef} className="fm-customfunction fm-field" aria-label={t('detail:fieldViewer.ariaLabel') as string}>
        <div className="fm-customfunction-header">
          <h2 className="type-detail-heading">
            {field?.table && (
              <span className="fm-field-table">{field.table}::</span>
            )}
            {data.object.name}
          </h2>
          <span className="fm-customfunction-meta">{data.object.file}</span>
        </div>

        {field && (
          <dl className="fm-field-props">
            <dt>{t('detail:fieldViewer.fieldType')}</dt>
            <dd>{field.fieldType ?? '-'}</dd>
            <dt>{t('detail:fieldViewer.dataType')}</dt>
            <dd>{field.dataType ?? '-'}</dd>
            {field.isGlobal && (
              <>
                <dt>{t('detail:fieldViewer.global')}</dt>
                <dd>{t('detail:fieldViewer.yes')}</dd>
              </>
            )}
            {field.maxRepetitions > 1 && (
              <>
                <dt>{t('detail:fieldViewer.repetitions')}</dt>
                <dd>{field.maxRepetitions}</dd>
              </>
            )}
            {field.autoEnterType && (
              <>
                <dt>{t('detail:fieldViewer.autoEnter')}</dt>
                <dd>{field.autoEnterType}</dd>
              </>
            )}
            {field.comment && (
              <>
                <dt>{t('detail:fieldViewer.comment')}</dt>
                <dd className="fm-field-comment">{field.comment}</dd>
              </>
            )}
          </dl>
        )}

        {hasFormula && (
          <div className="fm-field-formula">
            <div className="fm-field-formula-label">{formulaLabel}</div>
            <pre className="fm-customfunction-body">
              <code>
                {data.tokens.map((tok, idx) => (
                  <CalcTokenSpan key={idx} token={tok} />
                ))}
              </code>
            </pre>
          </div>
        )}
      </div>
    </HighlightRefContext.Provider>
  );
};
