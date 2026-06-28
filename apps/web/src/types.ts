import type { components } from '@packages/shared/types';

// Re-export commonly used types
export type FMObject = components['schemas']['FMObject'];
export type ObjectType = components['schemas']['ObjectType'];

/**
 * A reference item as returned by the /api/references endpoint (direction=all).
 * The actual API returns a flat array with a direction discriminator,
 * not the nested structure from the OpenAPI spec.
 *
 * Container_UUID/Container_Type sind für Sub-Knoten (LayoutObject, ScriptStep)
 * gesetzt — diese öffnen sich beim Klick im Container-View mit dem Sub-Knoten
 * als ref-Highlight. Für eigenständige Objekte sind beide Felder null.
 *
 * `navigable` ist false für step-eigene Referenzen (ScriptStep-Detail), deren
 * Ziel datei-extern nicht im importierten Datenbestand aufgelöst werden konnte —
 * sie werden als nicht-klickbarer Text gezeigt statt verschluckt. Fehlt das Feld
 * (alle Graph-basierten Referenzen), gilt das Ziel als navigierbar.
 */
export interface ReferenceItem {
  direction: 'parent' | 'child';
  uuid: string;
  Object_Type: string;
  Object_Name: string;
  File_Name: string;
  Link_Role: string;
  Is_Cross_File: boolean;
  Container_UUID?: string | null;
  Container_Type?: string | null;
  navigable?: boolean;
  /**
   * Nur Pseudo-Aggregat-Typen (ScriptStepType): Anzahl der Schritte dieses Typs,
   * die das Ziel referenzieren (bzw. Vorkommen des Schritts im Script). Dient als
   * Häufigkeits-Hinweis in der Referenzliste.
   */
  Call_Count?: number;
  /**
   * Nur Pseudo-Aggregat-Typen mit gesetztem `?ref=<origin>`: true, wenn diese
   * Referenz aus dem Herkunfts-Objekt heraus erreichbar ist (z.B. das Feld, das
   * der Schritt im Herkunfts-Script schreibt). Die UI pinnt/markiert solche Zeilen.
   */
  Origin_Hit?: boolean;
}

/**
 * Grouped references after client-side splitting.
 * Operational links (Script→Field, LayoutObject→Script, …) und strukturelle
 * Links (parent_folder, parent_object, parent_layout, …) werden parallel
 * geladen und getrennt dargestellt, damit Folder-Hierarchien sichtbar werden,
 * ohne den operationalen Kontext zu überladen.
 */
export interface GroupedReferences {
  parent: ReferenceItem[];
  child: ReferenceItem[];
  structuralParent: ReferenceItem[];
  structuralChild: ReferenceItem[];
}

/**
 * Breadcrumb item for navigation.
 */
export interface BreadcrumbItem {
  label: string;
  path: string | null; // null = current page (no link)
}

// Sort & Group options (Phase 3)
export type SortOption = 'standard' | 'name' | 'type' | 'file';
export type GroupOption = 'none' | 'type' | 'file';

export interface GroupHeader {
  _type: 'header';
  groupKey: string;
  groupLabel: string;
  itemCount: number;
  isExpanded: boolean;
}

export interface ListItemWrapper {
  _type: 'item';
  object: FMObject;
}

export type VirtualListRow = GroupHeader | ListItemWrapper;

// Detail View types (Phase 3b)
export type DetailViewTab = 'detail' | 'references' | 'graph' | 'versions' | 'notes';

export interface TabDefinition {
  id: DetailViewTab;
  label: string;
  enabled: boolean; // false = disabled/coming soon
}

/**
 * Sub-navigation tabs for the detail view.
 * Disabled tabs are shown but not clickable.
 */
/**
 * Sub-navigation tab definitions. The `label` carries the i18n key path inside
 * the `nav` namespace (e.g. `detailView.tabs.detail`). Consumers translate it
 * via `t(`nav:${tab.label}`)`.
 */
export const DETAIL_TABS: readonly TabDefinition[] = [
  { id: 'detail',     label: 'detailView.tabs.detail',     enabled: true },
  { id: 'references', label: 'detailView.tabs.references', enabled: true },
  { id: 'graph',      label: 'detailView.tabs.graph',      enabled: true },
  { id: 'versions',   label: 'detailView.tabs.versions',   enabled: false },
  { id: 'notes',      label: 'detailView.tabs.notes',      enabled: false },
];

/**
 * Object types that have a type-specific detail view available.
 * Used by ObjectDetail to determine heading text.
 */
export const DETAIL_VIEW_TYPES: ReadonlySet<string> = new Set([
  'Script',
  'Layout',
  'Field',
  'BaseTable',
  'CustomFunction',
  'ValueList',
]);
