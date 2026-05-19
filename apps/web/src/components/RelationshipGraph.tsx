import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RelationshipGraphData, TableOccurrence } from '../hooks/useRelationshipGraph';
import { useGraphSearch } from '../hooks/useGraphSearch';
import { TOBox, SelectionRing } from './TOBox';
import { JoinLine } from './JoinLine';
import { layoutTOBox } from './relationshipGraphLayout';

type Props = {
  data: RelationshipGraphData;
  initialPreSelectUuid?: string | null;
  onPreSelectExit?: () => void;
};

/**
 * Imperatives Handle für die ESC-Stack-Verdrahtung in RelationshipGraphView.
 * Status-Getter werden bei jedem ESC-Druck live aufgerufen.
 */
export type RelationshipGraphHandle = {
  hasSearchState: () => boolean;
  clearSearch: () => void;
};

const PADDING = 40;
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const PAN_MARGIN = 40;

type ViewTransform = { tx: number; ty: number; scale: number };

/**
 * Berechnet die Viewport-Bounding-Box aus den layoutet'en TO-Boxen,
 * inklusive abgeleiteter Höhen — die XML-Bounds sind bei Collapse zu groß.
 */
function computeViewport(tos: TableOccurrence[]) {
  if (tos.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tos) {
    const l = layoutTOBox(t);
    if (l.x < minX) minX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.x + l.width > maxX) maxX = l.x + l.width;
    if (l.y + l.height > maxY) maxY = l.y + l.height;
  }
  return { minX, minY, maxX, maxY };
}

