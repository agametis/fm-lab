import React, { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCalculationTokens } from '../hooks/useCalculationTokens';
import { useApiLang } from '../hooks/useApiLang';
import { useCurrentFile } from '../lib/currentFileContext';
import { buildObjectPath } from '../lib/navigation';
import { HighlightRefContext } from '../script/highlightContext';
import { useVarSelection, useVarDeepLinkScroll, countCalcVarMatches } from '../script/varSelectionContext';
import { CalcTokenList, normalizeCalcWhitespace } from './CalcTokenSpan';
import { LayoutFormulaLine } from './LayoutFormulaLine';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import './CustomFunctionViewer.css';
import './FieldViewer.css';

interface CalculationDetailProps {
  uuid: string;
  /** Cross-Reference Highlight: Token-Match auf Tokens mit `uuid ∈ Set`. */
  highlightRefUuids?: Set<string> | null;
  /** Reicht die gezählten Highlight-Treffer hoch zur RefOriginPill. */
  onLiveMatchCount?: (count: number) => void;
}

/**
 * Detail-View einer Calculation-INSTANZ (Owner × Rolle × Index, Schema 1.22.0).
 * Rendert die Formel tokenisiert (identisch zum Script-/CustomFunction-Detail:
 * Funktions-Tooltips, klickbare Field-/CF-Refs), den Owner als klickbaren
 * Breadcrumb, Rolle/Index/Slot und die abgeleiteten Ziel-Links.
 *
 * DDR-lose Instanzen (keine Tokens) fallen deklariert auf den strukturellen
 * Klartext zurück — mit sichtbarem Hinweis, nie über den Fehlerpfad.
 */
