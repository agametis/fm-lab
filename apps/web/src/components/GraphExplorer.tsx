import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ExplorerFilterPanel, type CommunityLegendItem } from './ExplorerFilterPanel';
import { ExplorerGraph, type ExplorerGraphHandle, type FilterMode, type ColorMode } from './ExplorerGraph';
import { ExplorerInspectPanel, type InspectNeighbor } from './ExplorerInspectPanel';
import {
  useSubgraph,
  fetchNeighbors,
  type GraphNode,
  type SubgraphDirection,
} from '../hooks/useSubgraph';
import { getCommunityColor } from '../lib/graphColors';
import '../views/GraphExplorerView.css';

/**
 * Graph Explorer engine — the reusable workhorse shared by the standalone route
 * (`/graph`, see GraphExplorerView) and the embedded object-view tab
 * (`/object/:uuid?tab=graph`, see ObjectGraphPanel).
 *
 * It owns the client-side lens state (name/file/type filters, inspect panel) and
 * the Cytoscape interaction, and renders the filter panel + canvas + inspect
 * panel (`.graph-explorer-body`). Traversal params (focus/depth/direction/mode)
 * are *controlled* by the parent so each host can decide how they're persisted
 * (URL deep-link vs. local state) and what a re-focus means (re-center in place
 * vs. route to a new object). The parent renders its own toolbar/header and
 * drives the graph via the exposed handle; live counts arrive via `onStats`.
 */

export interface GraphExplorerHandle {
  fit: () => void;
  relayout: () => void;
  exportPng: () => string | null;
  /** Clear active soft filters (name). Returns true if something was cleared. */
  clearTransientFilters: () => boolean;
}

export interface GraphExplorerStats {
  nodeCount: number;
  edgeCount: number;
  totalReachable: number;
  truncated: boolean;
  /** Distinct communities present in the current graph (0 if unclustered). */
  communityCount: number;
  /** Label of the focus node (for the host's PNG filename / heading). */
  focusLabel: string | null;
}

interface GraphExplorerProps {
  focus: string | null;
  depth: number;
  direction: SubgraphDirection;
  onDepthChange: (d: number) => void;
  onDirectionChange: (d: SubgraphDirection) => void;
  /** Re-center request (double-tap / inspect "set focus"). */
  onSetFocus: (uuid: string) => void;
  /** ⌘/Ctrl-tap / inspect "open details". */
  onOpenDetails: (uuid: string) => void;
  /** Live graph stats for the host's toolbar (null while empty). */
  onStats?: (stats: GraphExplorerStats | null) => void;
  /**
   * Enable the community color lens — a Type↔Community recolor toggle
   * plus a community legend. Standalone `/graph` only; the embedded object-view
   * panel omits it (no legend room). Off → nodes are always type-colored.
   */
  enableCommunityLens?: boolean;
}

