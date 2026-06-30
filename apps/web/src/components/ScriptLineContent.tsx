import React from 'react';
import type { Piece } from '../script/tokenize';
import { tokenizeLine } from '../script/tokenize';
import { collapseStepParameterBreaks } from '../script/normalizeText';
import { RefSpan } from './RefSpan';
import { ScriptStepSpan } from './ScriptStepSpan';
import { useScriptLineSearchQuery } from '../script/highlightContext';
import type { ScriptRef, ScriptLineToken } from '../script/types';

interface ScriptLineContentProps {
  text: string;
  refs?: ScriptRef[];
  folded?: boolean;
  /**
   * Vollständige Line — wenn übergeben und Reference-DB-Felder vorhanden,
   * wird der Step-Name am Anfang in einen ScriptStepSpan mit Popover gewrappt.
   */
  line?: ScriptLineToken;
}


/**
 * Hebt Substring-Treffer des Literal-Such-Querys im Klartext-Inhalt eines
 * Nicht-Ref-Pieces hervor (Parameterwerte, Strings, Step-Namen). Spiegelt die
 * Comment-Highlight-Logik in ScriptLine.tsx; `<mark class="fm-line-search-match">`
 * teilt sich die Optik. Ref-Pieces bleiben unangetastet — die werden über das
 * RefSpan-Predicate (orange Outline) markiert.
 */
function highlightLiteral(content: string, query: string | null): React.ReactNode {
  if (!query) return content;
  const lower = content.toLowerCase();
  if (!lower.includes(query)) return content;
  const out: React.ReactNode[] = [];
  let pos = 0;
  let n = 0;
  while (pos < content.length) {
    const idx = lower.indexOf(query, pos);
    if (idx < 0) {
      out.push(content.slice(pos));
      break;
    }
    if (idx > pos) out.push(content.slice(pos, idx));
    out.push(
      <mark key={`lm-${n++}`} className="fm-line-search-match">
        {content.slice(idx, idx + query.length)}
      </mark>,
    );
    pos = idx + query.length;
  }
  return out;
}

function renderPiece(piece: Piece, key: number, query: string | null): React.ReactNode {
  switch (piece.type) {
    case 'ref':
      return <RefSpan key={key} reference={piece.ref} text={piece.content} />;
    case 'string':
      return (
        <span key={key} className="fm-token fm-token--string">
          {highlightLiteral(piece.content, query)}
        </span>
      );
    case 'number':
      return (
        <span key={key} className="fm-token fm-token--number">
          {highlightLiteral(piece.content, query)}
        </span>
      );
    case 'operator':
      return (
        <span key={key} className="fm-token fm-token--operator">
          {highlightLiteral(piece.content, query)}
        </span>
      );
    case 'text':
    default:
      return <span key={key}>{highlightLiteral(piece.content, query)}</span>;
  }
}

/**
 * Falls die Zeile einen bekannten Step-Namen am Anfang hat UND Reference-DB-
 * Anreicherung vorliegt, wird der Step-Name aus dem Text geschnitten und
 * separat als ScriptStepSpan (mit Popover) gerendert. Der Rest geht durch
 * den normalen Tokenizer.
 */
function splitStepName(text: string, line?: ScriptLineToken): { head: string | null; rest: string } {
  if (!line || line.kind !== 'step' || !line.stepName || !line.stepDisplayName) {
    return { head: null, rest: text };
  }
  if (text.startsWith(line.stepName)) {
    return { head: line.stepName, rest: text.slice(line.stepName.length) };
  }
  return { head: null, rest: text };
}

/**
 * Rendert den Text einer Skriptzeile mit allen Refs als gefärbte Spans.
 * Multiline-Text wird aufgeteilt, jede Sub-Zeile bekommt ihre eigene Zeile.
 * Wenn `folded` gesetzt ist und der Text mehrzeilig: nur die erste Sub-Zeile
 * rendern, gefolgt von einem `…`-Marker.
 */
export const ScriptLineContent: React.FC<ScriptLineContentProps> = ({ text, refs, folded, line }) => {
  const lineSearchQuery = useScriptLineSearchQuery();
  const normalized = collapseStepParameterBreaks(text);
  const subLines = normalized.split(/\r\n|\r|\n/);

  // Step-Name nur auf der ersten Sub-Zeile abspalten (Step-Name steht immer
  // am Anfang, danach kommen Parameter ggf. mehrzeilig).
  const renderFirstSubLine = (sub: string) => {
    const { head, rest } = splitStepName(sub, line);
    const pieces = tokenizeLine(rest, refs);
    return (
      <>
        {head && line && <ScriptStepSpan text={head} line={line} />}
        {pieces.map((p, i) => renderPiece(p, i, lineSearchQuery))}
      </>
    );
  };

  if (subLines.length === 1) {
    return renderFirstSubLine(normalized);
  }
  if (folded) {
    return (
      <>
        {renderFirstSubLine(subLines[0])}
        <span className="fm-fold-ellipsis"> …</span>
      </>
    );
  }
  return (
    <>
      {subLines.map((sub, i) => {
        const inner = i === 0
          ? renderFirstSubLine(sub)
          : tokenizeLine(sub, refs).map((p, j) => renderPiece(p, j, lineSearchQuery));
        return (
          <span
            key={i}
            className={`fm-line-sub${i > 0 ? ' fm-line-sub--cont' : ''}`}
          >
            {inner}
          </span>
        );
      })}
    </>
  );
};
