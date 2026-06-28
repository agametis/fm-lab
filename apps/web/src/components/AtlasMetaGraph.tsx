import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { getTypeColor, readGraphThemeTokens } from '../lib/graphColors';
import { useTheme } from '../hooks/useTheme';
import type { AtlasMetaNode, AtlasMetaEdge } from '../hooks/useGraphOverview';

/**
 * Cytoscape meta-graph for the Atlas „Topologie"-Achse (B): one super-node per
 * segment (Community/Datei), edges = aggregated inter-segment coupling. Reuses
 * the Graph Explorer's lazy fcose registration + the shared type-color palette;
 * default export so the view can `React.lazy()` it together with the Cytoscape
 * bundle (kept out of the main bundle).
 *
 * Click a super-node → the parent hands off to the Graph Explorer focused on the
 * segment's heaviest member (`top_member_uuid`/`file`). The grey „Rest" node has
 * no member → it is inert.
 */

// fcose has no bundled types; register it once, lazily (mirrors ExplorerGraph).
let fcoseReady: Promise<void> | null = null;
function ensureFcose(): Promise<void> {
  if (!fcoseReady) {
    fcoseReady = import('cytoscape-fcose').then((mod) => {
      cytoscape.use((mod as { default?: cytoscape.Ext }).default ?? (mod as unknown as cytoscape.Ext));
    });
  }
  return fcoseReady;
}

const REST_COLOR = '#5a5a66';
const NODE_MIN_PX = 18;
const NODE_RANGE_PX = 52;
const EDGE_MIN_PX = 0.6;
const EDGE_RANGE_PX = 6;

/**
 * Theme-aware Stylesheet (F1): aus den `--color-graph-*`-Tokens gebaut. Cytoscape
 * kennt keine CSS-Vars → die Tokens werden hier JS-seitig aufgelöst und das
 * Stylesheet bei jedem Theme-Wechsel via `cy.style()` neu gesetzt (ohne Re-Layout).
 * Die Rest-Super-Node bekommt ihre Füllung aus dem Token (überschreibt data(color)).
 */
function buildStylesheet(): cytoscape.StylesheetStyle[] {
  const g = readGraphThemeTokens();
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 3,
        'font-size': '10px',
        'font-family': 'system-ui, -apple-system, sans-serif',
        color: g.nodeLabel,
        'text-outline-width': 2,
        'text-outline-color': g.nodeOutline,
        'text-wrap': 'wrap',
        'text-max-width': '120px',
        width: 'data(sizePx)',
        height: 'data(sizePx)',
        shape: 'ellipse',
        'background-color': 'data(color)',
        'border-width': 1.5,
        'border-color': 'data(color)',
        cursor: 'pointer',
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node[?isRest]',
      style: {
        'border-style': 'dashed',
        'border-color': '#9a9aa8',
        'background-color': g.rest,
        cursor: 'default',
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'edge',
      style: {
        width: 'data(widthPx)',
        'line-color': g.edge,
        'curve-style': 'bezier',
        'target-arrow-shape': 'none',
        opacity: 0.7,
      } as unknown as cytoscape.Css.Edge,
    },
    {
      selector: '.meta-dimmed',
      style: { opacity: 0.15 } as unknown as cytoscape.Css.Node,
    },
  ];
}

const fcoseLayout = {
  name: 'fcose',
  quality: 'default',
  animate: false,
  randomize: true,
  nodeRepulsion: 14000,
  idealEdgeLength: 130,
  nodeSeparation: 120,
  gravity: 0.2,
  packComponents: true,
  padding: 40,
} as unknown as cytoscape.LayoutOptions;

function toElements(nodes: AtlasMetaNode[], edges: AtlasMetaEdge[]): cytoscape.ElementDefinition[] {
  const maxW = Math.max(1, ...nodes.map((n) => n.weight));
  const maxE = Math.max(1, ...edges.map((e) => e.weight));
  const keys = new Set(nodes.map((n) => n.key));
  const els: cytoscape.ElementDefinition[] = nodes.map((n) => {
    const isRest = n.kind === 'rest' || n.key === '__rest__';
    return {
      data: {
        id: n.key,
        label: n.label,
        weight: n.weight,
        memberCount: n.member_count,
        sizePx: Math.round(NODE_MIN_PX + NODE_RANGE_PX * Math.sqrt(n.weight / maxW)),
        color: isRest ? REST_COLOR : n.color_type ? getTypeColor(n.color_type) : REST_COLOR,
        isRest,
        uuid: n.top_member_uuid ?? null,
        file: n.top_member_file ?? null,
      },
    };
  });
  for (const e of edges) {
    if (!keys.has(e.source) || !keys.has(e.target)) continue;
    els.push({
      data: {
        id: `${e.source}|${e.target}`,
        source: e.source,
        target: e.target,
        weight: e.weight,
        widthPx: EDGE_MIN_PX + EDGE_RANGE_PX * (e.weight / maxE),
      },
    });
  }
  return els;
}

