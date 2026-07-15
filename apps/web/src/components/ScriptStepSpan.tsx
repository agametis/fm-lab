import { API_BASE } from '../config/apiBase';
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ScriptLineToken } from '../script/types';
import { buildObjectPath } from '../lib/navigation';
import { useHoverPopover } from './useHoverPopover';
import { PopoverPortal } from './PopoverPortal';

interface ScriptStepSpanProps {
  /** Stepname-Text wie er im Script-Text erscheint (z.B. "Adjust Window"). */
  text: string;
  /** Vollständige Script-Line (für Step-ID und Reference-DB-Felder). */
  line: ScriptLineToken;
}

/**
 * Renderer für den Step-Namen am Anfang einer Script-Zeile mit Reference-DB-
 * Anreicherung. Hover zeigt einen Popover mit lokalisiertem Namen,
 * Beschreibung und Link zur lokalen Claris-Hilfe.
 *
 * Tooltip-Strategie (analog FunctionTokenSpan):
 *   - enriched (stepDisplayName vorhanden) → eigener Popover, KEIN `title`-Attribut
 *   - nicht enriched → Browser-Tooltip als Fallback mit dem Step-Text
 */
export const ScriptStepSpan: React.FC<ScriptStepSpanProps> = ({ text, line }) => {
  const { t } = useTranslation(['detail']);
  const isEnriched = !!line.stepDisplayName;
  const { uuid: currentScriptUuid } = useParams<{ uuid: string }>();

  // Portaliertes Hover-Popover (fixed, mit Flip/Clamp) — verhindert das
  // Abschneiden am unteren Rand kurzer Script-Panels. Anker ist der äußere span.
  const { anchorRef, open, pos, startHover, cancelHover, keepOpen, close } =
    useHoverPopover<HTMLSpanElement>({ minWidth: 320, enabled: isEnriched });

  // Cross-Navigation: Klick auf den Step-Namen führt zur ScriptStepType-
  // Detail-Seite. Hover-Popover
  // mit Reference-DB-Doku bleibt unverändert; der Link greift erst beim Klick.
  const stepTypePath = line.stepTypeUuid
    ? buildObjectPath(line.stepTypeUuid, currentScriptUuid ?? null)
    : null;

  const apiBase = (API_BASE).replace(/\/+$/, '');
  const helpHref = line.stepLocalHelpUrl
    ? `${apiBase}${line.stepLocalHelpUrl}`
    : line.stepHelpUrl;

  // Inner: Text-Knoten (entweder klickbarer Link oder reiner Text)
  const inner = stepTypePath ? (
    <Link
      to={stepTypePath}
      className="fm-stepname-link"
      title={(isEnriched
        ? t('detail:scriptStepLink.navigateEnriched', { name: line.stepName ?? text })
        : t('detail:scriptStepLink.navigateFallback', { name: text })) as string}
      // Klick auf den Link soll das Popover sofort schließen.
      onClick={close}
    >
      {text}
    </Link>
  ) : (
    <>{text}</>
  );

  return (
    <span
      ref={anchorRef}
      className="fm-stepname"
      data-step-id={line.stepId}
      title={isEnriched || stepTypePath ? undefined : text}
      onMouseEnter={startHover}
      onMouseLeave={cancelHover}
    >
      {inner}
      {open && isEnriched && pos && (
        <PopoverPortal
          pos={pos}
          className="fm-stepname-popover fm-stepname-popover--portal"
          onMouseEnter={keepOpen}
          onMouseLeave={cancelHover}
        >
          <span className="fm-stepname-popover-header">
            <strong>{line.stepDisplayName}</strong>
            {line.stepName && line.stepName !== line.stepDisplayName && (
              <span className="fm-stepname-popover-canonical"> · {line.stepName}</span>
            )}
          </span>
          {line.stepDescription && (
            <span className="fm-stepname-popover-purpose">{line.stepDescription}</span>
          )}
          {helpHref && (
            <a
              className="fm-stepname-popover-link"
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {line.stepLocalHelpUrl ? t('detail:helpLinks.openLocalClarisHelp') : t('detail:helpLinks.openOnlineClarisHelp')}
            </a>
          )}
        </PopoverPortal>
      )}
    </span>
  );
};