export const CalculationDetail: React.FC<CalculationDetailProps> = ({
  uuid,
  highlightRefUuids,
  onLiveMatchCount,
}) => {
  const { t } = useTranslation(['detail']);
  const lang = useApiLang();
  const navigate = useNavigate();
  const currentFile = useCurrentFile();
  const { data, loading, error, retry } = useCalculationTokens(uuid, lang, currentFile);
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

  // Live-Match-Count für die RefOriginPill (analog FieldViewer).
  const liveMatchCount = useMemo(() => {
    if (!data || !highlightRefUuids || highlightRefUuids.size === 0) return 0;
    let n = 0;
    for (const tok of data.tokens) {
      if (tok.uuid && highlightRefUuids.has(tok.uuid)) n++;
    }
    return n;
  }, [data, highlightRefUuids]);
  useEffect(() => {
    onLiveMatchCount?.(liveMatchCount);
  }, [liveMatchCount, onLiveMatchCount]);

  // Variablen-Auswahl: Trefferzählung + Deep-Link-Scroll (ready erst mit Daten,
  // sonst verpufft der einmalige Scroll-Versuch im Loading-Zustand).
  const varSel = useVarSelection();
  const varMatches = useMemo(
    () => countCalcVarMatches(data?.tokens ?? [], varSel?.selectedKey ?? null),
    [data, varSel?.selectedKey],
  );
  useEffect(() => {
    varSel?.reportMatches(varMatches.count, varMatches.displayName);
  }, [varMatches, varSel]);
  useVarDeepLinkScroll(rootRef, !loading && !!data);

  if (loading) return <LoadingSpinner message={t('detail:calculationDetail.loading', { defaultValue: 'Loading calculation…' }) as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data) return <div className="no-references">{t('detail:noReferences')}</div>;

  const calc = data.calc;
  const targets = data.targets ?? [];
  // Rollen-Label aus i18n; unbekannte Rollen fallen auf den API-Rollenstring zurück.
  const roleLabel = (role: string): string =>
    t(`detail:calculationDetail.roles.${role}`, { defaultValue: role }) as string;
  // Tokens rendern, sobald welche da sind — echte (DDR-Chunks) ODER
  // synthetisch aus der geretteten Formel rekonstruierte (tokensRecovered).
  const hasTokens = data.tokens.length > 0;

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <div ref={rootRef} className="fm-customfunction fm-calculation" aria-label={t('detail:calculationDetail.ariaLabel', { defaultValue: 'Calculation details' }) as string}>
        <div className="fm-customfunction-header">
          <h2 className="type-detail-heading">
            {calc ? roleLabel(calc.role) : (data.object.name ?? t('detail:headings.Calculation', { defaultValue: 'Calculation' }))}
            {calc && calc.index > 1 && <span className="fm-field-origin"> #{calc.index}</span>}
          </h2>
          <span className="fm-customfunction-meta">{data.object.file}</span>
        </div>

        {calc && (
          <dl className="fm-field-props">
            <dt>{t('detail:calculationDetail.owner', { defaultValue: 'Owner' })}</dt>
            <dd>
              <button
                type="button"
                className="fm-field-link"
                onClick={() => navigate(buildObjectPath(calc.owner.uuid, uuid, calc.owner.file))}
              >
                {calc.owner.name ?? calc.owner.uuid}
              </button>
              <span className="fm-field-origin"> [{calc.owner.type}]</span>
            </dd>
            {calc.sourcePath && (
              <>
                <dt>{t('detail:calculationDetail.slot', { defaultValue: 'Slot' })}</dt>
                <dd><code className="fm-field-inline-calc">{calc.sourcePath}</code></dd>
              </>
            )}
            <dt>{t('detail:calculationDetail.kind', { defaultValue: 'Kind' })}</dt>
            <dd>
              {calc.isStatic
                ? t('detail:calculationDetail.kindStatic', { defaultValue: 'Static value' })
                : t('detail:calculationDetail.kindFormula', { defaultValue: 'Formula' })}
            </dd>
            {calc.contextTo && (
              <>
                <dt>{t('detail:calculationDetail.contextTo', { defaultValue: 'Evaluation context' })}</dt>
                <dd>{calc.contextTo}</dd>
              </>
            )}
            {calc.resultType && (
              <>
                <dt>{t('detail:calculationDetail.resultType', { defaultValue: 'Result type' })}</dt>
                <dd>{t(`detail:calculationDetail.resultTypes.${calc.resultType}`, { defaultValue: calc.resultType })}</dd>
              </>
            )}
          </dl>
        )}

        {calc?.layoutFormula && (
          <div className="fm-field-formula">
            <LayoutFormulaLine formula={calc.layoutFormula} resultType={calc.resultType} />
          </div>
        )}

        <div className="fm-field-formula">
          <div className="fm-field-formula-label">
            {t('detail:calculationDetail.formula', { defaultValue: 'Formula' })}
          </div>
          {hasTokens ? (
            <>
              <pre className="fm-customfunction-body">
                <code>
                  <CalcTokenList tokens={data.tokens} />
                </code>
              </pre>
              {data.tokensRecovered && (
                <div className="fm-calc-fallback-hint">
                  {t('detail:calculationDetail.recoveredHint', {
                    defaultValue: 'Tokens reconstructed from the recovered formula — this instance has no DDR chunk data; built-in functions remain unresolved.',
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <pre className="fm-customfunction-body">
                <code>{normalizeCalcWhitespace(data.plainText ?? '')}</code>
              </pre>
              <div className="fm-calc-fallback-hint">
                {t('detail:calculationDetail.ddrlessHint', {
                  defaultValue: 'Plain text only — this instance has no DDR chunk data, so tokens, tooltips and cross-navigation are unavailable.',
                })}
              </div>
            </>
          )}
        </div>

        {targets.length > 0 && (
          <div className="fm-field-formula">
            <div className="fm-field-formula-label">
              {t('detail:calculationDetail.targets', { defaultValue: 'Resolved targets' })}
            </div>
            <ul className="fm-calc-target-list">
              {targets.map((tg, i) => (
                <li key={`${tg.linkRole}-${tg.uuid ?? i}`}>
                  {tg.uuid ? (
                    <button
                      type="button"
                      className="fm-field-link"
                      onClick={() => navigate(buildObjectPath(tg.uuid as string, uuid, tg.file))}
                    >
                      {tg.name ?? tg.uuid}
                    </button>
                  ) : (
                    tg.name
                  )}
                  <span className="fm-field-origin">
                    {' '}({tg.type ?? '?'} · {tg.linkRole}{tg.crossFile && tg.file ? ` · ${tg.file}` : ''})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </HighlightRefContext.Provider>
  );
};
