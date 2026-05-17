import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { ScriptTokens, ViewMode, ScriptRef, RefType } from '../script/types';
import { computeFoldRanges, computeHiddenLines, buildFoldStartIndex } from '../script/folding';
import { computeMarginRoleMap } from '../script/marginBar';
import { ScriptLine } from './ScriptLine';
import { ScriptViewerHeader, type FilterStyle } from './ScriptViewerHeader';
import { ScriptSearchFilter } from './ScriptSearchFilter';
import { useUrlState, stringSetCodec } from '../hooks/useUrlState';
import { HighlightRefContext, ScriptSearchContext, ScriptSearchQueryContext, type ScriptSearchPredicate } from '../script/highlightContext';
import './ScriptViewer.css';

interface ScriptViewerProps {
  tokens: ScriptTokens;
  /** Cross-Reference Highlight: Token-Match auf Tokens mit `ref.uuid ∈ Set`. */
  highlightRefUuids?: Set<string> | null;
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

export const ScriptViewer: React.FC<ScriptViewerProps> = ({ tokens, highlightRefUuids }) => {
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

  const matchCount = refMatchCount + commentMatchCount;
  const totalCount = refsInScope.length + commentsInScope.length;

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
  useEffect(() => {
    if (!highlightSig || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector('.fm-ref--highlighted');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightSig]);

  // Auch beim Search-Match (orange) zum ersten Treffer scrollen. Greift sowohl
  // bei Ref-Matches (.fm-ref--search-match) als auch bei Comment-Substring-
  // Matches (.fm-comment-search-match).
  useEffect(() => {
    if (!queryLower || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector(
        '.fm-ref--search-match, .fm-comment-search-match',
      );
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [queryLower]);

  // Step-Anchor (Deep-Link): wenn die URL einen `step`-Param trägt — z.B. aus
  // einem Dashboard-Klick mit { params: { step: '<step_uuid>' } } — scrollen
  // wir zur passenden Zeile und blenden temporär eine Anchor-Markierung ein.
  // Der Param bleibt in der URL erhalten, damit ein Reload die Position
  // reproduziert; das visuelle Highlight ist auf ~2.5s begrenzt.
  const [stepAnchor] = useUrlState<string>('step', '');
  useEffect(() => {
    if (!stepAnchor || !rootRef.current) return;
    let cleanup: (() => void) | null = null;
    const raf = requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector(
        `li[data-step-uuid="${CSS.escape(stepAnchor)}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('fm-line--step-anchor');
      const timer = window.setTimeout(() => {
        el.classList.remove('fm-line--step-anchor');
      }, 2500);
      cleanup = () => {
        window.clearTimeout(timer);
        el.classList.remove('fm-line--step-anchor');
      };
    });
    return () => {
      cancelAnimationFrame(raf);
      if (cleanup) cleanup();
    };
  }, [stepAnchor, lines]);

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <ScriptSearchContext.Provider value={searchPredicate}>
       <ScriptSearchQueryContext.Provider value={commentSearchQuery}>
        <div ref={rootRef} className="object-detail fm-script-root" aria-label="Script-Text">
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
          {(allRefs.length > 0 || commentCount > 0) && (
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
       </ScriptSearchQueryContext.Provider>
      </ScriptSearchContext.Provider>
    </HighlightRefContext.Provider>
  );
};
