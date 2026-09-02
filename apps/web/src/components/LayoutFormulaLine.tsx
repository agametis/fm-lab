import React from 'react';
import { useTranslation } from 'react-i18next';

/** Zerlegung des rekonstruierten Layout-Textankers `<<ƒ:%X:Formel>>`. */
const ANCHOR_RE = /^(<<ƒ:)(%[A-Z]+:)?([\s\S]*)(>>)$/;

/**
 * Rohschicht-Zeile einer display_calculation: der Textanker, wie er im Layout
 * platziert ist (Rekonstruktion aus Result_Type + Formula_Text, API-seitig).
 * Der Ergebnistyp-Präfix (`%M:` …) wird als Mikro-Token mit Tooltip gerendert
 * („Ergebnistyp: Zeitstempel"); der Formelrest bleibt bewusst untokenisiert —
 * die kanonische, navigierbare Form ist der Token-Körper der Instanz direkt
 * darunter. Kein äußerer Wrapper: der Aufrufer setzt den Sektionsrahmen
 * (Standalone-Detail eigener `fm-field-formula`-Block, Slot-Sektion inline).
 */
export const LayoutFormulaLine: React.FC<{
  formula: string;
  resultType?: string | null;
}> = ({ formula, resultType }) => {
  const { t } = useTranslation(['detail']);
  const m = ANCHOR_RE.exec(formula);
  const typeLabel = resultType
    ? (t(`detail:calculationDetail.resultTypes.${resultType}`, { defaultValue: resultType }) as string)
    : null;
  return (
    <>
      <div className="fm-field-formula-label">
        {t('detail:calculationDetail.layoutFormula', { defaultValue: 'Layout calculation' })}
      </div>
      <pre className="fm-customfunction-body">
        <code>
          {m ? (
            <>
              {m[1]}
              {m[2] && (
                <span
                  className="fm-ref fm-ref--resultType"
                  title={
                    typeLabel
                      ? (t('detail:calculationDetail.resultTypeTooltip', {
                          type: typeLabel,
                          defaultValue: `Result type: ${typeLabel}`,
                        }) as string)
                      : undefined
                  }
                >
                  {m[2]}
                </span>
              )}
              {m[3]}
              {m[4]}
            </>
          ) : (
            formula
          )}
        </code>
      </pre>
    </>
  );
};
