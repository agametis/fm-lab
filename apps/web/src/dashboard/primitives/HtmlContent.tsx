import { useCallback, useMemo } from 'react';
import type { PrimitiveProps } from '../types';
import { API_BASE } from '../../config/apiBase';
import '../../docs/DocsEntryView.css';

/**
 * HtmlContent — rendert serverseitig sanitisiertes HTML (z.B. eine über die
 * docs-content-Pipeline gerenderte Doc-Seite) aus einem Feld der gebundenen
 * Row. Verwendet die `.docs-content`-Typografie der DocsEntryView.
 *
 * Props:
 *   - field: Row-Feld mit dem HTML-String (default: "content_html")
 *
 * Link-Handling wie in der DocsEntryView: App-interne Pfade (`/docs/...`)
 * navigieren per SPA-Router; externe Protokolle, `/api/`-Assets und
 * In-Document-Anchors behalten das Browser-Default-Verhalten.
 *
 * Sicherheit: Der Inhalt MUSS aus der serverseitigen Sanitize-Pipeline
 * stammen (rest-api/src/services/docs-content.js) — dieses Primitive
 * sanitisiert nicht selbst.
 */
export function HtmlContent({ node, row, navigate }: PrimitiveProps) {
  const props = node.props ?? {};
  const field = (props.field as string) ?? 'content_html';
  const raw = row ? String(row[field] ?? '') : '';

  // Backend rendert content_html mit absoluten /api/... Pfaden. Im Vite-Dev-
  // Setup hängt /api am falschen Port → mit API_BASE prefixen (Produktiv-
  // Setup: API_BASE ist leer, Ersetzung ist ein No-op).
  const html = useMemo(() => {
    if (!raw) return '';
    return API_BASE ? raw.replace(/="\/api\//g, `="${API_BASE}/api/`) : raw;
  }, [raw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (/^(?:https?:|mailto:|tel:|fmp:|fmps:)/i.test(href)) return;
      if (href.startsWith('/api/') || href.startsWith('#')) return;
      if (href.startsWith('/')) {
        e.preventDefault();
        navigate(href);
      }
    },
    [navigate],
  );

  if (!html) return null;

  return (
    <div
      className="docs-content"
      onClick={handleClick}
      // Inhalt ist serverseitig sanitized (siehe rest-api/src/services/docs-content.js).
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
