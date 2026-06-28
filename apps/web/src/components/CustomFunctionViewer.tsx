import React, { useEffect, useMemo, useRef } from 'react';
import type { CustomFunctionTokens } from '../script/calcTokens';
import { HighlightRefContext } from '../script/highlightContext';
import { CalcTokenSpan } from './CalcTokenSpan';
import './CustomFunctionViewer.css';

interface CustomFunctionViewerProps {
  data: CustomFunctionTokens;
  /** Cross-Reference Highlight: Token-Match auf Tokens mit `uuid ∈ Set`. */
  highlightRefUuids?: Set<string> | null;
  /** Reicht die gezählten Highlight-Treffer hoch zur RefOriginPill. */
  onLiveMatchCount?: (count: number) => void;
}

/**
 * Renderer für die Token-Sequenz einer CustomFunction. Pro Token wird
 * abhängig vom Type ein passender Span erzeugt:
 *
 *   - function       → FunctionTokenSpan mit Reference-DB-Tooltip
 *   - customFunction → Link auf /object/<uuid> (falls UUID vorhanden)
 *   - variable       → ScriptVariable-Style Span mit scope-Marker
 *   - field          → Field-Span (UUID-Link wenn vorhanden)
 *   - comment        → Kommentar-Span (kursiv, gedimmt)
 *   - pluginFunction → Plugin-Span (kein Tooltip — Plugins via /api/plugin-docs)
 *   - text           → roher Text
 *
 * Whitespace bleibt erhalten (white-space: pre-wrap), damit Formel-Einrückungen
 * und Zeilenumbrüche sichtbar werden.
 */
export const CustomFunctionViewer: React.FC<CustomFunctionViewerProps> = ({ data, highlightRefUuids, onLiveMatchCount }) => {
  // Erstes markiertes Token in den Sichtbereich scrollen (analog ScriptViewer).
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightSig = highlightRefUuids ? Array.from(highlightRefUuids).sort().join(',') : '';
  useEffect(() => {
    if (!highlightSig || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector('.fm-ref--highlighted');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightSig]);

  // Live-Match-Count: zählt Calc-Tokens mit UUID im Highlight-Set. Für die
  // RefOriginPill — der server-seitige back_references-Count liefert für
  // Token-Container nur einen Self-Link-Repräsentanten, nicht die tatsächliche
  // Anzahl Vorkommen in der Formel (analog ScriptViewer).
  const liveMatchCount = useMemo(() => {
    if (!highlightRefUuids || highlightRefUuids.size === 0) return 0;
    let n = 0;
    for (const tok of data.tokens) {
      if (tok.uuid && highlightRefUuids.has(tok.uuid)) n++;
    }
    return n;
  }, [data.tokens, highlightRefUuids]);
  useEffect(() => {
    onLiveMatchCount?.(liveMatchCount);
  }, [liveMatchCount, onLiveMatchCount]);

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <div ref={rootRef} className="fm-customfunction" aria-label="CustomFunction-Definition">
        <div className="fm-customfunction-header">
          <h2 className="type-detail-heading">
            {data.object.name}
            {Array.isArray(data.parameters) && data.parameters.length > 0 && (
              <span className="fm-customfunction-params">
                ( {data.parameters.join(' ; ')} )
              </span>
            )}
          </h2>
          <span className="fm-customfunction-meta">{data.object.file}</span>
        </div>
        <pre className="fm-customfunction-body">
          <code>
            {data.tokens.map((tok, idx) => (
              <CalcTokenSpan key={idx} token={tok} />
            ))}
          </code>
        </pre>
      </div>
    </HighlightRefContext.Provider>
  );
};
