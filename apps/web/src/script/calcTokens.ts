// Calc-Token-Typen für CustomFunctions und Calculations (analog
// rest-api/src/formatters/tokens.formatter.js).
//
// Server-seitige Anreicherung über `?enrich=<lang>` fügt für
// Tokens mit `type: 'function'` zusätzliche Felder hinzu (Reference-DB).
// Diese sind optional, damit die Antwort ohne enrich byte-identisch bleibt.

export type CalcTokenType =
  | 'text'
  | 'function'
  | 'customFunction'
  | 'pluginFunction'
  | 'variable'
  | 'field'
  | 'comment';

export interface CalcToken {
  type: CalcTokenType;
  content: string;
  uuid?: string;
  scope?: 'local' | 'global' | 'superglobal';
  subFunction?: string;

  // Reference-DB Anreicherung (nur für type === 'function', wenn enrich=<lang> aktiv)
  functionId?: number;
  functionCanonical?: string;          // z.B. 'Average' oder 'Get' bei Get-Funktionen
  functionSubParameter?: string;       // z.B. 'FileName' bei Get(FileName)
  functionDisplayName?: string;        // lokalisierter Name (z.B. 'Mittelwert')
  functionSignature?: string;          // lokalisierte Signatur
  functionPurpose?: string;            // Kurzbeschreibung (1-Zeiler)
  functionReturnType?: string;
  functionUrlSlug?: string;
  functionHelpUrl?: string;            // Claris-Hilfe extern
  functionLocalHelpUrl?: string;       // Lokaler Mirror-Pfad
  functionChunkRole?: 'function' | 'getfunction' | 'getparameter';
  functionMatchSource?: string;
}

export interface CustomFunctionTokens {
  kind: 'customfunction';
  object: { uuid: string; name: string; file: string };
  parameters: string[];
  tokens: CalcToken[];
  plainText: string;
}

export interface CalculationTokens {
  kind: 'calculation';
  object: { hash?: string; uuid?: string };
  tokens: CalcToken[];
  plainText: string;
}

export interface FieldMeta {
  table: string | null;
  fieldType: string | null;
  dataType: string | null;
  isGlobal: boolean;
  maxRepetitions: number;
  comment: string | null;
  autoEnterType: string | null;
  /** Fester Vorgabewert bei AutoEnter_Type = 'ConstantData' (sonst null). */
  constantData: string | null;
}

export interface FieldTokens {
  kind: 'field';
  object: { uuid: string; name: string; file: string };
  field: FieldMeta | null;
  tokens: CalcToken[];
  plainText: string;
}

// Custom Menu: mehrere Berechnungen (Menü-eigene + pro-Item) als je ein Token-Block.
export interface CustomMenuCalcBlock {
  label: string;
  isStatic: boolean;
  tokens: CalcToken[];
  plainText: string;
}

export interface CustomMenuTokens {
  kind: 'custommenu';
  object: { uuid: string; name: string; file: string };
  calcs: CustomMenuCalcBlock[];
}