type Props = {
  nodes: AtlasMetaNode[];
  edges: AtlasMetaEdge[];
  onNodeClick: (node: AtlasMetaNode) => void;
  /** Sekundäre Aktion (Rechtsklick): „(...)"-Panel für die Super-Node öffnen. */
  onNodeInfo?: (node: AtlasMetaNode) => void;
  filterText?: string;
};

export default function AtlasMetaGraph({ nodes, edges, onNodeClick, onNodeInfo, filterText }: Props) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // Cytoscape wird async erzeugt (ensureFcose().then). `ready` flippt nach der
  // Erzeugung → der Element-Swap-Effekt läuft dann erneut, auch wenn die Daten
  // schon beim ersten (cy-losen) Mount-Lauf vorlagen. Ohne das bleibt der
  // Meta-Graph bei Direkt-Aufruf von ?view=topology leer, bis ein sig-Wechsel
  // (Segment-Toggle) den Effekt erneut auslöst.
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onNodeClick);
  clickRef.current = onNodeClick;
  const infoRef = useRef(onNodeInfo);
  infoRef.current = onNodeInfo;
  const nodeByKey = useRef<Map<string, AtlasMetaNode>>(new Map());
  nodeByKey.current = new Map(nodes.map((n) => [n.key, n]));

  const elements = useMemo(() => toElements(nodes, edges), [nodes, edges]);
  // Re-layout only when the element set actually changes (not on filter typing).
  const sig = useMemo(
    () => elements.map((e) => `${e.data.id}:${(e.data as { weight?: number }).weight ?? ''}`).join('|'),
    [elements],
  );

  // Mount: create the instance once; tap handler reads stale-safe refs.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    ensureFcose().then(() => {
      if (disposed || !containerRef.current) return;
      const cy = cytoscape({
        container: containerRef.current,
        elements: [],
        style: buildStylesheet(),
        minZoom: 0.1,
        maxZoom: 3,
        wheelSensitivity: 0.3,
      });
      cy.on('tap', 'node', (evt) => {
        const node = nodeByKey.current.get(evt.target.id());
        if (node) clickRef.current(node);
      });
      // Rechtsklick = „(...)"-Panel (Rest-Node hat nichts zu annotieren → ignorieren).
      cy.on('cxttap', 'node', (evt) => {
        const node = nodeByKey.current.get(evt.target.id());
        if (node && node.kind !== 'rest' && infoRef.current) infoRef.current(node);
      });
      cyRef.current = cy;
      setReady(true);
      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        ro = new ResizeObserver(() => cyRef.current?.resize());
        ro.observe(containerRef.current);
      }
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      cyRef.current?.destroy();
      cyRef.current = null;
      setReady(false);
    };
  }, []);

  // Swap elements + run layout when the data signature changes (oder sobald die
  // async erzeugte cy-Instanz bereitsteht → behebt das Leer-bei-Direktaufruf).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    cy.add(elements);
    cy.resize();
    const bb = { x1: 0, y1: 0, w: Math.max(cy.width(), 400), h: Math.max(cy.height(), 400) };
    const layout = cy.layout({ ...fcoseLayout, boundingBox: bb } as cytoscape.LayoutOptions);
    layout.one('layoutstop', () => {
      cy.resize();
      cy.fit(undefined, 40);
    });
    layout.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ready]);

  // F1: bei Theme-Wechsel das Stylesheet aus den neuen Tokens neu setzen (kein
  // Re-Layout — Positionen bleiben). Initial setzt der Mount buildStylesheet().
  useEffect(() => {
    cyRef.current?.style(buildStylesheet());
  }, [theme]);

  // Local name filter (E6): dim non-matches without re-layout.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = (filterText ?? '').trim().toLowerCase();
    cy.batch(() => {
      if (!q) {
        cy.elements().removeClass('meta-dimmed');
        return;
      }
      cy.nodes().forEach((n) => {
        const hit = String(n.data('label') ?? '').toLowerCase().includes(q);
        n.toggleClass('meta-dimmed', !hit);
      });
      cy.edges().addClass('meta-dimmed');
    });
    // ready: nach dem initialen (ready-getriggerten) Element-Swap erneut anwenden.
  }, [filterText, sig, ready]);

  return <div ref={containerRef} className="atlas-metagraph" />;
}
