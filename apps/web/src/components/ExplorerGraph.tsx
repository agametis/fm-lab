import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import cytoscape from 'cytoscape';
import type { GraphNode, GraphEdge, SubgraphResponse } from '../hooks/useSubgraph';
import { subgraphToElements } from '../hooks/useSubgraph';
import { getCommunityColor } from '../lib/graphColors';

/**
 * Graph-Explorer canvas.
 *
 * Renders the focus-centered subgraph with an `fcose` force-directed layout
 * (lazy-loaded for code-splitting). The Cytoscape instance is created once and
 * its elements are replaced whenever `data` changes. Nodes are drawn as
 * degree-scaled circles with labels only on hubs / focus /
 * hover / selection. Name- and type-filters work purely client-side (visibility
 * toggles, no re-layout); a single tap re-centers (`onSetFocus`) and ⌘/Ctrl-tap
 * opens the object in the DetailView (`onOpenDetails`).
 */

/** How the soft filters (name / file) treat non-matching nodes. */
export type FilterMode = 'dim' | 'hide';
/** Node color lens: by object type (default) or by P5 community. */
export type ColorMode = 'type' | 'community';

export interface ExplorerGraphHandle {
  /** Fit the whole graph into the viewport. */
  fit: () => void;
  /** Re-run the force layout from scratch. */
  relayout: () => void;
  /** Export the current canvas as a PNG data-URL (full graph, transparent bg). */
  exportPng: () => string | null;
  /** Merge expand results into the graph without re-fetching (1-hop expand). */
  mergeElements: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  /** Collapse a hub: drop its leaf neighbors (only reachable via this hub). */
  collapseHub: (uuid: string) => void;
  /** Mark a node as the inspected one (selection ring) without re-centering. */
  highlightNode: (uuid: string | null) => void;
}

interface ExplorerGraphProps {
  data: SubgraphResponse | null;
  /** Client-side name filter — non-matching nodes are dimmed or hidden (focus stays). */
  nameFilter: string;
  /** Client-side file filter (null = all files) — non-matching nodes dimmed/hidden. */
  selectedFile: string | null;
  /** Whether name/file non-matches are dimmed (default) or removed. */
  filterMode: FilterMode;
  /** Deselected node types (exclusion set) — these are hidden; focus always stays. */
  deselectedTypes: string[];
  /** Node color lens — 'type' (default) or 'community' (standalone färb-lens). */
  colorMode?: ColorMode;
  /** Selected community (hull + dims others); null = none. */
  selectedCommunity?: number | null;
  /** Hovered community (transient hull preview); null = none. */
  hoveredCommunity?: number | null;
  /** Double tap on a node — re-center the graph on it. (file = Klon-Disambiguierung) */
  onSetFocus: (uuid: string, file?: string | null) => void;
  /** ⌘/Ctrl tap on a node — open it in the DetailView. (file = Klon-Disambiguierung) */
  onOpenDetails: (uuid: string, file?: string | null) => void;
  /** Single tap selects a node — parent shows its metadata in the inspect panel. */
  onSelectNode?: (node: GraphNode | null) => void;
}

// fcose has no bundled type declarations; register it once, lazily, so the
// ~heavy layout code is split out of the main bundle.
let fcoseReady: Promise<void> | null = null;
function ensureFcose(): Promise<void> {
  if (!fcoseReady) {
    fcoseReady = import('cytoscape-fcose').then((mod) => {
      cytoscape.use(mod.default ?? mod);
    });
  }
  return fcoseReady;
}

// Layout tuning: more breathing room, components packed.
const fcoseLayout = {
  name: 'fcose',
  quality: 'default',
  animate: false,
  randomize: true,
  nodeRepulsion: 12000,
  idealEdgeLength: 120,
  nodeSeparation: 110,
  gravity: 0.15,
  gravityRange: 3.8,
  packComponents: true,
  padding: 40,
} as unknown as cytoscape.LayoutOptions;

