import type { PrimitiveComponent } from '../types';
import { Grid } from './Grid';
import { Card } from './Card';
import { Stack } from './Stack';
import { Row } from './Row';
import { KPI } from './KPI';
import { KPIStrip } from './KPIStrip';
import { List } from './List';
import { TileGrid } from './TileGrid';
import { Table } from './Table';
import { AutoTable } from './AutoTable';
import { MarkdownBlock } from './MarkdownBlock';
import { NavButton } from './NavButton';
import { Empty } from './Empty';
import { Spacer } from './Spacer';
import { UnknownPrimitive } from './UnknownPrimitive';
import { DocsInstallErrorBezel } from './DocsInstallErrorBezel';
import { DocsetInstallControl } from './DocsetInstallControl';
import { registerInlineControl } from './inlineControls';

const registry = new Map<string, PrimitiveComponent>();

export function registerPrimitive(name: string, component: PrimitiveComponent): void {
  registry.set(name, component);
}

export function getPrimitive(name: string): PrimitiveComponent {
  return registry.get(name) ?? UnknownPrimitive;
}

// Default-Registrierung
registerPrimitive('Grid', Grid);
registerPrimitive('Card', Card);
registerPrimitive('Stack', Stack);
registerPrimitive('Row', Row);
registerPrimitive('KPI', KPI);
registerPrimitive('KPIStrip', KPIStrip);
registerPrimitive('List', List);
registerPrimitive('TileGrid', TileGrid);
registerPrimitive('Table', Table);
registerPrimitive('AutoTable', AutoTable);
registerPrimitive('Markdown', MarkdownBlock);
registerPrimitive('NavButton', NavButton);
registerPrimitive('Empty', Empty);
registerPrimitive('Spacer', Spacer);
registerPrimitive('DocsInstallErrorBezel', DocsInstallErrorBezel);

// Inline-Controls (rendered inside List rows when rowTemplate.inlineControl is set)
registerInlineControl('docsInstall', DocsetInstallControl);
