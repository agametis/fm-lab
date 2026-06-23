import { API_BASE } from '../config/apiBase';
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CalcToken } from '../script/calcTokens';
import { buildObjectPath } from '../lib/navigation';

interface FunctionTokenSpanProps {
  token: CalcToken;
  /** Optional: bereits normalisierter Anzeige-Text (CR → LF). */
  text?: string;
}

/**
 * Renderer für Calc-Tokens vom Type `function` mit Reference-DB-Anreicherung
 *. Zeigt einen Hover-Tooltip mit lokalisiertem Namen, Signatur,
 * Zweck und einem Link zur lokalen Claris-Hilfe.
 *
 * Tooltip-Strategie:
 *   - Token enriched (functionId vorhanden) → eigener HTML-Popover, KEIN
 *     HTML `title`-Attribut (sonst überlagern sich Browser-Tooltip + Popover).
 *   - Token nicht enriched (Reference-DB nicht attached o.ä.) → Browser-
 *     Tooltip als Fallback mit dem Token-Content selbst.
 */
export const FunctionTokenSpan: React.FC<FunctionTokenSpanProps> = ({ token, text }) => {
  const { t } = useTranslation(['detail']);
  const navigate = useNavigate();
  const { uuid: currentUuid } = useParams<{ uuid: string }>();
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const isEnriched = typeof token.functionId === 'number';
  const displayText = text ?? token.content;

  // Cross-Navigation zur BuiltinFunction-Detail-Seite
  // wenn das Backend eine synthetische UUID am Token mitliefert. Popover bleibt
  // unverändert — onClick und Hover existieren parallel.
  const navPath = token.uuid
    ? buildObjectPath(token.uuid, currentUuid ?? null)
    : null;
  const handleClick = () => {
    if (navPath) navigate(navPath);
  };

  const startHover = () => {
    if (!isEnriched) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(true), 250);
  };

  const cancelHover = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);

  // Help-URL: bevorzugt lokal (rendert in unserer API), Fallback Claris extern.
  // Lokal liegt als /api/reference/help/...; im Browser muss daraus ein
  // absoluter Pfad zur API werden.
  const apiBase = (API_BASE).replace(/\/+$/, '');
  const helpHref = token.functionLocalHelpUrl
    ? `${apiBase}${token.functionLocalHelpUrl}`
    : token.functionHelpUrl;

  return (
    <span
      className={`fm-ref fm-ref--function${navPath ? ' fm-ref-link' : ''}`}
      data-ref-type="function"
      // Browser-Tooltip nur als Fallback, wenn keine Reference-Daten vorliegen.
      // Bei enriched-Token zeigt der eigene Popover die vollständigen Infos.
      title={isEnriched ? undefined : (navPath ? `${token.content} (Klick → Detail-Seite)` : token.content)}
      onMouseEnter={startHover}
      onMouseLeave={cancelHover}
      onClick={navPath ? handleClick : undefined}
      role={navPath ? 'link' : undefined}
      tabIndex={navPath ? 0 : undefined}
      onKeyDown={navPath ? (e) => { if (e.key === 'Enter') handleClick(); } : undefined}
    >
      {displayText}
      {open && isEnriched && (
        <span
          className="fm-function-popover"
          role="tooltip"
          onMouseEnter={() => {
            if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={cancelHover}
        >
          <span className="fm-function-popover-header">
            <strong>
              {token.functionDisplayName || token.functionCanonical}
              {token.functionSubParameter && ` ( ${token.functionSubParameter} )`}
            </strong>
            {token.functionReturnType && (
              <span className="fm-function-popover-return"> → {token.functionReturnType}</span>
            )}
          </span>
          {token.functionSignature && (
            <code className="fm-function-popover-signature">{token.functionSignature}</code>
          )}
          {token.functionPurpose && (
            <span className="fm-function-popover-purpose">{token.functionPurpose}</span>
          )}
          {helpHref && (
            <a
              className="fm-function-popover-link"
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {token.functionLocalHelpUrl ? t('detail:helpLinks.openLocalClarisHelp') : t('detail:helpLinks.openOnlineClarisHelp')}
            </a>
          )}
          {token.functionCanonical && token.functionDisplayName
            && token.functionCanonical !== token.functionDisplayName && (
            <span className="fm-function-popover-canonical">
              {t('detail:helpLinks.canonical')} <code>{token.functionCanonical}</code>
            </span>
          )}
        </span>
      )}
    </span>
  );
};
