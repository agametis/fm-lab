import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { ScriptTokens, ViewMode, ScriptRef, RefType } from '../script/types';
import { computeFoldRanges, computeHiddenLines, buildFoldStartIndex } from '../script/folding';
import { computeMarginRoleMap } from '../script/marginBar';
import { ScriptLine } from './ScriptLine';
import { ScriptViewerHeader, type FilterStyle } from './ScriptViewerHeader';
import { ScriptSearchFilter } from './ScriptSearchFilter';
import { useUrlState, stringSetCodec } from '../hooks/useUrlState';
import { HighlightRefContext, ScriptSearchContext, ScriptSearchQueryContext, ScriptLineSearchQueryContext, type ScriptSearchPredicate } from '../script/highlightContext';
import './ScriptViewer.css';

interface ScriptViewerProps {
  tokens: ScriptTokens;
  /** Cross-Reference Highlight: Token-Match auf Tokens mit `ref.uuid ∈ Set`. */
  highlightRefUuids?: Set<string> | null;
  /**
   * Wird mit der Anzahl tatsächlich hervorgehobener Token-Vorkommen aufgerufen,
   * wann immer sich Highlight-Set oder Token-Liste ändern. Für die RefOriginPill —
   * der Container-basierte server-Match-Count (1 für Token-Container Self-Link)
   * unterschätzt sonst die echte Anzahl Vorkommen im Script.
   */
  onLiveMatchCount?: (count: number) => void;
  /**
   * Wenn true, werden View-Mode-Header und Such-/Filter-Leiste nicht gerendert.
   * Gedacht für 1-Zeilen-Darstellungen wie den ScriptStep-Detail-View, in dem
   * Folding, View-Modes und Ref-Type-Filter keinen Sinn ergeben.
   */
  hideToolbar?: boolean;
}

const VALID_MODES = new Set<ViewMode>([
  'normal',
  'compact',
  'comments-only',
  'control-only',
  'subscript-only',
  'assignments-only',
  'executive-only',
]);

const VALID_FILTER_STYLES = new Set<FilterStyle>(['dim', 'hide']);

const EMPTY_TYPES: Set<RefType> = new Set();

