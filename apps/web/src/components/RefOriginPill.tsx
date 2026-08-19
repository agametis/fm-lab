import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RefOriginState } from '../hooks/useRefOrigin';
import type { RefContextState } from '../hooks/useRefContext';
import { formatObjectDisplayName } from '../lib/objectName';

interface RefOriginPillProps {
  state: RefOriginState;
  /** Raw value of the `?ref=` parameter (shown when unresolved). */
  rawRef: string;
  /** Dismiss handler — removes `ref` (and its context params) from the URL. */
  onDismiss: () => void;
  /**
   * Optional: actual match count in the active view. When unknown the pill
   * falls back to `state.matchCount` (server lookup).
   */
  liveMatchCount?: number;
  /**
   * Findings context of the originating click (`?ref_src=` dashboard +
   * localized `?ref_msgid=` message, resolved via useRefContext). Rendered
   * as a visually separated second row; also keeps the pill visible for
   * layout-level findings that carry no `ref` object at all.
   */
  contextState?: RefContextState;
  /** Raw `?ref_src=` value — dashboard id, target of the source link. */
  contextSrc?: string | null;
}

/**
 * Origin indicator pill for cross-reference highlighting.
 *
 * Renders a thin strip above the tab bar:
 *   ▶ Reference: <Type> · <Name>    [✕]
 *     <N> matches highlighted
 *   ─────────────────────────────────
 *   Source: <Dashboard> — <finding message>
 *
 * Clicking the arrow opens the origin detail view; clicking the ✕ removes
 * the `ref` parameter (plus context params) from the URL.
 */
export const RefOriginPill: React.FC<RefOriginPillProps> = ({
  state,
  rawRef,
  onDismiss,
  liveMatchCount,
  contextState,
  contextSrc,
}) => {
  const { t } = useTranslation(['detail', 'types']);
  const hasContext = !!contextSrc && !!contextState && contextState.status !== 'idle';
  const contextRow = hasContext && contextState!.status === 'resolved' ? (
    <div className="ref-pill-context">
      <span className="ref-pill-context-label">{t('detail:refPill.sourceLabel')}</span>{' '}
      <Link className="ref-pill-context-source" to={`/dashboard/${encodeURIComponent(contextSrc!)}`}>
        {contextState!.title ?? contextSrc}
      </Link>
      {contextState!.message && (
        <>
          <span className="ref-pill-sep"> — </span>
          <span className="ref-pill-context-message">{contextState!.message}</span>
        </>
      )}
    </div>
  ) : null;

  // Kontext ohne Objekt-Ref (z.B. Layout-Level-Findings): eigenständige Pill
  // nur mit der Quelle-Zeile — der Origin-Block entfällt mangels `ref`.
  if (state.status === 'idle') {
    if (!contextRow) return null;
    return (
      <div className="ref-pill ref-pill--resolved ref-pill--stacked" role="status" aria-live="polite">
        {contextRow}
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
  }

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
  // A findings context keeps the pill visible regardless: the source line is
  // the answer to "why am I here", matches or not.
  if (count === 0 && !contextRow) return null;
  const o = state.origin;
  return (
    <div className={`ref-pill ref-pill--resolved${contextRow ? ' ref-pill--stacked' : ''}`} role="status" aria-live="polite">
      <div className="ref-pill-main">
        <span className="ref-pill-label">
          {t('detail:refPill.label')} <span className="ref-pill-type">{t(`types:objectTypes.${o.type}`, { defaultValue: o.type })}</span>
          <span className="ref-pill-sep"> · </span>
          <span className="ref-pill-name" title={o.name}>{formatObjectDisplayName(o.type, o.name)}</span>
          {o.file && (
            <span className="ref-pill-file"> ({o.file})</span>
          )}
        </span>
        {count > 0 && (
          <span className="ref-pill-count">
            {t('detail:refPill.highlightsCount', { count })}
          </span>
        )}
      </div>
      {contextRow}
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