// Degree-scaled diameter: 12 px (leaf) … 48 px (max-degree hub).
const NODE_MIN_PX = 12;
const NODE_RANGE_PX = 36;
// Persistent label only for "important" nodes (≥15 % maxDeg).
const LABEL_DEGREE_FRACTION = 0.15;

const cytoscapeStyles: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      // Hidden by default — only hubs/focus/hover/selection reveal a label.
      'label': '',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 4,
      'font-size': '11px',
      'font-family': 'system-ui, -apple-system, sans-serif',
      'color': '#e6e6ea',
      'text-outline-width': 2,
      'text-outline-color': '#1a1a1a',
      'text-wrap': 'wrap',
      'text-max-width': '120px',
      'width': 'data(sizePx)',
      'height': 'data(sizePx)',
      'shape': 'ellipse',
      'background-color': 'data(color)',
      'border-width': 1.5,
      'border-color': 'data(color)',
      'cursor': 'pointer',
    } as unknown as cytoscape.Css.Node,
  },
  // High-degree nodes carry a permanent label.
  {
    selector: 'node[?showLabel]',
    style: { 'label': 'data(label)' } as unknown as cytoscape.Css.Node,
  },
  // Community color lens — recolor by P5 community when the standalone
  // färb-lens is on. Declared BEFORE the hub/focus/hover/selected rules so those
  // state borders still win; only the fill + the resting border switch to the
  // community color. Unclustered nodes carry the neutral gray (UNCLUSTERED_COLOR).
  {
    selector: 'node.color-community',
    style: {
      'background-color': 'data(communityColor)',
      'border-color': 'data(communityColor)',
    } as unknown as cytoscape.Css.Node,
  },
  // Hub node — bright accent border (no longer a diamond; all nodes are circles).
  {
    selector: 'node[?isHub]',
    style: {
      'border-width': 2.5,
      'border-color': '#ffffff',
    } as unknown as cytoscape.Css.Node,
  },
  // Focus node — accent ring + bold, always labelled.
  {
    selector: 'node[?isFocus]',
    style: {
      'label': 'data(label)',
      'border-color': '#646cff',
      'border-width': 3,
      'font-weight': 'bold',
      'font-size': '12px',
    } as unknown as cytoscape.Css.Node,
  },
  // Hover neighborhood — reveal labels for context.
  {
    selector: 'node.nbr-hl',
    style: { 'label': 'data(label)' } as unknown as cytoscape.Css.Node,
  },
  // Hovered node itself — accent ring + label.
  {
    selector: 'node.hover',
    style: {
      'label': 'data(label)',
      'border-width': 3,
      'border-color': '#646cff',
    } as unknown as cytoscape.Css.Node,
  },
  // Selected (inspected) node — persistent ring while the inspect panel is open.
  {
    selector: 'node.selected',
    style: {
      'label': 'data(label)',
      'border-width': 4,
      'border-color': '#ffd54f',
    } as unknown as cytoscape.Css.Node,
  },
  // Focus halo — a separate, non-interactive ring at 1.5× the focus node's radius
  // (red, 50 % opacity, double line width). A dedicated node so the ring sits
  // *outside* the focus node with a visible gap (user request).
  {
    selector: 'node.focus-halo',
    style: {
      'shape': 'ellipse',
      'width': 'data(haloSize)',
      'height': 'data(haloSize)',
      'background-opacity': 0,
      'border-color': '#ff3b30',
      'border-width': 3,
      'border-opacity': 0.5,
      'label': '',
      'events': 'no',
      'z-index': 0,
    } as unknown as cytoscape.Css.Node,
  },
  {
    selector: 'edge',
    style: {
      'width': 1,
      'line-color': '#7a7a8c',
      // Lighter arrowhead + full scale so the "uses" direction reads clearly.
      'target-arrow-color': '#b8b8c8',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 1,
      'curve-style': 'bezier',
      'control-point-step-size': 40,
      'label': 'data(label)',
      'font-size': '8px',
      'color': '#888',
      'text-rotation': 'autorotate',
      'text-background-color': '#1a1a1a',
      'text-background-opacity': 0.8,
      'text-background-padding': '2px',
      'font-family': 'system-ui, -apple-system, sans-serif',
    } as unknown as cytoscape.Css.Edge,
  },
  // Structural links — lighter, dotted (hierarchy, not a call/usage).
  {
    selector: 'edge[linkType = "structural"]',
    style: {
      'line-style': 'dotted',
      'line-color': '#5a5a66',
      'target-arrow-color': '#9a9aa8',
    } as unknown as cytoscape.Css.Edge,
  },
  // Cross-file links — orange dashed, slightly heavier.
  {
    selector: 'edge[?isCrossFile]',
    style: {
      'width': 1.5,
      'line-color': '#ff9800',
      'target-arrow-color': '#ffb74d',
      'line-style': 'dashed',
    } as unknown as cytoscape.Css.Edge,
  },
  // Name filter, "dim" mode — non-matches stay laid out but recede (spec refinement).
  {
    selector: '.name-dimmed',
    style: { 'opacity': 0.2 } as unknown as cytoscape.Css.Node,
  },
  // Hover dimming (strong fade of the non-neighborhood). Declared
  // after `.name-dimmed` so a hover fade wins over a filter dim on the same element.
  {
    selector: '.faded',
    style: { 'opacity': 0.12 } as unknown as cytoscape.Css.Node,
  },
  // Type exclusion + name filter "hide" mode — removed from layout + render,
  // positions kept.
  {
    selector: '.filtered-hidden',
    style: { 'display': 'none' } as unknown as cytoscape.Css.Node,
  },
];