export const GraphExplorer = forwardRef<GraphExplorerHandle, GraphExplorerProps>(
  (props, ref) => {
    const {
      focus, depth, direction,
      onDepthChange, onDirectionChange,
      onSetFocus, onOpenDetails, onStats,
      enableCommunityLens = false,
    } = props;
    // The graph always uses the "logical" view (container-hoisted operational
    // links). The "raw" granularity exposed only isolated, non-navigable
    // ScriptStep nodes, so its GUI control was removed; the backend param stays
    // available for power users via the direct API.
    const mode = 'logical';
    const { t } = useTranslation(['explorer', 'common']);
    const graphRef = useRef<ExplorerGraphHandle>(null);

    // Client-side lenses: name/file/type filters act on the
    // already-loaded subgraph — no re-fetch. Type chips are a hard exclusion set;
    // the name + file filters are soft and share one dim/hide mode (default: dim).
    const [deselectedTypes, setDeselectedTypes] = useState<string[]>([]);
    const [nameFilter, setNameFilter] = useState('');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [filterMode, setFilterMode] = useState<FilterMode>('dim');
    const [colorMode, setColorMode] = useState<ColorMode>('type');
    // Community lens interaction: a selected community gets a colored hull +
    // dims/hides the others; a hovered legend entry transiently previews its hull.
    const [selectedCommunity, setSelectedCommunity] = useState<number | null>(null);
    const [hoveredCommunity, setHoveredCommunity] = useState<number | null>(null);
    const [focusLabel, setFocusLabel] = useState<string | null>(null);

    // Inspect panel state.
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [expanding, setExpanding] = useState(false);

    // Only focus/depth/direction/mode hit the backend — type filtering is client-side.
    const { data, loading, error } = useSubgraph({ focus, depth, direction, mode });

    // Read the latest name filter from a ref so the imperative handle (mount-only)
    // can clear it without being re-created on every keystroke.
    const nameFilterRef = useRef(nameFilter);
    nameFilterRef.current = nameFilter;

    useImperativeHandle(ref, () => ({
      fit: () => graphRef.current?.fit(),
      relayout: () => graphRef.current?.relayout(),
      exportPng: () => graphRef.current?.exportPng() ?? null,
      clearTransientFilters: () => {
        if (nameFilterRef.current) {
          setNameFilter('');
          return true;
        }
        return false;
      },
    }), []);

    // Derive the focus label from the loaded graph and reconcile the inspected
    // node + file filter against the fresh data.
    useEffect(() => {
      if (!data) return;
      const focusNode = data.nodes.find((n) => n.isFocus);
      if (focusNode) setFocusLabel(focusNode.label);
      setSelectedNode((prev) => (prev ? data.nodes.find((n) => n.id === prev.id) ?? null : null));
      setSelectedFile((prev) => (prev && data.nodes.some((n) => n.file === prev) ? prev : null));
      setSelectedCommunity((prev) => (prev !== null && data.nodes.some((n) => n.community === prev) ? prev : null));
      setHoveredCommunity(null);
    }, [data]);

    // Report stats to the host toolbar.
    useEffect(() => {
      onStats?.(
        data
          ? {
              nodeCount: data.stats.nodeCount,
              edgeCount: data.stats.edgeCount,
              totalReachable: data.stats.totalReachable,
              truncated: data.truncated,
              communityCount: new Set(
                data.nodes.filter((n) => n.community !== null).map((n) => n.community),
              ).size,
              focusLabel: data.nodes.find((n) => n.isFocus)?.label ?? null,
            }
          : null,
      );
    }, [data, onStats]);

    // Clicking a chip toggles its type in the *exclusion* set (deselect = hide).
    const handleToggleType = useCallback((type: string) => {
      setDeselectedTypes((prev) =>
        prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type],
      );
    }, []);

    // Type chips: counts from the current graph, unioned with any deselected types.
    const availableTypes = useMemo(() => {
      const counts = new Map<string, number>();
      for (const n of data?.nodes ?? []) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
      for (const ty of deselectedTypes) if (!counts.has(ty)) counts.set(ty, 0);
      return [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    }, [data, deselectedTypes]);

    // File filter options — distinct files present in the current graph.
    const availableFiles = useMemo(() => {
      const set = new Set<string>();
      for (const n of data?.nodes ?? []) if (n.file) set.add(n.file);
      return [...set].sort((a, b) => a.localeCompare(b));
    }, [data]);

    // Community legend — distinct communities in the current graph with
    // their palette color, display name and member count (most populous first).
    const availableCommunities = useMemo<CommunityLegendItem[]>(() => {
      const m = new Map<number, { name: string | null; count: number }>();
      for (const n of data?.nodes ?? []) {
        if (n.community === null) continue;
        const cur = m.get(n.community);
        if (cur) cur.count++;
        else m.set(n.community, { name: n.communityName, count: 1 });
      }
      return [...m.entries()]
        .map(([id, v]) => ({ id, name: v.name, count: v.count, color: getCommunityColor(id) }))
        .sort((a, b) => b.count - a.count || a.id - b.id);
    }, [data]);

    // The lens is only meaningful when clustering data is present in this graph.
    const communityLensActive = enableCommunityLens && availableCommunities.length > 0;
    const effectiveColorMode: ColorMode = communityLensActive ? colorMode : 'type';

    // Don't strand the lens on a graph without community data — revert to type.
    useEffect(() => {
      if (!communityLensActive && colorMode === 'community') setColorMode('type');
    }, [communityLensActive, colorMode]);

    // Leaving community color mode clears any community selection/hover.
    useEffect(() => {
      if (colorMode !== 'community') {
        setSelectedCommunity(null);
        setHoveredCommunity(null);
      }
    }, [colorMode]);

    // Click a legend entry → toggle that community as the selected one.
    const handleSelectCommunity = useCallback((id: number) => {
      setSelectedCommunity((prev) => (prev === id ? null : id));
    }, []);

    // Neighbors of the inspected node, derived from the loaded edges (no fetch).
    const neighbors = useMemo<InspectNeighbor[]>(() => {
      if (!data || !selectedNode) return [];
      const byId = new Map(data.nodes.map((n) => [n.id, n]));
      const seen = new Set<string>();
      const out: InspectNeighbor[] = [];
      for (const e of data.edges) {
        let otherId: string | null = null;
        let dir: 'out' | 'in' | null = null;
        if (e.source === selectedNode.id) { otherId = e.target; dir = 'out'; }
        else if (e.target === selectedNode.id) { otherId = e.source; dir = 'in'; }
        if (!otherId || !dir) continue;
        const key = `${dir}-${otherId}-${e.role}`;
        if (seen.has(key)) continue;
        const otherNode = byId.get(otherId);
        if (!otherNode) continue;
        seen.add(key);
        out.push({ node: otherNode, role: e.role, direction: dir });
      }
      return out.sort((a, b) => a.node.label.localeCompare(b.node.label));
    }, [data, selectedNode]);

    const handleSelectNeighbor = useCallback((n: GraphNode) => {
      setSelectedNode(n);
      graphRef.current?.highlightNode(n.id);
    }, []);

    const handleExpand = useCallback(
      async (uuid: string) => {
        setExpanding(true);
        try {
          // Fetch the full neighborhood — type filtering happens client-side.
          const { nodes, edges } = await fetchNeighbors(uuid, { direction, mode });
          graphRef.current?.mergeElements(nodes, edges);
        } catch {
          // Expansion is best-effort; a failed merge leaves the graph untouched.
        } finally {
          setExpanding(false);
        }
      },
      [direction, mode],
    );

    const handleCollapse = useCallback((uuid: string) => {
      graphRef.current?.collapseHub(uuid);
    }, []);

    return (
      <div className="graph-explorer-body">
        <ExplorerFilterPanel
          focusLabel={focusLabel}
          nameFilter={nameFilter}
          selectedFile={selectedFile}
          filterMode={filterMode}
          depth={depth}
          direction={direction}
          deselectedTypes={deselectedTypes}
          availableTypes={availableTypes}
          availableFiles={availableFiles}
          showColorMode={communityLensActive}
          colorMode={colorMode}
          communities={availableCommunities}
          selectedCommunity={selectedCommunity}
          onNameFilterChange={setNameFilter}
          onSelectedFileChange={setSelectedFile}
          onFilterModeChange={setFilterMode}
          onColorModeChange={setColorMode}
          onSelectCommunity={handleSelectCommunity}
          onHoverCommunity={setHoveredCommunity}
          onDepthChange={onDepthChange}
          onDirectionChange={onDirectionChange}
          onToggleType={handleToggleType}
        />

        <main className="graph-explorer-canvas-wrap">
          {data?.truncated && (
            <div className="graph-explorer-banner" role="status">
              {t('explorer:truncated', {
                kept: data.stats.nodeCount,
                total: data.stats.totalReachable,
              })}
            </div>
          )}

          {!focus && (
            <div className="graph-explorer-placeholder">
              <p>{t('explorer:emptyFocus')}</p>
            </div>
          )}

          {focus && error && (
            <div className="graph-explorer-error">{t('common:loadError', { message: error })}</div>
          )}

          {focus && !error && loading && !data && (
            <div className="graph-explorer-placeholder">{t('explorer:loading')}</div>
          )}

          {focus && !error && (
            <ExplorerGraph
              ref={graphRef}
              data={data}
              nameFilter={nameFilter}
              selectedFile={selectedFile}
              filterMode={filterMode}
              deselectedTypes={deselectedTypes}
              colorMode={effectiveColorMode}
              selectedCommunity={communityLensActive ? selectedCommunity : null}
              hoveredCommunity={communityLensActive ? hoveredCommunity : null}
              onSetFocus={onSetFocus}
              onOpenDetails={onOpenDetails}
              onSelectNode={setSelectedNode}
            />
          )}

          {loading && data && <div className="graph-explorer-loading-pill">{t('explorer:loading')}</div>}
        </main>

        {selectedNode && (
          <ExplorerInspectPanel
            node={selectedNode}
            neighbors={neighbors}
            expanding={expanding}
            onClose={() => {
              setSelectedNode(null);
              graphRef.current?.highlightNode(null);
            }}
            onOpenDetails={onOpenDetails}
            onSetFocus={onSetFocus}
            onExpand={handleExpand}
            onCollapse={handleCollapse}
            onSelectNeighbor={handleSelectNeighbor}
          />
        )}
      </div>
    );
  },
);

GraphExplorer.displayName = 'GraphExplorer';
