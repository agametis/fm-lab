import { useTranslation } from 'react-i18next';
import { getTypeColor } from '../lib/graphColors';
import type { GraphNode } from '../hooks/useSubgraph';

/**
 * Inspect panel for the selected graph node.
 *
 * Shows the node's metadata and its neighbors *currently in the graph* (derived
 * from the loaded edges — no extra round-trip) plus the primary actions:
 * open in DetailView, set as focus, expand one hop (fetches & merges), and —
 * for hubs — collapse the fan-out.
 */

export type InspectNeighbor = {
  node: GraphNode;
  role: string;
  /** `out` = selected → neighbor (uses); `in` = neighbor → selected (used by). */
  direction: 'out' | 'in';
};

interface ExplorerInspectPanelProps {
  node: GraphNode;
  neighbors: InspectNeighbor[];
  expanding: boolean;
  onClose: () => void;
  onOpenDetails: (uuid: string, file?: string | null) => void;
  onSetFocus: (uuid: string, file?: string | null) => void;
  /** Lazy-Expand: rohe uuid + file (Klon-Disambiguierung des Nachbar-Fetch). */
  onExpand: (uuid: string, file?: string | null) => void;
  /** Hub-Collapse: composite Graph-Key (node.id), reine Cytoscape-Operation. */
  onCollapse: (graphId: string) => void;
  onSelectNeighbor: (node: GraphNode) => void;
}

export function ExplorerInspectPanel(props: ExplorerInspectPanelProps) {
  const { node, neighbors, expanding, onClose, onOpenDetails, onSetFocus, onExpand, onCollapse, onSelectNeighbor } = props;
  const { t } = useTranslation(['explorer', 'common']);

  return (
    <aside className="explorer-inspect-panel" aria-label={t('inspect.ariaLabel') as string}>
      <div className="explorer-inspect-head">
        <span className="explorer-type-dot" style={{ background: getTypeColor(node.type) }} />
        <h2 className="explorer-inspect-title" title={node.label}>{node.label}</h2>
        <button type="button" className="explorer-inspect-close" onClick={onClose} aria-label={t('common:back') as string}>
          ✕
        </button>
      </div>

      <dl className="explorer-inspect-meta">
        <div><dt>{t('inspect.type')}</dt><dd>{node.type}</dd></div>
        {node.file && <div><dt>{t('inspect.file')}</dt><dd>{node.file}</dd></div>}
        <div><dt>{t('inspect.degree')}</dt><dd>{node.degree}</dd></div>
        <div><dt>{t('inspect.depth')}</dt><dd>{node.depth}</dd></div>
        {node.isHub && <div><dt>{t('inspect.role')}</dt><dd>{t('inspect.hub')}</dd></div>}
        {node.communityName && <div><dt>{t('inspect.community')}</dt><dd>{node.communityName}</dd></div>}
      </dl>

      <div className="explorer-inspect-actions">
        <button type="button" className="explorer-inspect-action primary" onClick={() => onSetFocus(node.uuid, node.file ?? null)} disabled={node.isFocus}>
          {t('inspect.setFocus')}
        </button>
        <button type="button" className="explorer-inspect-action" onClick={() => onExpand(node.uuid, node.file ?? null)} disabled={expanding}>
          {expanding ? t('inspect.expanding') : t('inspect.expand')}
        </button>
        {node.isHub && (
          <button type="button" className="explorer-inspect-action" onClick={() => onCollapse(node.id)}>
            {t('inspect.collapseHub')}
          </button>
        )}
        <button type="button" className="explorer-inspect-action" onClick={() => onOpenDetails(node.uuid, node.file ?? null)}>
          {t('inspect.openDetails')}
        </button>
      </div>

      <div className="explorer-inspect-neighbors">
        <h3>{t('inspect.neighbors', { count: neighbors.length })}</h3>
        {neighbors.length === 0 ? (
          <p className="explorer-inspect-empty">{t('inspect.noNeighbors')}</p>
        ) : (
          <ul>
            {neighbors.map(({ node: n, role, direction }) => (
              <li key={`${direction}-${n.id}-${role}`}>
                <button type="button" className="explorer-neighbor" onClick={() => onSelectNeighbor(n)}>
                  <span className="explorer-neighbor-dir" title={direction === 'out' ? t('inspect.uses') as string : t('inspect.usedBy') as string}>
                    {direction === 'out' ? '→' : '←'}
                  </span>
                  <span className="explorer-type-dot" style={{ background: getTypeColor(n.type) }} />
                  <span className="explorer-neighbor-label" title={n.label}>{n.label}</span>
                  <span className="explorer-neighbor-role">{role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
