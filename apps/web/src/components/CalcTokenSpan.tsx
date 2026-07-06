import React from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CalcToken } from '../script/calcTokens';
import type { ScriptRef } from '../script/types';
import { FunctionTokenSpan } from './FunctionTokenSpan';
import { PluginRefSpan } from './RefSpan';
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
      return <FunctionTokenSpan token={token} text={text} highlighted={highlighted} />;
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
    case 'pluginFunction': {
      // Parität zur Script-Ansicht: dieselbe PluginRefSpan-Komponente wie in
      // RefSpan (Subfunktions-Doku-Popover + Komponenten-Link + Navigation zur
      // PluginFunction-Detail-Seite). Der MBS-Container bleibt der sichtbare
      // Link-Text, das Popover löst die eigentliche Subfunktion (z.B. CURL.New)
      // auf. Wir mappen den CalcToken auf einen minimalen ScriptRef.
      const reference: ScriptRef = {
        type: 'pluginFunction',
        name: token.content,
        uuid: token.uuid,
        subFunction: token.subFunction,
      };
      const navPath = token.uuid
        ? buildObjectPath(token.uuid, currentUuid ?? null)
        : null;
      // Nach dem Subfunktions-Hoisting (siehe hoistPluginSubfunctionLinks) ist
      // der sichtbare Text bereits die Subfunktion → keine redundante `X: X`-Tooltip.
      const title = token.subFunction && token.subFunction !== text
        ? `${text}: ${token.subFunction}`
        : text;
      return (
        <PluginRefSpan
          reference={reference}
          text={text}
          className={`fm-ref fm-ref--pluginFunction${hlClass}`}
          title={title}
          navPath={navPath}
        />
      );
    }
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

/**
 * Verschiebt bei Container-Plugin-Aufrufen (MBS) den Link vom `MBS`-Container auf
 * den fachlichen Subfunktions-Namen — analog zur Script-Ansicht (tokenize.ts
 * `refMatchText`), die den Subfunktions-String im Text unterstreicht, nicht `MBS`.
 *
 * Die Calc-Token-API liefert `MBS` als eigenes pluginFunction-Token, gefolgt von
 * einem Text-Token, das den Subfunktions-Namen als String-Argument enthält
 * (`( "CURL.New" ; … )`). Wir demoten `MBS` zu Klartext und heben den
 * Subfunktions-Namen (mit UUID + Popover-Trigger) als verlinktes pluginFunction-
 * Token in den Folge-Text. Findet sich der Subfunktions-Name nicht im direkten
 * Folge-Token (oder fehlt UUID/subFunction), bleibt das Token unverändert
 * (Fallback: `MBS` bleibt der Link).
 */
export function hoistPluginSubfunctionLinks(tokens: CalcToken[]): CalcToken[] {
  const out: CalcToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (
      t.type === 'pluginFunction' &&
      t.uuid &&
      t.subFunction &&
      next &&
      next.type === 'text'
    ) {
      const idx = next.content.indexOf(t.subFunction);
      if (idx >= 0) {
        out.push({ type: 'text', content: t.content }); // 'MBS' → Klartext
        const prefix = next.content.slice(0, idx);
        const suffix = next.content.slice(idx + t.subFunction.length);
        if (prefix) out.push({ type: 'text', content: prefix });
        out.push({ ...t, content: t.subFunction }); // verlinkter Subfunktions-Name
        if (suffix) out.push({ type: 'text', content: suffix });
        i++; // Folge-Text-Token konsumiert
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/**
 * Rendert eine Calc-Token-Liste mit vorgeschaltetem Subfunktions-Hoisting.
 * Gemeinsame Nutzung durch CustomFunction-/Field-/CustomMenu-/PrivilegeSet-Viewer,
 * damit MBS-Aufrufe überall wie in der Script-Ansicht dargestellt werden.
 */
export const CalcTokenList: React.FC<{ tokens: CalcToken[] }> = ({ tokens }) => (
  <>
    {hoistPluginSubfunctionLinks(tokens).map((tok, idx) => (
      <CalcTokenSpan key={idx} token={tok} />
    ))}
  </>
);
