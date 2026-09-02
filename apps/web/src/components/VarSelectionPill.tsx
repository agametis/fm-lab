import React from 'react';
import { useTranslation } from 'react-i18next';
import { varKeyName, varKeyScope } from '../script/varSelectionContext';

interface VarSelectionPillProps {
  /** Kanonischer Auswahl-Schlüssel (`<scope>:<name lowercase>`). */
  varKey: string;
  /** Original-Schreibweise aus dem aktiven View; Fallback: Key-Name (lowercase). */
  displayName: string | null;
  /** Live-Trefferzahl aus dem aktiven View (datenbasiert, siehe reportMatches). */
  count: number;
  /** Entfernt den `var`-Param aus der URL. */
  onDismiss: () => void;
}

/**
 * Auswahl-Pill für das Variablen-Highlight.
 * Bewusst eigenständig neben der RefOriginPill (deren State-Maschine hängt an
 * useRefOrigin/useRefContext) — teilt aber deren Pill-CSS. Ohne Treffer im
 * aktiven View rendert die Pill nichts (stilles Degradieren, analog zum
 * count===0-Verhalten der RefOriginPill).
 */
export const VarSelectionPill: React.FC<VarSelectionPillProps> = ({
  varKey,
  displayName,
  count,
  onDismiss,
}) => {
  const { t } = useTranslation(['detail']);
  if (count === 0) return null;
  return (
    <div className="ref-pill ref-pill--resolved var-pill" role="status" aria-live="polite">
      <div className="ref-pill-main">
        <span className="ref-pill-label">
          {t('detail:varSelect.pillLabel')}{' '}
          <span className="ref-pill-name">{displayName ?? varKeyName(varKey)}</span>
          <span className="ref-pill-file"> ({varKeyScope(varKey)})</span>
        </span>
        <span className="ref-pill-count">
          {t('detail:refPill.highlightsCount', { count })}
        </span>
      </div>
      <button
        type="button"
        className="ref-pill-dismiss"
        onClick={onDismiss}
        aria-label={t('detail:varSelect.dismissAria') as string}
        title={t('detail:varSelect.dismissTitle') as string}
      >
        ✕
      </button>
    </div>
  );
};
