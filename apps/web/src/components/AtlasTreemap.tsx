import { useLayoutEffect, useRef, useState } from 'react';
import { Treemap, hierarchy, treemapSquarify } from '@visx/hierarchy';
import { Group } from '@visx/group';
import { getTypeColor } from '../lib/graphColors';
import type { AtlasTile } from '../hooks/useGraphOverview';

/**
 * visx squarified treemap for one Atlas level (Achse B = Komposition).
 *
 * Presentational: it lays out the tiles of the *current* level and reports
 * clicks back via `onTileClick`. Drill vs. Explorer-handoff is the parent's
 * decision (aggregate/rest → drill, leaf → focus). Default export so the view
 * can `React.lazy()` it together with the visx bundle (like Cytoscape on /graph).
 *
 * Tile area = weight (domain/logical degree); colour = object-type palette
 * (shared with the Graph Explorer via graphColors.ts), grey for the "Rest" tile.
 */

// „Rest"-Sammelknoten + Aggregat-Fallback: theme-tokenisiert (F1). Als CSS-var-
// String → muss via SVG-`style` (nicht als Attribut) gesetzt werden, damit der
// Browser var() auflöst. Die kräftigen Typ-Palettenfarben (getTypeColor) bleiben
// Hex und reagieren nicht aufs Theme (auf ihnen ist der dunkle Text in beiden
// Themes lesbar — nur Rand/Rest werden thematisiert).
const REST_COLOR = 'var(--color-graph-rest)';
const MIN_LABEL_W = 46;
const MIN_LABEL_H = 22;

/** Size accessor: aggregate/leaf carry weight; the leaf-Rest tile only a count. */
function tileValue(t: AtlasTile): number {
  const w = 'weight' in t && t.weight != null ? t.weight : null;
  if (w != null) return Math.max(w, 1);
  if ('node_count' in t && t.node_count != null) return Math.max(t.node_count, 1);
  return 1;
}

function tileColor(t: AtlasTile): string {
  if (t.kind === 'rest') return REST_COLOR;
  if (t.kind === 'aggregate') return t.color_type ? getTypeColor(t.color_type) : REST_COLOR;
  return getTypeColor(t.type);
}

/**
 * Sekundärzeile unter dem Namen (wenn die Kachel hoch genug ist).
 * Default zeigt fachlich relevante Felder, NICHT das rohe Gewicht:
 *  - Blatt → Dateiname (Klon-Kontext),
 *  - Aggregat/Rest → Anzahl logischer Knoten.
 */
function tileSubLabel(t: AtlasTile): string {
  if (t.kind === 'leaf') return t.file ?? '';
  return `${t.node_count}`; // aggregate + rest: Anzahl (logisch)
}

/** Welche „(...)"-Panel-Art passt zu einer Kachel (Parent kennt den Drill-Kontext). */
export type TileInfoKind = 'community' | 'node' | null;

type Props = {
  tiles: AtlasTile[];
  onTileClick: (tile: AtlasTile) => void;
  /** Optional local name filter (E6): dims non-matches without re-layout. */
  filterText?: string;
  /** Sekundäre Aktion: „(...)"-Panel öffnen (nur wenn infoKindFor truthy). */
  onTileInfo?: (tile: AtlasTile) => void;
  infoKindFor?: (tile: AtlasTile) => TileInfoKind;
  /**
   * „Weitere"-Sammelkachel (kind='rest') ausblenden. Wird als zentrierter Button
   * in der Rest-Kachel gerendert; stopPropagation hält den primären Kachel-Klick
   * (Top-N anheben) frei, sodass beide Aktionen erhalten bleiben. */
  onHideRest?: () => void;
  /** Beschriftung des „ausblenden"-Buttons (i18n `rest.hide`, vom Parent geliefert). */
  hideRestLabel?: string;
  /** Noise-Filter: ausgeblendete Blätter dimmen (Default) oder ganz entfernen. */
  hiddenMode?: 'dim' | 'hide';
};

const INFO_R = 8; // Radius des „(...)"-Buttons
const HIDE_BTN_H = 22; // Höhe des zentrierten „ausblenden"-Buttons der Rest-Kachel

