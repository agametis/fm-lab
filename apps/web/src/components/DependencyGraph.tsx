import React, { useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import cytoscape from 'cytoscape';
// @ts-expect-error cytoscape-dagre has no type declarations
import dagre from 'cytoscape-dagre';
import type { FMObject, GroupedReferences } from '../types';
import { buildNavigablePath } from '../lib/navigation';

// Register dagre layout
cytoscape.use(dagre);

interface DependencyGraphProps {
  object: FMObject;
  references: GroupedReferences;
}

/** Map Object_Type to node color */
const typeColors: Record<string, string> = {
  Script: '#4fc3f7',
  Field: '#81c784',
  Layout: '#ffb74d',
  LayoutObject: '#ffb74d',
  BaseTable: '#e57373',
  TableOccurrence: '#e57373',
  CustomFunction: '#ce93d8',
  ValueList: '#f48fb1',
  Relationship: '#90a4ae',
};

const getTypeColor = (type: string): string => typeColors[type] ?? '#aaa';

const layoutOptions = {
  name: 'dagre',
  rankDir: 'TB',
  nodeSep: 60,
  rankSep: 80,
  edgeSep: 20,
  padding: 30,
  animate: false,
} as cytoscape.LayoutOptions;

const cytoscapeStyles: cytoscape.StylesheetStyle[] = [
  // Default node style
  {
    selector: 'node',
    style: {
      'label': 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': '11px',
      'font-family': 'system-ui, -apple-system, sans-serif',
      'color': '#fff',
      'text-wrap': 'wrap',
      'text-max-width': '140px',
      'width': 'label',
      'height': '36px',
      'padding-left': '14px',
      'padding-right': '14px',
      'shape': 'roundrectangle',
      'background-color': 'data(color)',
      'border-width': 1,
      'border-color': 'data(borderColor)',
      'text-outline-width': 0,
    } as unknown as cytoscape.Css.Node,
  },
  // Center node
  {
    selector: 'node[?isCenter]',
    style: {
      'background-color': '#646cff',
      'border-color': '#8b8fff',
      'border-width': 2,
      'font-weight': 'bold',
      'font-size': '12px',
      'color': '#fff',
    } as unknown as cytoscape.Css.Node,
  },
  // Navigable nodes (non-center)
  {
    selector: 'node[!isCenter]',
    style: {
      'cursor': 'pointer',
    } as unknown as cytoscape.Css.Node,
  },
  // Hovered node
  {
    selector: 'node.hover',
    style: {
      'border-width': 2,
      'border-color': '#646cff',
    } as unknown as cytoscape.Css.Node,
  },
  // Edge style
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#555',
      'target-arrow-color': '#555',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'curve-style': 'bezier',
      'label': 'data(label)',
      'font-size': '9px',
      'color': '#888',
      'text-rotation': 'autorotate',
      'text-background-color': '#1a1a1a',
      'text-background-opacity': 0.85,
      'text-background-padding': '2px',
      'font-family': 'system-ui, -apple-system, sans-serif',
    } as unknown as cytoscape.Css.Edge,
  },
  // Cross-file edges highlighted
  {
    selector: 'edge[?isCrossFile]',
    style: {
      'line-color': '#ff9800',
      'target-arrow-color': '#ff9800',
      'line-style': 'dashed',
    } as unknown as cytoscape.Css.Edge,
  },
];

/**
 * DependencyGraph component
 * Renders an interactive Cytoscape.js graph showing object dependencies.
 * - Center node = current object (not navigable)
 * - Parent nodes = objects that reference this object (above)
 * - Child nodes = objects this object references (below)
 * - Tap on non-center node navigates to that object
 * - Drag on node moves it, drag on background pans, scroll zooms
 */
