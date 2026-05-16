import type { LayoutNode, DatasetResult } from '../api/dashboardApi';
import type { NavigateFunction } from 'react-router-dom';

/**
 * Gemeinsame Props für alle Primitive-Komponenten.
 * Ein Primitive entscheidet selbst, ob es das Dataset als Single-Row (KPI, Card-Header)
 * oder Multi-Row (List, Table, TileGrid) verwendet.
 */
export interface PrimitiveProps {
  node: LayoutNode;
  /** Das ans Primitive gebundene Dataset (über node.data.dataset). */
  dataset?: DatasetResult;
  /**
   * Die "aktuelle Zeile" für Token-Substitution. Bei Containern leer; bei
   * repeating Primitives setzt das Primitive selbst pro Iteration ihre row.
   */
  row?: Record<string, unknown>;
  /** Alle Datasets des Dashboards — für Lookups durch verschachtelte Primitives. */
  datasets: Record<string, DatasetResult>;
  /** Renderer für Children (rekursive Layout-Walk). */
  renderChildren: (children: LayoutNode[] | undefined, row?: Record<string, unknown>) => React.ReactNode;
  /** Navigations-Hook. */
  navigate: NavigateFunction;
}

export type PrimitiveComponent = React.ComponentType<PrimitiveProps>;
