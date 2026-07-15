import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface StatusBarProps {
  /** Custom back handler. Default: navigate(-1), fallback to "/". */
  onBack?: () => void;
  /**
   * Generic status-message slot (V3) — cross-reference highlight, filter hits,
   * graph live-stats. Rendered right of the back button.
   */
  message?: ReactNode;
  /**
   * Filterbar slot (Ebene 4/5) — rendered below the back/status row. Wrap with
   * the `<Filterbar>` component for consistent styling.
   */
  children?: ReactNode;
  /**
   * Optional controls pinned to the far right of the back/status row (e.g. the
   * solution switcher + settings gear on the XML-Import page).
   */
  trailingActions?: ReactNode;
}

/**
 * StatusBar — Ebene 4: back navigation plus optional
 * status message and an optional filter/tool bar slot. Used by every standard
 * (non-Start) page.
 */
export function StatusBar({ onBack, message, children, trailingActions }: StatusBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(['common']);

  const handleBack =
    onBack ??
    (() => {
      if (location.key !== 'default') navigate(-1);
      else navigate('/');
    });

  const backLabel = t('common:backToPrevious');

  return (
    <div className="status-bar">
      <div className="status-bar__row">
        <button
          type="button"
          onClick={handleBack}
          className="back-button"
          aria-label={backLabel as string}
          title={backLabel as string}
        >
          ← {t('common:back')}
        </button>
        {message && <div className="status-bar__message">{message}</div>}
        {trailingActions}
      </div>
      {children && <div className="status-bar__filter">{children}</div>}
    </div>
  );
}
