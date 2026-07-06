import { API_BASE } from '../config/apiBase';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ScriptRef } from '../script/types';
import { fetchPluginDoc, type PluginDoc } from '../script/pluginDocsApi';
import { sanitizePluginHtml } from '../script/sanitize';
import { useHighlightRefUuids, isUuidHighlighted, useScriptSearchPredicate } from '../script/highlightContext';
import { buildObjectPath } from '../lib/navigation';

interface RefSpanProps {
  reference: ScriptRef;
  text: string;
}

/**
 * Engine-Funktion-Token mit Reference-DB-Popover.
 * Analog zu ScriptStepSpan: enriched → eigener Popover, sonst Browser-Tooltip.
 *
 * Mit synthetischer ObjectCatalog-UUID
 * wird das Token zusätzlich klickbar — Navigation auf die BuiltinFunction-Detail.
 */
const FunctionRefSpan: React.FC<RefSpanProps & { className: string; navPath: string | null }> = ({
  reference,
  text,
  className,
  navPath,
}) => {
  const { t } = useTranslation(['detail']);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const isEnriched = typeof reference.functionId === 'number';

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

  const apiBase = (API_BASE).replace(/\/+$/, '');
  const helpHref = reference.functionLocalHelpUrl
    ? `${apiBase}${reference.functionLocalHelpUrl}`
    : reference.functionHelpUrl;

  const clickable = !!navPath;
  const handleClick = () => {
    if (navPath) navigate(navPath);
  };

  return (
    <span
      className={className + (clickable ? ' fm-ref-link' : '')}
      data-ref-type="function"
      title={isEnriched ? undefined : (clickable ? `${reference.name} (Klick → Detail-Seite)` : reference.name)}
      onMouseEnter={startHover}
      onMouseLeave={cancelHover}
      onClick={clickable ? handleClick : undefined}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') handleClick(); } : undefined}
    >
      {text}
      {open && isEnriched && (
        <span
          className="fm-stepname-popover"
          role="tooltip"
          onMouseEnter={() => {
            if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={cancelHover}
        >
          <span className="fm-stepname-popover-header">
            <strong>
              {reference.functionDisplayName || reference.functionCanonical}
              {reference.functionSubParameter && ` ( ${reference.functionSubParameter} )`}
            </strong>
            {reference.functionReturnType && (
              <span className="fm-stepname-popover-canonical"> → {reference.functionReturnType}</span>
            )}
          </span>
          {reference.functionSignature && (
            <code className="fm-stepname-popover-canonical" style={{ display: 'block', padding: '0.2rem 0.4rem' }}>
              {reference.functionSignature}
            </code>
          )}
          {reference.functionPurpose && (
            <span className="fm-stepname-popover-purpose">{reference.functionPurpose}</span>
          )}
          {helpHref && (
            <a
              className="fm-stepname-popover-link"
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {reference.functionLocalHelpUrl ? t('detail:helpLinks.openLocalClarisHelp') : t('detail:helpLinks.openOnlineClarisHelp')}
            </a>
          )}
          {reference.functionCanonical && reference.functionDisplayName
            && reference.functionCanonical !== reference.functionDisplayName && (
            <span className="fm-stepname-popover-canonical">
              {t('detail:helpLinks.canonical')} {reference.functionCanonical}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

/**
 * Build the popover/title string for a script-ref. Receives the i18n `t`
 * function so the label fragments ("Table:", "Scope:", "Usage:", "File:",
 * "cross-file") follow the active UI language.
 */
function buildTitle(
  ref: ScriptRef,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  parts.push(ref.type);
  if (ref.subFunction) parts.push(`${ref.name}: ${ref.subFunction}`);
  else parts.push(ref.name);
  if (ref.table) parts.push(`${t('detail:refTitle.table')} ${ref.table}`);
  if (ref.baseTable && ref.baseTable !== ref.table) parts.push(`${t('detail:refTitle.baseTable')} ${ref.baseTable}`);
  if (ref.scope) parts.push(`${t('detail:refTitle.scope')} ${ref.scope}`);
  if (ref.usage) parts.push(`${t('detail:refTitle.usage')} ${ref.usage}`);
  if (ref.file) parts.push(`${t('detail:refTitle.file')} ${ref.file}`);
  if (ref.crossFile) parts.push(t('detail:refTitle.crossFile'));
  return parts.join(' • ');
}

function refTargetPath(ref: ScriptRef): string | null {
  if (!ref.uuid) return null;
  switch (ref.type) {
    case 'field':
    case 'script':
    case 'layout':
    case 'customFunction':
    case 'valueList':
    case 'tableOccurrence':
      return `/object/${ref.uuid}`;
    default:
      return null;
  }
}

/**
 * Pseudo-Type-Pfad für `function` (→ BuiltinFunction) und `pluginFunction`
 * (→ PluginFunction) — Cross-Navigation aus der Calc-/Script-Token-Ansicht
 * zur jeweiligen Detail-Seite.
 * Liefert null, wenn keine synthetische UUID an der Ref hängt (z.B. Boolean-
 * Operatoren, die wir bewusst uuidlos lassen).
 */
function pseudoTypeTargetPath(ref: ScriptRef): string | null {
  if (!ref.uuid) return null;
  if (ref.type === 'function' || ref.type === 'pluginFunction') {
    return `/object/${ref.uuid}`;
  }
  return null;
}

export const PluginRefSpan: React.FC<RefSpanProps & { className: string; title: string; navPath: string | null }> = ({
  reference,
  text,
  className,
  title,
  navPath,
}) => {
  const { t } = useTranslation(['detail']);
  const navigate = useNavigate();
  const { uuid: currentUuid } = useParams<{ uuid: string }>();
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<PluginDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  // Popover wird per Portal an <body> gerendert (fixed positioniert), damit es
  // NICHT vom überlaufenden Script-/Detail-Container abgeschnitten wird, wenn die
  // Viewbox auf 1 Zeile kollabiert. Position wird beim Öffnen aus dem Anker-Rect
  // berechnet — mit Flip nach oben bei wenig Platz unten und horizontalem Clamp.
  const [pos, setPos] = useState<{ left: number; top: number | 'auto'; bottom: number | 'auto' } | null>(null);

  const subFn = reference.subFunction;
  const source = 'mbs'; // aktuell nur MBS unterstützt

  const computePos = () => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const POPOVER_MIN_W = 480;   // vgl. .plugin-doc-popover min-width
    const MARGIN = 8;
    const spaceBelow = vh - r.bottom;
    const spaceAbove = r.top;
    // Horizontal am Anker ausrichten, aber im Viewport halten.
    const left = Math.max(MARGIN, Math.min(r.left, vw - POPOVER_MIN_W - MARGIN));
    // Bevorzugt unterhalb; nur nach oben klappen, wenn unten wenig und oben mehr Platz.
    if (spaceBelow < 240 && spaceAbove > spaceBelow) {
      setPos({ left, top: 'auto', bottom: vh - r.top + 4 });
    } else {
      setPos({ left, top: r.bottom + 4, bottom: 'auto' });
    }
  };

  const startHover = () => {
    if (!subFn) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      computePos();
      setOpen(true);
      if (!doc && !loading) {
        setLoading(true);
        fetchPluginDoc(source, subFn, 'short')
          .then(d => {
            setDoc(d);
            setError(null);
          })
          .catch(err => setError(err instanceof Error ? err.message : 'Fehler'))
          .finally(() => setLoading(false));
      }
    }, 250);
  };

  const cancelHover = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    // Schließen leicht verzögern, damit der Cursor über den (4px-)Spalt ins
    // portalierte Popover wandern kann. Der Timer MUSS abbrechbar sein: da das
    // Popover nun kein Kind des Ankers mehr ist, feuert dessen onMouseLeave beim
    // Übergang — ohne cancelbaren Timer würde das Popover unter dem Cursor schließen.
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  // Cursor ist ins Popover gewandert → geplantes Schließen abbrechen.
  const keepOpen = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const clickable = !!navPath;
  const handleClick = () => {
    if (navPath) navigate(navPath);
  };

  return (
    <span
      ref={containerRef}
      className={className + (clickable ? ' fm-ref-link' : '')}
      title={clickable ? `${title}  (Klick → Detail-Seite)` : title}
      onMouseEnter={startHover}
      onMouseLeave={cancelHover}
      data-ref-type={reference.type}
      onClick={clickable ? handleClick : undefined}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') handleClick(); } : undefined}
    >
      {text}
      {open && subFn && pos && createPortal(
        <span
          className="plugin-doc-popover plugin-doc-popover--portal"
          role="tooltip"
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, zIndex: 1000 }}
          onMouseEnter={keepOpen}
          onMouseLeave={cancelHover}
        >
          {loading && <span className="plugin-doc-loading">Lade Doku…</span>}
          {error && <span className="plugin-doc-error">{error}</span>}
          {doc && doc.found && (
            <span className="plugin-doc-content">
              <span className="plugin-doc-header">
                <strong>{doc.metadata?.name}</strong>
                {doc.metadata?.component && (
                  doc.metadata.componentUuid ? (
                    <Link
                      to={buildObjectPath(doc.metadata.componentUuid, currentUuid ?? null)}
                      className="plugin-doc-component plugin-doc-component-link"
                      title={`Zur Komponente MBS::${doc.metadata.component} navigieren`}
                    >
                      {' · '}{doc.metadata.component}
                    </Link>
                  ) : (
                    <span className="plugin-doc-component"> · {doc.metadata.component}</span>
                  )
                )}
                {doc.metadata?.version && (
                  <span className="plugin-doc-version"> · v{doc.metadata.version}</span>
                )}
              </span>
              {doc.metadata?.signature && (
                <code className="plugin-doc-signature">{doc.metadata.signature}</code>
              )}
              {doc.short?.content && (
                <span
                  className="plugin-doc-html"
                  dangerouslySetInnerHTML={{ __html: sanitizePluginHtml(doc.short.content) }}
                />
              )}
              {(() => {
                // Bevorzugt lokal gehostete Doku-Seite (mit Theme-Switcher),
                // Fallback auf externe MBS-Site, wenn subFn fehlt. Konsistent
                // mit dem Function-Hover oben (functionLocalHelpUrl-Logik).
                const apiBase = (API_BASE).replace(/\/+$/, '');
                const localHref = subFn
                  ? `${apiBase}/api/plugin-docs/${encodeURIComponent(source)}/${encodeURIComponent(subFn)}/page`
                  : null;
                const href = localHref || doc.metadata?.url || null;
                if (!href) return null;
                return (
                  <a
                    className="plugin-doc-link"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {localHref ? t('detail:helpLinks.openLocalMbsHelp') : t('detail:helpLinks.openOnlineMbsHelp')}
                  </a>
                );
              })()}
            </span>
          )}
          {doc && !doc.found && <span className="plugin-doc-error">{t('detail:helpLinks.noDocs')}</span>}
        </span>,
        document.body,
      )}
    </span>
  );
};

export const RefSpan: React.FC<RefSpanProps> = ({ reference, text }) => {
  const { t } = useTranslation(['detail']);
  const highlightSet = useHighlightRefUuids();
  const searchPredicate = useScriptSearchPredicate();
  const { uuid: currentUuid } = useParams<{ uuid: string }>();

  // Highlight greift, wenn die Ref-UUID im Set ist (Token-Match). Fallback auf
  // Namensvergleich, wenn die UUID fehlt — z.B. bei Variablen ohne ObjectCatalog-
  // Eintrag (Origin-Set ist UUID-basiert, daher hier ausschließlich uuid-match).
  const highlighted = isUuidHighlighted(highlightSet, reference.uuid ?? null);
  const searchMatch = searchPredicate ? searchPredicate(reference) : false;

  // Klon-Disambiguierung: `reference.file` ist die Zieldatei (Backend setzt sie
  // für intra- UND cross-file-Refs aus ObjectHomes.Home_File). Fehlt sie →
  // Graceful Downgrade.
  const path = reference.uuid
    ? buildObjectPath(reference.uuid, currentUuid ?? null, reference.file ?? null)
    : refTargetPath(reference);
  const baseClass = `fm-ref fm-ref--${reference.type}`;
  const crossFile = reference.crossFile ? ' fm-ref--cross-file' : '';
  const hl = highlighted ? ' fm-ref--highlighted' : '';
  const sm = searchMatch ? ' fm-ref--search-match' : '';
  const className = `${baseClass}${crossFile}${hl}${sm}`;
  const title = buildTitle(reference, t);
  // Helper: refTargetPath erzeugt nur einen Pfad, wenn die UUID einem unterstützten
  // Type angehört — wenn buildObjectPath direkt verwendet wird, wäre für Plugin/
  // Function-Types fälschlich ein Link erzeugt. Daher explizit prüfen.
  const pathIsClickable = path && refTargetPath(reference);

  if (pathIsClickable) {
    return (
      <Link to={path!} className={className} title={title} data-ref-type={reference.type}>
        {text}
      </Link>
    );
  }
  // Pseudo-Type-Cross-Navigation: function/pluginFunction haben jetzt
  // eine synthetische ObjectCatalog-UUID und sind klickbar.
  const pseudoNavPath = pseudoTypeTargetPath(reference);
  const pseudoNavPathWithRef = pseudoNavPath
    ? buildObjectPath(reference.uuid!, currentUuid ?? null)
    : null;
  if (reference.type === 'pluginFunction') {
    return (
      <PluginRefSpan
        reference={reference}
        text={text}
        className={className}
        title={title}
        navPath={pseudoNavPathWithRef}
      />
    );
  }
  if (reference.type === 'function') {
    return (
      <FunctionRefSpan
        reference={reference}
        text={text}
        className={className}
        navPath={pseudoNavPathWithRef}
      />
    );
  }
  return (
    <span className={className} title={title} data-ref-type={reference.type}>
      {text}
    </span>
  );
};
