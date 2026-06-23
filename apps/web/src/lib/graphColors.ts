/**
 * Shared object-type → color palette for the graph visualizations.
 *
 * Single source of truth for the Graph Explorer
 * ([ExplorerGraph.tsx](../components/ExplorerGraph.tsx)), used both on the
 * standalone `/graph` route and in the embedded object-view "Graph" tab
 * ([ObjectGraphPanel.tsx](../components/ObjectGraphPanel.tsx)). Colors are tuned
 * for a dark canvas, so both surfaces
 * stay visually consistent.
 */
export const typeColors: Record<string, string> = {
  Script:             '#4fc3f7',
  ScriptStep:         '#4fc3f7',
  Field:              '#81c784',
  Layout:             '#ffb74d',
  LayoutObject:       '#ffb74d',
  LayoutPart:         '#ffcc80',
  BaseTable:          '#e57373',
  TableOccurrence:    '#e57373',
  CustomFunction:     '#ce93d8',
  ValueList:          '#f48fb1',
  Relationship:       '#90a4ae',
  Variable:           '#fff176',
  Account:            '#a1887f',
  PrivilegeSet:       '#bcaaa4',
  CustomMenu:         '#80cbc4',
  Theme:              '#9fa8da',
  ScriptTrigger:      '#7986cb',
  ExternalDataSource: '#8d6e63',
  BuiltinFunction:    '#b0bec5',
  PluginFunction:     '#4db6ac',
};

/** Fallback color for object types not in the palette. */
export const DEFAULT_TYPE_COLOR = '#aaa';

/** Map an Object_Type to its node color (palette lookup with fallback). */
export const getTypeColor = (type: string): string => typeColors[type] ?? DEFAULT_TYPE_COLOR;

/**
 * Categorical palette for the community color lens (P5).
 *
 * Community ids are dense integers (Louvain yields 0..k); the explorer only ever
 * shows a handful at once in a focus subgraph, so a cycling 12-color palette
 * keeps adjacent communities distinguishable. Tuned for a
 * dark canvas — distinct hues, similar luminance.
 */
export const communityPalette: string[] = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ce93d8', '#f06292',
  '#4db6ac', '#fff176', '#9575cd', '#a1887f', '#90a4ae', '#aed581',
];

/** Color for nodes without a community assignment (unclustered). */
export const UNCLUSTERED_COLOR = '#5a5a66';

/** Map a community id to a stable palette color (cycling); null → unclustered gray. */
export const getCommunityColor = (community: number | null): string =>
  community === null || community === undefined
    ? UNCLUSTERED_COLOR
    : communityPalette[((community % communityPalette.length) + communityPalette.length) % communityPalette.length];