export const DependencyGraph: React.FC<DependencyGraphProps> = ({ object, references }) => {
  const { t } = useTranslation(['detail']);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const navigate = useNavigate();

  // Stable navigate ref to avoid re-creating cytoscape on every render
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const buildElements = useCallback((): cytoscape.ElementDefinition[] => {
    const elements: cytoscape.ElementDefinition[] = [];
    const addedNodes = new Set<string>();

    // Center node (current object)
    const centerUuid = object.Object_UUID;
    elements.push({
      data: {
        id: centerUuid,
        uuid: centerUuid,
        label: object.Object_Name || '(ohne Namen)',
        color: '#646cff',
        borderColor: '#8b8fff',
        objectType: object.Object_Type,
        fileName: object.File_Name,
        isCenter: true,
      },
    });
    addedNodes.add(centerUuid);

    // Parent nodes + edges (parent → center)
    for (const ref of references.parent) {
      if (!addedNodes.has(ref.uuid)) {
        const color = getTypeColor(ref.Object_Type);
        elements.push({
          data: {
            id: ref.uuid,
            uuid: ref.uuid,
            label: `${ref.Object_Name || '(ohne Namen)'}  \u2197`,
            color,
            borderColor: color,
            objectType: ref.Object_Type,
            fileName: ref.File_Name,
            isCenter: false,
            // Container-Resolution für Sub-Knoten (PRD prd_cross_references_hilite):
            // LayoutObjects öffnen ihren Container (Layout) mit Sub-Knoten als ref.
            containerUuid: ref.Container_UUID ?? null,
          },
        });
        addedNodes.add(ref.uuid);
      }
      elements.push({
        data: {
          id: `e-${ref.uuid}-${centerUuid}-${ref.Link_Role}`,
          source: ref.uuid,
          target: centerUuid,
          label: ref.Link_Role,
          isCrossFile: ref.Is_Cross_File,
        },
      });
    }

    // Child nodes + edges (center → child)
    for (const ref of references.child) {
      if (!addedNodes.has(ref.uuid)) {
        const color = getTypeColor(ref.Object_Type);
        elements.push({
          data: {
            id: ref.uuid,
            uuid: ref.uuid,
            label: `${ref.Object_Name || '(ohne Namen)'}  \u2197`,
            color,
            borderColor: color,
            objectType: ref.Object_Type,
            fileName: ref.File_Name,
            isCenter: false,
            // Container-Resolution für Sub-Knoten (PRD prd_cross_references_hilite):
            // LayoutObjects öffnen ihren Container (Layout) mit Sub-Knoten als ref.
            containerUuid: ref.Container_UUID ?? null,
          },
        });
        addedNodes.add(ref.uuid);
      }
      elements.push({
        data: {
          id: `e-${centerUuid}-${ref.uuid}-${ref.Link_Role}`,
          source: centerUuid,
          target: ref.uuid,
          label: ref.Link_Role,
          isCrossFile: ref.Is_Cross_File,
        },
      });
    }

    return elements;
  }, [object, references]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const elements = buildElements();

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cytoscapeStyles,
      layout: layoutOptions,
      minZoom: 0.3,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });

    // Tap on non-center node → navigate
    // Default: stay in graph view; with modifier key (Cmd/Ctrl): open in details view
    cy.on('tap', 'node[!isCenter]', (evt) => {
      const uuid = evt.target.data('uuid');
      if (!uuid) return;
      const containerUuid = (evt.target.data('containerUuid') as string | null) ?? null;
      const originalEvent = evt.originalEvent as MouseEvent;
      const useDetailsTab = originalEvent.metaKey || originalEvent.ctrlKey;
      // PRD §7.4 + Container-Resolution: Sub-Knoten (LayoutObject) öffnen ihren
      // Container mit Sub-Knoten als ref-Highlight. Eigenständige Objekte
      // navigieren direkt mit Center-Objekt als Origin.
      navigateRef.current(
        buildNavigablePath(uuid, object.Object_UUID, containerUuid, {
          tab: useDetailsTab ? null : 'graph',
        }),
      );
    });

    // Hover effects
    cy.on('mouseover', 'node[!isCenter]', (evt) => {
      evt.target.addClass('hover');
      if (containerRef.current) {
        containerRef.current.style.cursor = 'pointer';
      }
    });
    cy.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('hover');
      if (containerRef.current) {
        containerRef.current.style.cursor = 'default';
      }
    });

    // Tooltip via title attribute on canvas
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const type = node.data('objectType');
      const file = node.data('fileName');
      const isCenter = node.data('isCenter');
      const modKey = navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl';
      const tooltip = isCenter
        ? `${type} | ${file}`
        : `${type} | ${file}\nKlick = Graph | ${modKey}+Klick = Details`;
      containerRef.current?.setAttribute('title', tooltip);
    });
    cy.on('mouseout', 'node', () => {
      containerRef.current?.removeAttribute('title');
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [buildElements]);

  const handleFit = () => {
    cyRef.current?.fit(undefined, 30);
  };

  const handleResetLayout = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout(layoutOptions).run();
    cy.fit(undefined, 30);
  };

  // No references → show message instead of empty graph
  if (references.parent.length === 0 && references.child.length === 0) {
    return (
      <div className="tab-placeholder" role="status">
        <p>{t('detail:dependencyGraph.empty')}</p>
      </div>
    );
  }

  return (
    <div className="dependency-graph-wrapper">
      <div className="graph-controls">
        <button
          className="graph-control-button"
          onClick={handleFit}
          title={t('detail:dependencyGraph.fitTitle') as string}
          aria-label={t('detail:dependencyGraph.fitAria') as string}
        >
          {t('detail:dependencyGraph.fit')}
        </button>
        <button
          className="graph-control-button"
          onClick={handleResetLayout}
          title={t('detail:dependencyGraph.resetTitle') as string}
          aria-label={t('detail:dependencyGraph.resetAria') as string}
        >
          {t('detail:dependencyGraph.reset')}
        </button>
      </div>
      <div className="graph-legend">
        <span className="legend-item">
          <span className="legend-dot" style={{ background: '#646cff' }} /> {t('detail:dependencyGraph.legendCurrent')}
        </span>
        <span className="legend-item">
          <span className="legend-dot legend-dot-dashed" style={{ borderColor: '#ff9800' }} /> {t('detail:dependencyGraph.legendCrossFile')}
        </span>
        <span className="legend-hint">{t('detail:dependencyGraph.hint', {
          modKey: navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl',
          defaultValue: 'Click = navigate \u00b7 {{modKey}}+Click = details \u00b7 Drag = move',
        })}</span>
      </div>
      <div
        ref={containerRef}
        className="dependency-graph-container"
        role="img"
        aria-label={t('detail:dependencyGraph.graphAriaLabel', {
          object: object.Object_Name,
          defaultValue: 'Dependency graph for {{object}}',
        }) as string}
      />
    </div>
  );
};