export default function AtlasTreemap({ tiles, onTileClick, filterText, onTileInfo, infoKindFor, onHideRest, hideRestLabel, hiddenMode = 'dim' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ width: Math.floor(cr.width), height: Math.floor(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Im „hide"-Modus ausgeblendete Blätter komplett aus dem Layout nehmen
  // (Fläche umverteilt); im „dim"-Modus bleiben sie sichtbar und werden gedimmt.
  const isHidden = (t: AtlasTile) => t.kind === 'leaf' && t.hidden === true;
  const layoutTiles = hiddenMode === 'hide' ? tiles.filter((t) => !isHidden(t)) : tiles;

  // Synthetic single-level hierarchy: root → tiles. sum() drives the layout.
  const root = hierarchy<{ tile?: AtlasTile; children?: { tile: AtlasTile }[] }>({
    children: layoutTiles.map((tile) => ({ tile })),
  })
    .sum((d) => (d.tile ? tileValue(d.tile) : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const filter = (filterText ?? '').trim().toLowerCase();
  const matches = (t: AtlasTile) => !filter || t.label.toLowerCase().includes(filter);

  const { width, height } = size;
  const ready = width > 0 && height > 0;

  return (
    <div ref={containerRef} className="atlas-treemap">
      {ready && (
        <svg width={width} height={height} role="group" aria-label="Atlas treemap">
          <Treemap root={root} size={[width, height]} tile={treemapSquarify} round paddingInner={2}>
            {(tree) => (
              <Group>
                {tree
                  .descendants()
                  .filter((node) => node.depth === 1 && node.data.tile)
                  .map((node, i) => {
                    const tile = node.data.tile as AtlasTile;
                    const w = node.x1 - node.x0;
                    const h = node.y1 - node.y0;
                    if (w <= 0 || h <= 0) return null;
                    const hidden = isHidden(tile); // im dim-Modus: gedimmt + gestrichelt
                    const dim = (filter && !matches(tile)) || hidden;
                    const showLabel = w >= MIN_LABEL_W && h >= MIN_LABEL_H;
                    const showSub = showLabel && h >= MIN_LABEL_H + 14;
                    const infoKind = infoKindFor ? infoKindFor(tile) : null;
                    const showInfo = !!infoKind && !!onTileInfo && w >= MIN_LABEL_W && h >= MIN_LABEL_H;
                    // F3: zentrierter „ausblenden"-Button nur auf der Rest-Kachel,
                    // sofern groß genug (gleiche Schwelle wie die Labels).
                    const showHideBtn = tile.kind === 'rest' && !!onHideRest && w >= MIN_LABEL_W && h >= MIN_LABEL_H;
                    const hideBtnLabel = hideRestLabel ?? 'ausblenden';
                    const hideBtnW = Math.min(w - 8, Math.max(60, hideBtnLabel.length * 6.8 + 22));
                    return (
                      <Group key={`${tile.kind}-${tile.key}-${i}`} top={node.y0} left={node.x0}>
                        <rect
                          width={w}
                          height={h}
                          rx={3}
                          className={`atlas-tile-rect${hidden ? ' hidden' : ''}`}
                          style={{ fill: tileColor(tile) }}
                          fillOpacity={dim ? 0.18 : 0.92}
                          strokeWidth={1}
                          strokeDasharray={hidden ? '3 2' : undefined}
                          onClick={() => onTileClick(tile)}
                        >
                          <title>{`${tile.label}`}</title>
                        </rect>
                        {showLabel && (
                          <text
                            x={5}
                            y={15}
                            fontSize={11}
                            fontWeight={600}
                            className="atlas-tile-text"
                            fillOpacity={dim ? 0.4 : 1}
                            style={{ pointerEvents: 'none', userSelect: 'none' }}
                          >
                            {tile.label.length > Math.floor(w / 6.5)
                              ? `${tile.label.slice(0, Math.max(0, Math.floor(w / 6.5) - 1))}…`
                              : tile.label}
                          </text>
                        )}
                        {showSub && (
                          <text
                            x={5}
                            y={29}
                            fontSize={9}
                            className="atlas-tile-text"
                            fillOpacity={dim ? 0.3 : 0.65}
                            style={{ pointerEvents: 'none', userSelect: 'none' }}
                          >
                            {tileSubLabel(tile)}
                          </text>
                        )}
                        {showInfo && (
                          // „(...)"-Button oben rechts — sekundäre Aktion (Panel),
                          // stopPropagation hält den primären Kachel-Klick (Drill) frei.
                          <Group
                            top={INFO_R + 3}
                            left={w - INFO_R - 3}
                            style={{ cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onTileInfo?.(tile);
                            }}
                          >
                            <circle r={INFO_R} className="atlas-tile-text" fillOpacity={0.55} />
                            <text
                              textAnchor="middle"
                              y={3}
                              fontSize={12}
                              fontWeight={700}
                              fill="#f5f5f7"
                              style={{ pointerEvents: 'none', userSelect: 'none' }}
                            >
                              ⋯
                            </text>
                          </Group>
                        )}
                        {showHideBtn && (
                          // Zentrierter „ausblenden"-Button: blendet die Rest-Kachel
                          // aus. stopPropagation hält den primären Kachel-Klick
                          // (Top-N anheben) frei. Theme-tauglich über bestehende Tokens.
                          <Group
                            top={(h - HIDE_BTN_H) / 2}
                            left={(w - hideBtnW) / 2}
                            style={{ cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onHideRest?.();
                            }}
                          >
                            <rect
                              width={hideBtnW}
                              height={HIDE_BTN_H}
                              rx={5}
                              style={{ fill: 'var(--color-bg-elevated)', stroke: 'var(--color-border-strong)' }}
                              strokeWidth={1}
                              fillOpacity={0.96}
                            />
                            <text
                              x={hideBtnW / 2}
                              y={HIDE_BTN_H / 2 + 4}
                              textAnchor="middle"
                              fontSize={11}
                              fontWeight={600}
                              style={{ fill: 'var(--color-text-primary)', pointerEvents: 'none', userSelect: 'none' }}
                            >
                              {hideBtnLabel}
                            </text>
                          </Group>
                        )}
                      </Group>
                    );
                  })}
              </Group>
            )}
          </Treemap>
        </svg>
      )}
    </div>
  );
}