export const ScriptViewer: React.FC<ScriptViewerProps> = ({ tokens, highlightRefUuids, onLiveMatchCount, hideToolbar }) => {
  const lines = tokens.lines;

  const foldRanges = useMemo(() => computeFoldRanges(lines), [lines]);
  const foldStartIndex = useMemo(() => buildFoldStartIndex(foldRanges), [foldRanges]);
  const marginRoleMap = useMemo(() => computeMarginRoleMap(lines), [lines]);

  const [foldedStarts, setFoldedStarts] = useState<Set<number>>(() => new Set());

  const hiddenLines = useMemo(
    () => computeHiddenLines(foldRanges, foldedStarts),
    [foldRanges, foldedStarts],
  );

  const [modeRaw, setModeRaw] = useUrlState<string>('mode', 'normal');
  const mode: ViewMode = (VALID_MODES.has(modeRaw as ViewMode) ? modeRaw : 'normal') as ViewMode;
  const setMode = useCallback((m: ViewMode) => setModeRaw(m), [setModeRaw]);

  // Default 'dim' (Zusammenhang bleibt sichtbar). 'hide' = klassisches Ausblenden.
  const [filterRaw, setFilterRaw] = useUrlState<string>('filter', 'dim');
  const filterStyle: FilterStyle = (VALID_FILTER_STYLES.has(filterRaw as FilterStyle)
    ? filterRaw
    : 'dim') as FilterStyle;
  const setFilterStyle = useCallback((f: FilterStyle) => setFilterRaw(f), [setFilterRaw]);

  const stepCount = useMemo(
    () => lines.filter(l => l.kind === 'step').length,
    [lines],
  );

  // Suche/Filter-State analog zur Referenzen-Filterleiste (HierarchyTree).
  // Eigene Param-Namen 'sq'/'stypes', damit sie nicht mit den 'q'/'types'-
  // Params der Referenzen-Tab kollidieren — beide Tabs leben in derselben URL.
  // Im stypes-Set lebt zusätzlich der Pseudo-Type 'comment' für die
  // Kommentar-Pill (siehe unten) — wir trennen ihn unten ab.
  const [searchQuery, setSearchQuery] = useUrlState<string>('sq', '');
  const [activeRefTypes, setActiveRefTypes] = useUrlState<Set<string>>(
    'stypes',
    EMPTY_TYPES as Set<string>,
    stringSetCodec,
  );
  const activeTypes = useMemo<Set<RefType>>(() => {
    const out = new Set<RefType>();
    for (const t of activeRefTypes) {
      if (t !== 'comment') out.add(t as RefType);
    }
    return out;
  }, [activeRefTypes]);
  const activeCommentFilter = activeRefTypes.has('comment');

  // Alle Refs des Scripts in einer flachen Liste — Basis für Type-Counts und Match-Logik.
  const allRefs = useMemo<ScriptRef[]>(() => {
    const out: ScriptRef[] = [];
    for (const line of lines) {
      if (line.refs) out.push(...line.refs);
    }
    return out;
  }, [lines]);

  const typeCounts = useMemo(() => {
    const m = new Map<RefType, number>();
    for (const ref of allRefs) {
      m.set(ref.type, (m.get(ref.type) ?? 0) + 1);
    }
    return m;
  }, [allRefs]);

  // Anzahl Comment-Zeilen — fürs Pill-Label.
  const commentCount = useMemo(() => {
    let n = 0;
    for (const line of lines) if (line.kind === 'comment') n++;
    return n;
  }, [lines]);

  const queryLower = searchQuery.trim().toLowerCase();
  const hasQuery = queryLower !== '';
  const hasTypeFilter = activeTypes.size > 0;
  const hasAnyFilter = hasTypeFilter || activeCommentFilter;

  // Scope-Definition: welche Items zählen für matchCount/totalCount?
  // - Ohne Pill: alle Refs UND alle Comments (Default)
  // - Mit Type-Pill: nur Refs der aktiven Types (Comments raus, außer Comment-Pill auch aktiv)
  // - Mit Comment-Pill: Comments im Scope (Refs nur falls auch Type-Pills aktiv)
  // Damit verhält sich die Comment-Pill konsistent zu den Type-Pills.
  const refsInScope = useMemo<ScriptRef[]>(() => {
    if (!hasAnyFilter) return allRefs;
    if (!hasTypeFilter) return []; // nur Comment-Pill aktiv
    return allRefs.filter(r => activeTypes.has(r.type));
  }, [allRefs, activeTypes, hasAnyFilter, hasTypeFilter]);

  const commentsInScope = useMemo(() => {
    const all = lines.filter(l => l.kind === 'comment');
    if (!hasAnyFilter) return all;
    if (activeCommentFilter) return all;
    return [];
  }, [lines, hasAnyFilter, activeCommentFilter]);

  // Predicate: ein Ref bekommt Such-Highlight, wenn er im Scope liegt UND
  // (falls Query gesetzt) der Substring-Match greift. Ohne Query und ohne
  // Pillen kein Highlight (predicate = null).
  const searchPredicate = useMemo<ScriptSearchPredicate | null>(() => {
    if (!hasAnyFilter && !hasQuery) return null;
    return (ref: ScriptRef) => {
      // Scope-Check inline (refsInScope re-filtern wäre teuer pro Token-Render)
      if (hasAnyFilter) {
        if (!hasTypeFilter) return false; // nur Comment-Pill → keine Refs
        if (!activeTypes.has(ref.type)) return false;
      }
      if (hasQuery) {
        const haystack = `${ref.name ?? ''} ${ref.subFunction ?? ''}`.toLowerCase();
        if (!haystack.includes(queryLower)) return false;
      }
      return true;
    };
  }, [activeTypes, queryLower, hasAnyFilter, hasTypeFilter, hasQuery]);

  // Comment-Highlight (Substring im Kommentartext) nur wenn Comments im
  // Scope sind UND ein Query gesetzt ist — ohne Query gibt es nichts zu
  // unterstreichen.
  const commentSearchQuery = (hasQuery && commentsInScope.length > 0) ? queryLower : null;

  // Literal-Text-Suche in Step-Zeilen: matched gegen den vollen Step-Text
  // (Step-Name + Parameter + eingefügte Literale), nicht nur gegen Refs/
  // Kommentare. Schließt die Lücke für Werte, die nicht als Ref tokenisiert
  // sind (z.B. ein langer XML-String im Wert eines Set-Variable-Steps).
  // Spiegelt die globale Suche, die ebenfalls auf dem vollen Step_Text (ILIKE)
  // matcht. Nur im Default-Scope aktiv (keine Pillen) — analog zu Kommentaren,
  // die bei reinen Typ-Pillen aus dem Scope fallen: aktive Pillen verengen die
  // Suche bewusst auf Ref-Typen, da hat Literaltext nichts mehr zu suchen.
  const lineSearchQuery = (hasQuery && !hasAnyFilter) ? queryLower : null;

  // Step-Zeilen im Scope der Literal-Suche (nur ohne aktive Pillen). Basis für
  // die Match-/Total-Zähler unten.
  const stepLinesInScope = useMemo(() => {
    if (hasAnyFilter) return [];
    return lines.filter(l => l.kind === 'step');
  }, [lines, hasAnyFilter]);

  const lineTextMatchCount = useMemo(() => {
    if (!hasQuery) return stepLinesInScope.length;
    let n = 0;
    for (const l of stepLinesInScope) {
      if ((l.text ?? '').toLowerCase().includes(queryLower)) n++;
    }
    return n;
  }, [stepLinesInScope, queryLower, hasQuery]);

  // Match-Counts: innerhalb des Scopes. Ohne Query zählt alles im Scope
  // (konsistent mit Type-Pills, wo die Pill-Aktivierung allein bereits die
  // Refs des Types als "Match" zählt).
  const refMatchCount = useMemo(() => {
    if (!hasQuery) return refsInScope.length;
    return refsInScope.filter(r => {
      const haystack = `${r.name ?? ''} ${r.subFunction ?? ''}`.toLowerCase();
      return haystack.includes(queryLower);
    }).length;
  }, [refsInScope, queryLower, hasQuery]);

  const commentMatchCount = useMemo(() => {
    if (!hasQuery) return commentsInScope.length;
    let n = 0;
    for (const c of commentsInScope) {
      if ((c.text ?? '').toLowerCase().includes(queryLower)) n++;
    }
    return n;
  }, [commentsInScope, queryLower, hasQuery]);

  // Step-Literal-Treffer sind eine eigene Zähl-Kategorie (zeilen-, nicht ref-
  // basiert). Da Ref-Namen Teil des Step-Texts sind, kann ein Ref-Match in
  // seltenen Fällen doppelt zählen (einmal als Ref, einmal als Zeile) — bewusst
  // in Kauf genommen, der Hauptfall (Literal ohne Ref) zählt sauber einfach.
  const matchCount = refMatchCount + commentMatchCount + lineTextMatchCount;
  const totalCount = refsInScope.length + commentsInScope.length + stepLinesInScope.length;

  const toggleRefType = useCallback((type: RefType) => {
    setActiveRefTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, [setActiveRefTypes]);

  const toggleComment = useCallback(() => {
    setActiveRefTypes(prev => {
      const next = new Set(prev);
      if (next.has('comment')) next.delete('comment');
      else next.add('comment');
      return next;
    });
  }, [setActiveRefTypes]);

  const clearRefTypes = useCallback(() => {
    setActiveRefTypes(EMPTY_TYPES as Set<string>);
  }, [setActiveRefTypes]);

  const toggleFold = useCallback((startLine: number) => {
    setFoldedStarts(prev => {
      const next = new Set(prev);
      if (next.has(startLine)) next.delete(startLine);
      else next.add(startLine);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setFoldedStarts(new Set()), []);
  const collapseAll = useCallback(() => {
    setFoldedStarts(new Set(foldRanges.map(r => r.startLine)));
  }, [foldRanges]);
  const collapseMultiline = useCallback(() => {
    setFoldedStarts(new Set(
      foldRanges.filter(r => r.kind === 'multiline').map(r => r.startLine),
    ));
  }, [foldRanges]);

  // Beim Erscheinen eines Highlight-Sets: das erste markierte Token in den
  // sichtbaren Bereich scrollen. Vermeidet, dass der User in einem langen
  // Script manuell nach dem Treffer suchen muss. Nutzt `requestAnimationFrame`,
  // damit die DOM-Mutation der Highlight-Klassen bereits abgeschlossen ist.
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightSig = highlightRefUuids ? Array.from(highlightRefUuids).sort().join(',') : '';

  // Live-Match-Count: zählt Token-Refs mit UUID im Highlight-Set. Für die
  // RefOriginPill — der server-seitige back_references-Count liefert für
  // Token-Container nur einen Self-Link (1) als Repräsentant, nicht die
  // tatsächliche Token-Anzahl im Script-Text.
  const liveMatchCount = useMemo(() => {
    if (!highlightRefUuids || highlightRefUuids.size === 0) return 0;
    let n = 0;
    for (const ref of allRefs) {
      if (ref.uuid && highlightRefUuids.has(ref.uuid)) n++;
    }
    return n;
  }, [allRefs, highlightRefUuids]);
  useEffect(() => {
    onLiveMatchCount?.(liveMatchCount);
  }, [liveMatchCount, onLiveMatchCount]);

  // Step-Anchor (Deep-Link via ?step=<uuid>) — bleibt URL-getragen, damit ein
  // Reload die Sprungposition reproduziert.
  const [stepAnchor] = useUrlState<string>('step', '');

  // Vereinheitlichter Zeilen-Scroll für ?step= und ?ref=. Zielzeile in
  // Prioritätsreihenfolge:
  //   1. ?step=<uuid>        → li[data-step-uuid="<uuid>"]
  //   2. ?ref=<uuid> (Step)  → erste li.fm-line--ref-highlighted
  //   3. ?ref=<uuid> (Token) → closest('li.fm-line') des ersten .fm-ref--highlighted
  //
  // Beide Trigger lösen dieselbe gelbe Puls-Animation (fm-line--step-anchor)
  // aus. Da die Animation auf `background: transparent` endet, bleibt der rote
  // Hintergrund aus fm-line--ref-highlighted danach sichtbar — das ergibt das
  // Muster „erst gelb pulsen, dann rot stehen lassen". Bei reinem ?step= ohne
  // ref-Treffer verblasst die Zeile nach der Animation auf Default.
  useEffect(() => {
    if (!stepAnchor && !highlightSig) return;
    if (!rootRef.current) return;
    let cleanup: (() => void) | null = null;
    const raf = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      let line: HTMLElement | null = null;
      if (stepAnchor) {
        line = root.querySelector(
          `li[data-step-uuid="${CSS.escape(stepAnchor)}"]`,
        );
      }
      if (!line && highlightSig) {
        line = root.querySelector('li.fm-line--ref-highlighted');
        if (!line) {
          const tok = root.querySelector('.fm-ref--highlighted');
          line = (tok?.closest('li.fm-line') as HTMLElement | null) ?? null;
        }
      }
      if (!line) return;
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
      line.classList.add('fm-line--step-anchor');
      const timer = window.setTimeout(() => {
        line!.classList.remove('fm-line--step-anchor');
      }, 2500);
      cleanup = () => {
        window.clearTimeout(timer);
        line!.classList.remove('fm-line--step-anchor');
      };
    });
    return () => {
      cancelAnimationFrame(raf);
      if (cleanup) cleanup();
    };
  }, [stepAnchor, highlightSig, lines]);

  // Such-Match-Scroll: bei Query-Änderung zur Zeile des ersten Treffers (Ref-
  // Match oder Comment-Substring). Keine Puls-Animation — die orange Token-
  // Outline reicht als Anker.
  useEffect(() => {
    if (!queryLower || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const hit = rootRef.current?.querySelector(
        '.fm-ref--search-match, .fm-comment-search-match, .fm-line-search-match',
      );
      const target = (hit?.closest('li.fm-line') as HTMLElement | null) ?? hit;
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [queryLower]);

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <ScriptSearchContext.Provider value={searchPredicate}>
       <ScriptSearchQueryContext.Provider value={commentSearchQuery}>
        <ScriptLineSearchQueryContext.Provider value={lineSearchQuery}>
        <div ref={rootRef} className="object-detail fm-script-root" aria-label="Script-Text">
          {!hideToolbar && (
            <ScriptViewerHeader
              stepCount={stepCount}
              mode={mode}
              onModeChange={setMode}
              filterStyle={filterStyle}
              onFilterStyleChange={setFilterStyle}
              onExpandAll={expandAll}
              onCollapseAll={collapseAll}
              onCollapseMultiline={collapseMultiline}
            />
          )}
          {!hideToolbar && (allRefs.length > 0 || commentCount > 0) && (
            <ScriptSearchFilter
              typeCounts={typeCounts}
              activeTypes={activeTypes}
              onToggleType={toggleRefType}
              onClearTypes={clearRefTypes}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              matchCount={matchCount}
              totalCount={totalCount}
              commentPill={commentCount > 0 ? {
                count: commentCount,
                active: activeCommentFilter,
                onToggle: toggleComment,
              } : undefined}
            />
          )}
          <ol className={`fm-script fm-mode--${mode} fm-filter--${filterStyle}`}>
            {lines.map(line => {
              const starts = foldStartIndex.get(line.line);
              const folded = foldedStarts.has(line.line);
              const marginRole = marginRoleMap.get(line.line) ?? null;
              return (
                <ScriptLine
                  key={line.line}
                  line={line}
                  marginRole={marginRole}
                  hidden={hiddenLines.has(line.line)}
                  foldStarts={starts}
                  folded={folded}
                  onToggleFold={toggleFold}
                />
              );
            })}
          </ol>
        </div>
        </ScriptLineSearchQueryContext.Provider>
       </ScriptSearchQueryContext.Provider>
      </ScriptSearchContext.Provider>
    </HighlightRefContext.Provider>
  );
};
