import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RefOriginState } from '../hooks/useRefOrigin';

interface RefOriginPillProps {
  state: RefOriginState;
  /** Raw value of the `?ref=` parameter (shown when unresolved). */
  rawRef: string;
  /** Dismiss handler — removes `ref` from the URL. */
  onDismiss: () => void;
  /**
   * Optional: actual match count in the active view. When unknown the pill
   * falls back to `state.matchCount` (server lookup).
   */
  liveMatchCount?: number;
}

/**
 * Origin indicator pill for cross-reference highlighting.
 *
 * Renders a thin strip above the tab bar:
 *   ▶ Reference: <Type> · <Name>    [✕]
 *     <N> matches highlighted
 *
 * Clicking the arrow opens the origin detail view; clicking the ✕ removes
 * the `ref` parameter from the URL.
 */
export const RefOriginPill: React.FC<RefOriginPillProps> = ({
  state,
  rawRef,
  onDismiss,
  liveMatchCount,
}) => {
  const { t } = useTranslation(['detail']);
  if (state.status === 'idle') return null;

  if (state.status === 'loading') {
    return (
      <div className="ref-pill ref-pill--loading" role="status" aria-live="polite">
        <span className="ref-pill-label">{t('detail:refPill.loading')}</span>
        <button
          type="button"
          className="ref-pill-dismiss"
          onClick={onDismiss}
          aria-label={t('detail:refPill.dismissAria') as string}
          title={t('detail:refPill.dismissAria') as string}
        >
          ✕
        </button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="ref-pill ref-pill--error" role="alert">
        <span className="ref-pill-label">
          {t('detail:refPill.couldNotResolve', { message: state.error })}
        </span>
        <button
          type="button"
          className="ref-pill-dismiss"
          onClick={onDismiss}
          aria-label={t('detail:refPill.dismissAria') as string}
          title={t('detail:refPill.dismissAria') as string}
        >
          ✕
        </button>
      </div>
    );
  }

  if (state.status === 'unresolved' || !state.origin) {
    return (
      <div className="ref-pill ref-pill--unresolved" role="status">
        <span className="ref-pill-icon" aria-hidden="true">⚠</span>
        <span className="ref-pill-label">
          {t('detail:refPill.notFound')} <code>{rawRef}</code>
        </span>
        <button
          type="button"
          className="ref-pill-dismiss"
          onClick={onDismiss}
          aria-label={t('detail:refPill.dismissAria') as string}
          title={t('detail:refPill.dismissAria') as string}
        >
          ✕
        </button>
      </div>
    );
  }

  const count = liveMatchCount ?? state.matchCount;
  // Without matches in the current view the pill is just noise — the `?ref=`
  // parameter is preserved (switching tabs may produce matches again) but the
  // visual indicator is suppressed. Pressing Esc still clears the param.
  if (count === 0) return null;
  const o = state.origin;
  return (
    <div className="ref-pill ref-pill--resolved" role="status" aria-live="polite">
      <span className="ref-pill-label">
        {t('detail:refPill.label')} <span className="ref-pill-type">{o.type}</span>
        <span className="ref-pill-sep"> · </span>
        <span className="ref-pill-name">{o.name}</span>
        {o.file && (
          <span className="ref-pill-file"> ({o.file})</span>
        )}
      </span>
      <span className="ref-pill-count">
        {t('detail:refPill.highlightsCount', { count })}
      </span>
      <button
        type="button"
        className="ref-pill-dismiss"
        onClick={onDismiss}
        aria-label={t('detail:refPill.dismissAria') as string}
        title={t('detail:refPill.dismissTitle') as string}
      >
        ✕
      </button>
    </div>
  );
};
