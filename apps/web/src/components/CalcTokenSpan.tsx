import React from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CalcToken } from '../script/calcTokens';
import { FunctionTokenSpan } from './FunctionTokenSpan';
import {
  useHighlightRefUuids,
  isUuidHighlighted,
} from '../script/highlightContext';
import { buildObjectPath } from '../lib/navigation';
import { useCurrentFile } from '../lib/currentFileContext';

/**
 * FileMaker speichert Zeilenumbrüche in Calc-Tokens als CR (\r). HTML/CSS
 * `white-space: pre-wrap` interpretiert nur LF (\n) als Umbruch — CR wird
 * still ignoriert. Wir normalisieren beim Rendern jeden Token-Content, damit
 * mehrzeilige Formeln (z.B. _Filter_ValidUTF) ihre Struktur behalten.
 */
export function normalizeCalcWhitespace(s: string): string {
  // \r\n → \n und \r → \n (FileMaker-CR und Windows-CRLF vereinheitlichen)
  return s.replace(/\r\n?/g, '\n');
}

/**
 * Gemeinsame Token-Darstellung für Calc-Formeln (CustomFunction, Field-
 * Calculation, etc.). Wählt pro Token-Typ den passenden Span und unterstützt
 * Cross-Reference-Highlight via HighlightRefContext.
 *
 *   - function       → FunctionTokenSpan mit Reference-DB-Tooltip
 *   - customFunction → Link auf /object/<uuid> (falls UUID vorhanden)
 *   - variable       → Variable-Span mit scope-Marker
 *   - field          → Field-Span (Link wenn UUID vorhanden)
 *   - comment        → Kommentar-Span (kursiv, gedimmt)
 *   - pluginFunction → Plugin-Span mit subFunction-Tooltip
 *   - text           → roher Text
 */
export const CalcTokenSpan: React.FC<{ token: CalcToken }> = ({ token }) => {
  const text = normalizeCalcWhitespace(token.content);
  const highlightSet = useHighlightRefUuids();
  const { uuid: currentUuid } = useParams<{ uuid: string }>();
  // Klon-Disambiguierung: CustomFunctions sind in FileMaker datei-lokal — eine
  // in dieser Calc referenzierte CF liegt zwingend in derselben Datei wie das
  // aktuelle Objekt. `currentFile` ist daher die korrekte Zieldatei (kein 404-
  // Risiko). Felder/Plugins können hingegen cross-file sein → kein file (Downgrade).
  const currentFile = useCurrentFile();
  const highlighted = isUuidHighlighted(highlightSet, token.uuid ?? null);
  const hlClass = highlighted ? ' fm-ref--highlighted' : '';

  switch (token.type) {
    case 'function':
      return <FunctionTokenSpan token={token} text={text} />;
    case 'customFunction':
      if (token.uuid) {
        return (
          <Link
            to={buildObjectPath(token.uuid, currentUuid ?? null, currentFile)}
            className={`fm-ref fm-ref--customFunction${hlClass}`}
            title={`Custom Function: ${text}`}
            data-ref-type="customFunction"
          >
            {text}
          </Link>
        );
      }
      return (
        <span className={`fm-ref fm-ref--customFunction${hlClass}`} data-ref-type="customFunction">
          {text}
        </span>
      );
    case 'pluginFunction':
      // Cross-Navigation zur PluginFunction-Detail-Seite.
      // Popover (Plugin-Doku) wird vom übergeordneten CustomFunctionViewer/
      // FieldViewer nicht über CalcTokenSpan dargestellt — wir bleiben hier
      // bei einem einfachen Link-Wrapper.
      if (token.uuid) {
        return (
          <Link
            to={buildObjectPath(token.uuid, currentUuid ?? null)}
            className={`fm-ref fm-ref--pluginFunction fm-ref-link${hlClass}`}
            data-ref-type="pluginFunction"
            title={`${token.subFunction ? `${text}: ${token.subFunction}` : text}  (Klick → Detail-Seite)`}
          >
            {text}
          </Link>
        );
      }
      return (
        <span
          className={`fm-ref fm-ref--pluginFunction${hlClass}`}
          data-ref-type="pluginFunction"
          title={token.subFunction ? `${text}: ${token.subFunction}` : text}
        >
          {text}
        </span>
      );
    case 'variable':
      return (
        <span
          className={`fm-ref fm-ref--variable${hlClass}`}
          data-ref-type="variable"
          title={`Variable (${token.scope || 'local'})`}
        >
          {text}
        </span>
      );
    case 'field':
      if (token.uuid) {
        return (
          <Link
            to={buildObjectPath(token.uuid, currentUuid ?? null)}
            className={`fm-ref fm-ref--field${hlClass}`}
            data-ref-type="field"
            title={`Field: ${text}`}
          >
            {text}
          </Link>
        );
      }
      return (
        <span className={`fm-ref fm-ref--field${hlClass}`} data-ref-type="field">
          {text}
        </span>
      );
    case 'comment':
      return <span className="fm-customfunction-comment">{text}</span>;
    case 'text':
    default:
      return <span className="fm-customfunction-text">{text}</span>;
  }
};
