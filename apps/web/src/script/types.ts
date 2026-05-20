// Script-Viewer Types — entspricht der Token-API (rest-api/src/formatters/tokens.formatter.js)

export type RefType =
  | 'field'
  | 'script'
  | 'layout'
  | 'customFunction'
  | 'pluginFunction'
  | 'function'        // Engine-Funktion (z.B. Average, JSONSetElement) — Calc-Ref
  | 'variable'
  | 'valueList'
  | 'tableOccurrence';

export type LineKind = 'step' | 'comment' | 'empty';

export type VariableScope = 'local' | 'global' | 'superglobal';
export type VariableUsage = 'set' | 'read';

export interface ScriptRef {
  type: RefType;
  name: string;
  uuid?: string;
  file?: string;
  table?: string;
  baseTable?: string;
  crossFile?: boolean;
  dataSource?: string;
  scope?: VariableScope;
  usage?: VariableUsage;
  subFunction?: string;

  // Reference-DB-Anreicherung für type === 'function' (nur mit ?enrich=<lang>)
  functionId?: number;
  functionCanonical?: string;
  functionSubParameter?: string;
  functionDisplayName?: string;
  functionSignature?: string;
  functionPurpose?: string;
  functionReturnType?: string;
  functionHelpUrl?: string;
  functionLocalHelpUrl?: string;
}

export interface ScriptLineToken {
  line: number;
  indent: number;
  kind: LineKind;
  enabled: boolean;
  stepId?: number;
  stepName?: string;
  text?: string;
  refs?: ScriptRef[];

  // ScriptStep-UUID aus StepsForScripts.Step_UUID — Identität des konkreten
  // Steps im aktuellen Script, für Cross-Reference-Highlight (PRD
  // prd_pseudo_object_types_filter.md §6.4: back_references liefert diese
  // UUIDs als Match-Set, wenn Origin=ScriptStepType).
  stepUuid?: string;

  // Synthetischer ScriptStepType-UUID (PRD §5) — für Cross-Navigation vom
  // Step-Namen zur ScriptStepType-Detail-Seite. Deterministisch via
  // md5('ScriptStepType::' || Step_Name).
  stepTypeUuid?: string;

  // ScriptStep-Reference (nur mit ?enrich=<lang>)
  stepDisplayName?: string;
  stepDescription?: string;
  stepHelpUrl?: string;
  stepLocalHelpUrl?: string;
  stepCategoryId?: number;
}

export interface ScriptTokens {
  kind: 'script';
  object: {
    uuid: string;
    name: string;
    file: string;
    // Nur bei ScriptStep-Detail gesetzt: Kontext zum übergeordneten Skript,
    // damit der Detail-Header eine Karte mit Sprung-Link rendern kann.
    parentScript?: { uuid: string; name: string; file: string };
    stepIndex?: number;
  };
  lines: ScriptLineToken[];
  plainText?: string;
}

export type FoldKind = 'if' | 'loop' | 'transaction' | 'multiline' | 'comment-block';

export interface FoldRange {
  startLine: number;
  endLine: number;
  kind: FoldKind;
}

export type ViewMode =
  | 'normal'
  | 'compact'
  | 'comments-only'
  | 'control-only'
  | 'subscript-only'
  | 'assignments-only'
  | 'executive-only';

export type MarginRole = 'comment' | 'metadata' | 'executive';