/** Recompute degree-scaled size + label visibility across all real nodes. */
function recomputeNodeVisuals(cy: cytoscape.Core): void {
  const realNodes = cy.nodes().not('.focus-halo');
  let maxDeg = 0;
  realNodes.forEach((n) => {
    const d = (n.data('degree') as number) ?? 0;
    if (d > maxDeg) maxDeg = d;
  });
  const denom = Math.max(maxDeg, 1);
  cy.batch(() => {
    realNodes.forEach((n) => {
      const d = (n.data('degree') as number) ?? 0;
      n.data('sizePx', Math.round(NODE_MIN_PX + NODE_RANGE_PX * (d / denom)));
      n.data('showLabel', d >= LABEL_DEGREE_FRACTION * denom);
    });
  });
}

// ── Community hull overlay ────────────────────────────────────
// A selected community is wrapped in a translucent colored convex hull drawn on a
// canvas *behind* the cytoscape layers (so it reads as a background blob). A hover
// in the legend previews another hull on top and weakens the selected one.
const HULL_ALPHA_SELECTED = 0.12;
const HULL_ALPHA_HOVERED = 0.20;
const HULL_ALPHA_SELECTED_WEAK = 0.06;
const HULL_PAD_PX = 16;

/** Andrew's monotone-chain convex hull over screen-space points `[x,y][]`. */
function convexHull(points: number[][]): number[][] {
  if (points.length <= 2) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: number[][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: number[][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Redraw the community hulls. Uses model→screen projection (`pos·zoom + pan`) so
 * it tracks pan/zoom and works even for `display:none`/faded nodes. A solid blob
 * is rendered on an offscreen canvas (alpha 1) and composited at the per-hull
 * alpha → uniform translucency without stroke/fill seams.
 */
function drawCommunityHulls(
  cy: cytoscape.Core,
  canvas: HTMLCanvasElement,
  off: HTMLCanvasElement,
  selected: number | null,
  hovered: number | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Bound the backing store: the standalone graph breaks out to full viewport
  // width, so on a hi-DPI wide screen an unclamped clientWidth·dpr canvas
  // (×2 with the offscreen) can reach hundreds of MB and OOM the renderer.
  const HULL_MAX_PX = 4096;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (cw < 2 || ch < 2) return; // not laid out yet
  // One `scale` for both the backing-store size AND the projection so the buffer
  // never exceeds HULL_MAX_PX per side (bounded memory) without clipping the hull.
  const scale = Math.min(window.devicePixelRatio || 1, 2, HULL_MAX_PX / cw, HULL_MAX_PX / ch);
  const pxW = Math.max(1, Math.round(cw * scale));
  const pxH = Math.max(1, Math.round(ch * scale));
  if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
  if (off.width !== pxW || off.height !== pxH) { off.width = pxW; off.height = pxH; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pxW, pxH);
  if (selected === null && hovered === null) return;

  // Draw the selected hull first, the hovered one on top (overlap).
  const order: number[] = [];
  if (selected !== null) order.push(selected);
  if (hovered !== null && hovered !== selected) order.push(hovered);

  const zoom = cy.zoom();
  const pan = cy.pan();
  const octx = off.getContext('2d');
  if (!octx) return;

  for (const id of order) {
    const nodes = cy.nodes().filter((n) => !n.hasClass('focus-halo') && n.data('community') === id);
    if (nodes.empty()) continue;
    const pts: number[][] = [];
    let maxR = NODE_MIN_PX / 2;
    nodes.forEach((n) => {
      const p = n.position();
      pts.push([(p.x * zoom + pan.x) * scale, (p.y * zoom + pan.y) * scale]);
      const r = ((n.data('sizePx') as number) ?? NODE_MIN_PX) / 2;
      if (r > maxR) maxR = r;
    });
    const hull = convexHull(pts);
    if (!hull.length) continue;
    const padPx = (maxR * zoom + HULL_PAD_PX) * scale;

    let alpha = HULL_ALPHA_SELECTED;
    if (id === hovered) alpha = HULL_ALPHA_HOVERED;
    else if (id === selected) {
      alpha = hovered !== null && hovered !== selected ? HULL_ALPHA_SELECTED_WEAK : HULL_ALPHA_SELECTED;
    }
    const color = getCommunityColor(id);

    // Solid blob on the offscreen (fill + thick round stroke = padded outline).
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, pxW, pxH);
    octx.lineJoin = 'round';
    octx.lineCap = 'round';
    octx.beginPath();
    if (hull.length === 1) {
      octx.arc(hull[0][0], hull[0][1], padPx, 0, 2 * Math.PI);
    } else {
      octx.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) octx.lineTo(hull[i][0], hull[i][1]);
      octx.closePath();
    }
    octx.fillStyle = color;
    octx.fill();
    octx.lineWidth = padPx * 2;
    octx.strokeStyle = color;
    octx.stroke();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
}

/** Toggle the community color lens across all real nodes (halo excluded). */
function applyColorMode(cy: cytoscape.Core, mode: ColorMode): void {
  const real = cy.nodes().not('.focus-halo');
  if (mode === 'community') real.addClass('color-community');
  else real.removeClass('color-community');
}

const HALO_ID_PREFIX = '__focus_halo__';

/**
 * Create/update the red focus halo — a non-interactive ring node at 1.5× the
 * focus node's radius, sitting concentrically behind it (user request). Removes
 * any stale halo first so a re-focus moves the ring. Must run after node sizing
 * (`recomputeNodeVisuals`) and after the layout settles (positions final).
 */
function syncFocusHalo(cy: cytoscape.Core): void {
  cy.batch(() => {
    cy.nodes('.focus-halo').remove();
    const focus = cy.nodes().filter((n) => Boolean(n.data('isFocus')) && !n.hasClass('focus-halo'));
    if (focus.empty()) return;
    const f = focus[0];
    const size = (f.data('sizePx') as number) ?? NODE_MIN_PX;
    const pos = f.position();
    const halo = cy.add({
      group: 'nodes',
      // Carry the data fields the base `node` style maps (color/communityColor/
      // sizePx) so cytoscape doesn't warn about missing mappings on the halo; the
      // `.focus-halo` rules override the visuals (transparent fill, red ring).
      data: {
        id: `${HALO_ID_PREFIX}${f.id()}`,
        isHalo: true,
        haloSize: Math.round(size * 1.5),
        color: 'transparent',
        communityColor: 'transparent',
        sizePx: Math.round(size),
      },
      position: { x: pos.x, y: pos.y },
      selectable: false,
      grabbable: false,
    });
    halo.addClass('focus-halo');
  });
}

/**
 * Run the force layout and only fit *after* it settles, against a fresh viewport.
 * The layout is given a `boundingBox` matching the current (wide)
 * canvas so the graph spreads across the full window width instead of collapsing
 * into a centered square with empty side gutters.
 */
function runLayout(cy: cytoscape.Core, opts: cytoscape.LayoutOptions): void {
  cy.resize();
  const boundingBox = {
    x1: 0,
    y1: 0,
    w: Math.max(cy.width(), 400),
    h: Math.max(cy.height(), 400),
  };
  const layout = cy.layout({ ...opts, boundingBox } as cytoscape.LayoutOptions);
  layout.one('layoutstop', () => {
    cy.resize();
    cy.fit(undefined, 40);
  });
  layout.run();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const ExplorerGraph = forwardRef<ExplorerGraphHandle, ExplorerGraphProps>(
  ({ data, nameFilter, selectedFile, filterMode, deselectedTypes, colorMode = 'type', selectedCommunity = null, hoveredCommunity = null, onSetFocus, onOpenDetails, onSelectNode }, ref) => {
    const { t } = useTranslation(['explorer']);
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);
    const [ready, setReady] = useState(false);
    // Read inside the mount-only mergeElements handle so freshly merged nodes
    // inherit the current color lens without re-binding the imperative handle.
    const colorModeRef = useRef(colorMode);
    colorModeRef.current = colorMode;

    // Community hull overlay: a canvas behind the cytoscape layers,
    // a reusable offscreen buffer, and refs the mount-only `render` handler reads.
    const hullCanvasRef = useRef<HTMLCanvasElement>(null);
    const offscreenRef = useRef<HTMLCanvasElement | null>(null);
    const selCommunityRef = useRef(selectedCommunity);
    selCommunityRef.current = selectedCommunity;
    const hovCommunityRef = useRef(hoveredCommunity);
    hovCommunityRef.current = hoveredCommunity;
    // Coalesce redraws to one per animation frame (cytoscape fires `render` many
    // times per second during pan/zoom/fade — a synchronous full-canvas redraw on
    // each, plus the per-hover effect, can pile up). `lastDrew` lets idle frames
    // skip the canvas entirely when nothing is (or was) drawn.
    const hullRafRef = useRef(0);
    const hullLastDrewRef = useRef(false);
    const redrawHulls = () => {
      if (hullRafRef.current) return; // a frame is already scheduled
      hullRafRef.current = window.requestAnimationFrame(() => {
        hullRafRef.current = 0;
        const cy = cyRef.current;
        const canvas = hullCanvasRef.current;
        if (!cy || !canvas) return;
        const sel = selCommunityRef.current;
        const hov = hovCommunityRef.current;
        const willDraw = sel !== null || hov !== null;
        if (!willDraw && !hullLastDrewRef.current) return; // nothing to draw or clear
        hullLastDrewRef.current = willDraw;
        if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
        try {
          drawCommunityHulls(cy, canvas, offscreenRef.current, sel, hov);
        } catch {
          // A draw failure must never break the graph; drop this frame.
        }
      });
    };

    // Keep the latest callbacks in refs so the cytoscape init effect can stay
    // mount-only (handlers never need re-binding).
    const setFocusRef = useRef(onSetFocus);
    setFocusRef.current = onSetFocus;
    const openDetailsRef = useRef(onOpenDetails);
    openDetailsRef.current = onOpenDetails;
    const selectRef = useRef(onSelectNode);
    selectRef.current = onSelectNode;
    // Tooltip label strings (read inside mount-only handlers).
    const tRef = useRef(t);
    tRef.current = t;

    useImperativeHandle(ref, () => ({
      fit: () => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.resize();
        cy.fit(undefined, 40);
      },
      relayout: () => {
        const cy = cyRef.current;
        if (!cy) return;
        runLayout(cy, fcoseLayout);
      },
      exportPng: () =>
        cyRef.current?.png({ full: true, scale: 2, bg: 'transparent' }) ?? null,
      mergeElements: (nodes, edges) => {
        const cy = cyRef.current;
        if (!cy) return;
        const incoming = subgraphToElements(nodes, edges);
        // Only add elements not already present (cytoscape throws on dup ids).
        const fresh = incoming.filter((el) => cy.getElementById(el.data.id as string).empty());
        if (fresh.length === 0) return;
        cy.add(fresh);
        recomputeNodeVisuals(cy);
        applyColorMode(cy, colorModeRef.current);
        // Re-layout keeping existing positions as the starting point so the
        // graph grows outward instead of reshuffling (incremental expand).
        runLayout(cy, { ...fcoseLayout, randomize: false } as cytoscape.LayoutOptions);
      },
      collapseHub: (uuid) => {
        const cy = cyRef.current;
        if (!cy) return;
        const hub = cy.getElementById(uuid);
        if (hub.empty()) return;
        // Leaf neighbors = degree-1 nodes whose only edge is to the hub, and
        // never the focus node. Removing them folds the hub's fan-out away.
        const leaves = hub
          .neighborhood()
          .nodes()
          .filter((n) => n.degree(false) <= 1 && !n.data('isFocus'));
        leaves.remove();
      },
      highlightNode: (uuid) => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.nodes().removeClass('selected');
        if (uuid) cy.getElementById(uuid).addClass('selected');
      },
    }));

    // Init once: register fcose, create the instance, bind handlers.
    useEffect(() => {
      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;

      const hideTooltip = () => {
        if (tooltipRef.current) tooltipRef.current.hidden = true;
      };

      ensureFcose().then(() => {
        if (disposed || !containerRef.current) return;

        const cy = cytoscape({
          container: containerRef.current,
          elements: [],
          style: cytoscapeStyles,
          minZoom: 0.15,
          maxZoom: 3,
          wheelSensitivity: 0.3,
        });

        // Single tap node: ⌘/Ctrl → details, plain → select (inspect panel).
        cy.on('tap', 'node', (evt) => {
          const node = evt.target;
          // data('id') ist der composite Graph-Key (uuid::file) — für Navigation die
          // ROHE uuid + file nutzen (Klon-Disambiguierung).
          const uuid = node.data('uuid') as string;
          const oe = evt.originalEvent as MouseEvent;
          if (oe.metaKey || oe.ctrlKey) {
            openDetailsRef.current(uuid, (node.data('file') as string | null) ?? null);
            return;
          }
          cy.nodes().removeClass('selected');
          node.addClass('selected');
          selectRef.current?.(nodeFromData(node.data()));
        });

        // Double tap node: re-center the graph on it.
        cy.on('dbltap', 'node', (evt) => {
          // Re-Focus über die ROHE uuid + file (nicht den composite Graph-Key).
          const uuid = evt.target.data('uuid') as string;
          if (!evt.target.data('isFocus')) setFocusRef.current(uuid, (evt.target.data('file') as string | null) ?? null);
        });

        // Tap empty background: clear selection.
        cy.on('tap', (evt) => {
          if (evt.target === cy) {
            cy.nodes().removeClass('selected');
            selectRef.current?.(null);
          }
        });

        // Hover: highlight node + direct neighbors + linking
        // edges, strongly dim the rest, and show a metadata tooltip.
        cy.on('mouseover', 'node', (evt) => {
          const node = evt.target;
          const keep = node.closedNeighborhood();
          // The focus halo stays bright as a persistent locator, never dimmed.
          cy.elements().not(keep).not('.focus-halo').addClass('faded');
          keep.addClass('nbr-hl');
          node.addClass('hover');
          if (containerRef.current) containerRef.current.style.cursor = 'pointer';

          const tip = tooltipRef.current;
          if (tip) {
            const tt = tRef.current;
            const file = node.data('file') as string | null;
            const community = node.data('communityName') as string | null;
            // "Role" = structural status (no per-node link role exists in the model);
            // mirrors the inspect panel. Focus takes precedence over hub.
            const roleLabel = node.data('isFocus')
              ? tt('inspect.focus')
              : node.data('isHub')
                ? tt('inspect.hub')
                : null;
            const lines = [
              `<strong>${escapeHtml(String(node.data('label') ?? ''))}</strong>`,
              `${tt('inspect.type')}: ${escapeHtml(String(node.data('type') ?? ''))}`,
              file ? `${tt('inspect.file')}: ${escapeHtml(file)}` : null,
              community ? `${tt('inspect.community')}: ${escapeHtml(community)}` : null,
              roleLabel ? `${tt('inspect.role')}: ${escapeHtml(roleLabel)}` : null,
              `${tt('inspect.degree')}: ${node.data('degree') ?? 0}`,
            ].filter(Boolean);
            tip.innerHTML = lines.join('<br/>');
            const pos = node.renderedPosition();
            tip.style.left = `${pos.x}px`;
            tip.style.top = `${pos.y}px`;
            tip.hidden = false;
          }
        });
        cy.on('mouseout', 'node', () => {
          cy.elements().removeClass('faded nbr-hl hover');
          if (containerRef.current) containerRef.current.style.cursor = 'default';
          hideTooltip();
        });
        // Any pan/zoom invalidates the tooltip anchor — just hide it.
        cy.on('pan zoom drag', hideTooltip);

        // Repaint the community hulls on every render tick so they track pan/zoom/
        // drag. Cheap no-op when nothing is selected/hovered (early return).
        cy.on('render', redrawHulls);

        // Keep the focus halo in sync: re-create it after every layout settles
        // (positions/sizes final) and move it live while the focus node is dragged.
        cy.on('layoutstop', () => syncFocusHalo(cy));
        cy.on('drag', 'node', (evt) => {
          const node = evt.target;
          if (!node.data('isFocus')) return;
          const halo = cy.getElementById(`${HALO_ID_PREFIX}${node.id()}`);
          if (!halo.empty()) halo.position(node.position());
        });

        cyRef.current = cy;

        // Keep the renderer in sync with the canvas size: when the
        // inspect panel opens/closes the canvas width changes, and without a
        // resize() cy.fit() would compute against stale dimensions → the graph
        // lands off-screen ("disappears" until a hover forces a redraw).
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          resizeObserver = new ResizeObserver(() => {
            cyRef.current?.resize();
          });
          resizeObserver.observe(containerRef.current);
        }

        setReady(true);
      });

      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        if (hullRafRef.current) { cancelAnimationFrame(hullRafRef.current); hullRafRef.current = 0; }
        if (offscreenRef.current) { offscreenRef.current.width = 0; offscreenRef.current.height = 0; offscreenRef.current = null; }
        cyRef.current?.destroy();
        cyRef.current = null;
        setReady(false);
      };
    }, []);

    // Replace elements + re-layout whenever the subgraph data changes.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy || !ready) return;
      const elements = data ? subgraphToElements(data.nodes, data.edges) : [];
      cy.batch(() => {
        cy.elements().remove();
        if (elements.length) cy.add(elements);
      });
      if (elements.length) {
        recomputeNodeVisuals(cy);
        applyColorMode(cy, colorMode);
        runLayout(cy, fcoseLayout);
      }
      // colorMode intentionally omitted — its own effect re-applies the lens
      // without forcing a re-layout on a mere recolor.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, ready]);

    // Recolor in place when the färb-lens toggles (no re-layout, just the class).
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy || !ready) return;
      applyColorMode(cy, colorMode);
    }, [colorMode, ready]);

    // Redraw hulls when the selection/hover (or data) changes — a selection change
    // alone doesn't trigger a cytoscape `render` tick.
    useEffect(() => {
      if (!ready) return;
      redrawHulls();
      // redrawHulls reads the latest selection/hover from refs; deps drive the call.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCommunity, hoveredCommunity, colorMode, data, ready]);

    // Client-side filters: toggle visibility only — no
    // re-layout, positions stay put. Type chips are a hard *exclusion* set
    // (deselected types are always hidden); the name and file filters are *soft*
    // — their non-matches are dimmed or hidden per `filterMode`. A node is a soft
    // non-match if it fails the name OR the file filter. The focus node is always
    // fully visible.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy || !ready) return;
      const nf = nameFilter.trim().toLowerCase();
      const excludedTypes = new Set(deselectedTypes);
      const nameActive = nf !== '';
      const fileActive = selectedFile !== null;
      const communityActive = selectedCommunity !== null;
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          // The focus node and its halo are always fully visible.
          if (n.data('isFocus') || n.hasClass('focus-halo')) {
            n.removeClass('filtered-hidden name-dimmed');
            return;
          }
          const typeHidden = excludedTypes.has(n.data('type') as string);
          const nameMatch = !nameActive || String(n.data('label') ?? '').toLowerCase().includes(nf);
          const fileMatch = !fileActive || n.data('file') === selectedFile;
          // A selected community keeps its members; the rest become soft non-matches.
          const communityMatch = !communityActive || n.data('community') === selectedCommunity;
          const softMatch = nameMatch && fileMatch && communityMatch;
          // Type exclusion always hides; a soft non-match dims or hides per mode.
          const hidden = typeHidden || (!softMatch && filterMode === 'hide');
          const dimmed = !hidden && !softMatch && filterMode === 'dim';
          n.toggleClass('filtered-hidden', hidden);
          n.toggleClass('name-dimmed', dimmed);
        });
        // An edge follows its endpoints: hidden if either is hidden (no dangling
        // arrows), otherwise dimmed if either endpoint is dimmed.
        cy.edges().forEach((e) => {
          const s = e.source();
          const t = e.target();
          const hide = s.hasClass('filtered-hidden') || t.hasClass('filtered-hidden');
          e.toggleClass('filtered-hidden', hide);
          e.toggleClass('name-dimmed', !hide && (s.hasClass('name-dimmed') || t.hasClass('name-dimmed')));
        });
      });
    }, [nameFilter, selectedFile, filterMode, deselectedTypes, selectedCommunity, data, ready]);

    return (
      <div className="explorer-graph-canvas-host">
        <canvas ref={hullCanvasRef} className="explorer-hull-canvas" aria-hidden="true" />
        <div ref={containerRef} className="explorer-graph-canvas" role="img" aria-label="Graph" />
        <div ref={tooltipRef} className="explorer-graph-tooltip" hidden />
      </div>
    );
  },
);

ExplorerGraph.displayName = 'ExplorerGraph';

/** Reconstruct a partial GraphNode from cytoscape node data (for the inspect panel). */
function nodeFromData(d: Record<string, unknown>): GraphNode {
  return {
    id: d.id as string,
    uuid: (d.uuid as string) ?? (d.id as string),
    label: (d.label as string) ?? '',
    type: (d.type as string) ?? '',
    file: (d.file as string | null) ?? null,
    depth: (d.depth as number) ?? 0,
    degree: (d.degree as number) ?? 0,
    isHub: Boolean(d.isHub),
    isFocus: Boolean(d.isFocus),
    community: (d.community as number | null) ?? null,
    communityName: (d.communityName as string | null) ?? null,
  };
}