export const RelationshipGraph = forwardRef<RelationshipGraphHandle, Props>(({ data, initialPreSelectUuid = null, onPreSelectExit }, externalRef) => {
  const { t } = useTranslation(['common', 'detail']);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [transform, setTransform] = useState<ViewTransform>({ tx: 0, ty: 0, scale: 1 });
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  const search = useGraphSearch(data.tableOccurrences, initialPreSelectUuid);

  const viewport = useMemo(() => computeViewport(data.tableOccurrences), [data.tableOccurrences]);
  const tosByUuid = useMemo(() => {
    const m = new Map<string, TableOccurrence>();
    for (const t of data.tableOccurrences) m.set(t.uuid, t);
    return m;
  }, [data.tableOccurrences]);

  const fitToViewport = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = viewport.maxX - viewport.minX + 2 * PADDING;
    const h = viewport.maxY - viewport.minY + 2 * PADDING;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(rect.width / w, rect.height / h);
    const tx = -viewport.minX * scale + PADDING * scale;
    const ty = -viewport.minY * scale + PADDING * scale;
    setTransform({ tx, ty, scale });
  }, [viewport]);

  const reset100 = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const tx = rect.width / 2 - (viewport.minX + viewport.maxX) / 2;
    const ty = rect.height / 2 - (viewport.minY + viewport.maxY) / 2;
    setTransform({ tx, ty, scale: 1 });
  };

  // Initial: Fit
  useEffect(() => {
    const id = requestAnimationFrame(fitToViewport);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.file]);

  // Auto-Pan: selektierte TO ins Sichtfeld bringen, falls außerhalb (PRD F13).
  useEffect(() => {
    if (!search.selectedUuid || !containerRef.current) return;
    const to = tosByUuid.get(search.selectedUuid);
    if (!to) return;
    const layout = layoutTOBox(to);
    const rect = containerRef.current.getBoundingClientRect();

    const screenX = layout.x * transform.scale + transform.tx;
    const screenY = layout.y * transform.scale + transform.ty;
    const screenW = layout.width * transform.scale;
    const screenH = layout.height * transform.scale;

    const outOfView =
      screenX < PAN_MARGIN ||
      screenY < PAN_MARGIN ||
      screenX + screenW > rect.width - PAN_MARGIN ||
      screenY + screenH > rect.height - PAN_MARGIN;
    if (!outOfView) return;

    const targetTx = rect.width / 2 - (layout.x + layout.width / 2) * transform.scale;
    const targetTy = rect.height / 2 - (layout.y + layout.height / 2) * transform.scale;
    setTransform(prev => ({ ...prev, tx: targetTx, ty: targetTy }));
    // Wir hängen NUR an selectedUuid + scale — nicht an tx/ty, damit der Effekt
    // nicht in eine Schleife läuft, wenn der Pan selbst tx/ty ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.selectedUuid, transform.scale, tosByUuid]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('.to-box')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      tx: transform.tx,
      ty: transform.ty,
    };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTransform(prev => ({ ...prev, tx: dragRef.current!.tx + dx, ty: dragRef.current!.ty + dy }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const delta = -e.deltaY * 0.001;
    setTransform(prev => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (1 + delta)));
      const ratio = nextScale / prev.scale;
      // Zoom auf Mausposition: tx = cx - (cx - tx) * ratio
      const tx = cx - (cx - prev.tx) * ratio;
      const ty = cy - (cy - prev.ty) * ratio;
      return { tx, ty, scale: nextScale };
    });
  };

  const handleTOClick = (uuid: string) => {
    navigate(`/object/${uuid}`);
  };

  // Live-Refs für den imperative Handle.
  const searchRef = useRef(search);
  searchRef.current = search;
  const onPreSelectExitRef = useRef(onPreSelectExit);
  onPreSelectExitRef.current = onPreSelectExit;

  useImperativeHandle(externalRef, () => ({
    hasSearchState: () => {
      const s = searchRef.current;
      return s.query !== '' || s.selectedUuid !== null || s.isPreSelectActive;
    },
    clearSearch: () => {
      const s = searchRef.current;
      const wasPreSelect = s.isPreSelectActive;
      s.clear();
      if (wasPreSelect) onPreSelectExitRef.current?.();
    },
  }), []);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ESC bewusst NICHT lokal abfangen — globaler ESC-Stack auf
    // RelationshipGraphView-Ebene regelt Suche/Selektion → Zurück.
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) search.selectPrev();
      else search.selectNext();
    } else if (e.key === 'Enter' && search.selectedUuid) {
      e.preventDefault();
      handleTOClick(search.selectedUuid);
    }
  };

  const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const wasPreSelect = search.isPreSelectActive;
    search.setQuery(value);
    if (wasPreSelect && value !== '') onPreSelectExit?.();
  };

  const handleExitPreSelectChip = () => {
    search.exitPreSelect();
    onPreSelectExit?.();
    searchInputRef.current?.focus();
  };

  const filterActive = search.query !== '' || search.isPreSelectActive;

  return (
    <div className="relationship-graph-canvas-wrapper">
      <div className="relationship-graph-toolbar-actions">
        <div className="relationship-graph-search">
          <input
            ref={searchInputRef}
            type="search"
            placeholder={t('detail:relationshipGraphCanvas.searchPlaceholder') as string}
            value={search.query}
            onChange={onSearchChange}
            onKeyDown={onSearchKeyDown}
            title={t('detail:relationshipGraphCanvas.searchTitle') as string}
            aria-label={t('detail:relationshipGraphCanvas.searchAria') as string}
          />
          {search.isPreSelectActive && search.preSelectName && (
            <span className="relationship-graph-preselect-chip" title={t('detail:relationshipGraphCanvas.preselectChipTitle') as string}>
              {t('detail:relationshipGraphCanvas.preselectLabel')} <strong>{search.preSelectName}</strong>
              <button
                type="button"
                onClick={handleExitPreSelectChip}
                aria-label={t('detail:relationshipGraphCanvas.preselectChipAria') as string}
              >✕</button>
            </span>
          )}
          {filterActive && (
            <span className="relationship-graph-match-count">
              {t('detail:relationshipGraphCanvas.matchCount', { count: search.matches.length })}
            </span>
          )}
        </div>
        <button onClick={fitToViewport} type="button" title={t('common:actions.fitToViewport') as string}>{t('common:actions.fit')}</button>
        <button onClick={reset100} type="button" title={t('common:actions.originalSize') as string}>100%</button>
        <span className="relationship-graph-stats">
          {t('detail:relationshipGraphCanvas.stats', {
            count: data.tableOccurrences.length,
            tos: data.tableOccurrences.length,
            rels: data.relationships.length,
            zoom: (transform.scale * 100).toFixed(0),
          })}
        </span>
      </div>
      <div
        ref={containerRef}
        className="relationship-graph-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={onWheel}
        style={{
          cursor: dragRef.current ? 'grabbing' : 'grab',
        }}
      >
        <svg width="100%" height="100%" style={{ display: 'block', userSelect: 'none' }}>
          <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
            {/* Beziehungslinien zuerst, damit Boxen darüber liegen */}
            {data.relationships.flatMap(r => {
              const leftTO = tosByUuid.get(r.left.toUuid);
              const rightTO = tosByUuid.get(r.right.toUuid);
              if (!leftTO || !rightTO) return [];
              const dimmed = filterActive
                && (!search.matchUuids.has(leftTO.uuid) || !search.matchUuids.has(rightTO.uuid));
              return r.predicates.map((_, idx) => (
                <JoinLine
                  key={`${r.id}-${idx}`}
                  relationship={r}
                  leftTO={leftTO}
                  rightTO={rightTO}
                  predicateIndex={idx}
                  predicateCount={r.predicates.length}
                  isDimmed={dimmed}
                />
              ));
            })}
            {data.tableOccurrences.map(to => {
              const isMatchTO = filterActive && search.matchUuids.has(to.uuid);
              const isDimmedTO = filterActive && !search.matchUuids.has(to.uuid);
              const displayMode = isMatchTO ? 'highlight' : (isDimmedTO ? 'dim' : 'normal');
              const isSelected = search.selectedUuid === to.uuid;
              return (
                <TOBox
                  key={to.uuid}
                  to={to}
                  onClick={handleTOClick}
                  displayMode={displayMode}
                  isSelected={isSelected}
                />
              );
            })}
            {/* Selektions-Ring als Overlay — ganz oben, damit auch (halb-)verdeckte TOs klar sichtbar sind */}
            {search.selectedUuid && tosByUuid.get(search.selectedUuid) && (
              <SelectionRing to={tosByUuid.get(search.selectedUuid)!} />
            )}
          </g>
        </svg>
      </div>
    </div>
  );
});

RelationshipGraph.displayName = 'RelationshipGraph';
