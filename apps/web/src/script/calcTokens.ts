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

/** Fortlaufende Nummer (AutoEnter_Type='SerialNumber'). */
export interface FieldSerial {
  generate: string | null;   // OnCreation | OnCommit
  nextValue: string | null;
  increment: string | null;
}

/** Referenzwert / Lookup (AutoEnter_Type='Looked_up'). */
export interface FieldLookup {
  field: string | null;
  /** UUID + aufgelöste Zieldatei des Quellfelds (klickbarer Link); null = nur Text. */
  fieldUuid: string | null;
  fieldFile: string | null;
  /** Herkunfts-BaseTable des Quellfelds — disambiguiert gleichnamige Felder. */
  fieldTable: string | null;
  to: string | null;
  dontCopyIfEmpty: boolean;
  noMatch: string | null;    // DoNotCopy | ConstantData
}

/** Flags einer AutoEnter-Berechnung (AutoEnter_Type='Calculated'). */
export interface FieldAutoEnterCalc {
  overwriteExisting: boolean;
  alwaysEvaluate: boolean;
}

/** Überprüfung / Validierung (nur wenn eine echte Regel gesetzt ist). */
export interface FieldValidation {
  mode: string | null;       // Always | OnlyDuringDataEntry
  allowOverride: boolean;
  notEmpty: boolean;
  unique: boolean;
  existing: boolean;
  valueList: { name: string; uuid: string | null } | null;
  strictType: string | null; // Numeric | FourDigitYear | TimeOfDay
  maxChars: number | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  calcText: string | null;   // „Überprüfung durch Berechnung"
  message: string | null;    // eigene Fehlermeldung
}

/** Speicher / Indizierung. */
export interface FieldStorage {
  index: string | null;      // None | Minimal | All
  autoIndex: boolean;
  storeCalcResults: boolean;
  indexLanguage: string | null; // Standard-Indexsprache (nur bei indiziertem Feld)
  evaluatesWhenEmpty: boolean;  // Calc-Feld Nicht-Default: rechnet auch bei leeren Ref-Feldern (= alwaysEvaluate)
}

/** Statistikfeld (Field_Type='Summary'). */
export interface FieldSummary {
  operation: string | null;
  field: { name: string; uuid: string | null } | null;
  restartEachGroup: boolean;
  repetitionMode: string | null; // Together | Individually (null = Default Together)
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
  /** Änderung durch Benutzer gesperrt (AutoEnter_ProhibitMod). */
  prohibitModification: boolean;
  serial: FieldSerial | null;
  lookup: FieldLookup | null;
  autoEnterCalc: FieldAutoEnterCalc | null;
  validation: FieldValidation | null;
  storage: FieldStorage | null;
  summary: FieldSummary | null;
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
