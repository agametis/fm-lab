import { API_BASE } from '../config/apiBase';

/**
 * fm-spec Schema-Viewer API-Client.
 *
 * Rein lesende Endpoints der Referenz-DB (`fm_reference.duckdb`). Plain fetch
 * wie der Rest des Frontends — kein react-query. Alle Antworten degradieren
 * definiert, wenn die generativen Tabellen fehlen (Referenz < 1.2.0):
 * `grammarAvailable=false`, Grammatik-Blöcke `null`.
 */

const API = `${API_BASE}/api`;

/** Local help URLs are API-relative (`/api/reference/help/…`) → prefix with the API base. */
export function resolveHelpHref(localHelpUrl: string | null, helpUrl: string | null): string | null {
  if (localHelpUrl) return `${API_BASE}${localHelpUrl}`;
  return helpUrl;
}

type Envelope<T> = { success: boolean; data: T; meta?: Record<string, unknown>; error?: { message?: string } };

async function getJson<T>(url: string): Promise<Envelope<T>> {
  const r = await fetch(url);
  const json: Envelope<T> = await r.json();
  if (!r.ok || !json.success) {
    throw new Error(json.error?.message || `HTTP ${r.status}`);
  }
  return json;
}

// ── Meta ─────────────────────────────────────────────────────────────────────

export interface ReferenceMeta {
  schema_version: string | null;
  filemaker_coverage: string | null;
  built_at: string | null;
  source_commit: string | null;
}

export interface FmSpecLocale {
  code: string;
  steps: number;
  functions: number;
  stepParameters: number;
}

export interface FmSpecMeta {
  referenceMeta: ReferenceMeta;
  counts: {
    scriptSteps: number;
    functions: number;
    stepLocales: number;
    functionLocales: number;
    grammarSteps: number;
  };
  locales: FmSpecLocale[];
  grammarAvailable: boolean;
}

export function fetchFmSpecMeta(): Promise<FmSpecMeta> {
  return getJson<FmSpecMeta>(`${API}/reference/meta`).then((j) => j.data);
}

// ── ScriptSteps-Liste ─────────────────────────────────────────────────────────

export interface RefCategory {
  id: number;
  slug: string;
  name: string;
  url: string | null;
}

export interface FmSpecStep {
  stepId: number;
  name: string;
  urlSlug: string;
  displayName: string;
  description: string | null;
  categoryId: number;
  originVersion: string | null;
  hasGrammar: boolean;
  helpUrl: string | null;
  localHelpUrl: string | null;
}

export interface FmSpecStepsResult {
  steps: FmSpecStep[];
  categories: RefCategory[];
}

export function fetchFmSpecSteps(lang: string): Promise<FmSpecStepsResult> {
  return getJson<{ steps: FmSpecStep[]; categories: RefCategory[] }>(
    `${API}/reference/steps?lang=${encodeURIComponent(lang)}`,
  ).then((j) => ({ steps: j.data.steps, categories: j.data.categories }));
}

// ── Functions-Liste ───────────────────────────────────────────────────────────

export interface FmSpecFunction {
  functionId: number;
  name: string;
  opcode: string | null;
  returnType: string | null;
  originVersion: string | null;
  isGetFunction: boolean;
  urlSlug: string;
  displayName: string;
  signature: string | null;
  purpose: string | null;
  categoryId: number;
  helpUrl: string | null;
  localHelpUrl: string | null;
}

export interface FmSpecFunctionsResult {
  functions: FmSpecFunction[];
  categories: RefCategory[];
}

export function fetchFmSpecFunctions(lang: string): Promise<FmSpecFunctionsResult> {
  return getJson<{ functions: FmSpecFunction[]; categories: RefCategory[] }>(
    `${API}/reference/functions?lang=${encodeURIComponent(lang)}`,
  ).then((j) => ({ functions: j.data.functions, categories: j.data.categories }));
}

// ── Abschnitte 1+2: lokalisierte Step-Daten + Parameter (alle Sprachen) ───────

export interface StepLangParam {
  index: number;
  name: string | null;
  description: string | null;
}

export interface StepLangEntry {
  language: string;
  displayName: string;
  description: string | null;
  parameterText: string | null;
  helpUrl: string | null;
  localHelpUrl: string | null;
  parameters: StepLangParam[];
}

export interface StepAllLangs {
  stepId: number;
  canonicalName: string;
  urlSlug: string;
  categoryId: number;
  originVersion: string | null;
  langs: StepLangEntry[];
}

export function fetchStepLangs(idOrSlug: string | number): Promise<StepAllLangs> {
  return getJson<StepAllLangs>(
    `${API}/reference/steps/${encodeURIComponent(String(idOrSlug))}/langs`,
  ).then((j) => j.data);
}

// ── Grammatik (Abschnitte 3+4) ────────────────────────────────────────────────

export interface StepOptionValue {
  xmlValue: string;
  displayTextEn: string | null;
  /** Per-value evidence (fm_reference ≥ 1.7.0); null on older references. */
  evidence: string | null;
}

export interface StepOption {
  optionKey: string;
  optionType: string;
  required: boolean;
  displayLocation: string | null;
  displayLabelEn: string | null;
  trueText: string | null;
  falseText: string | null;
  omitWhenFalse: boolean;
  invertedLabel: boolean;
  xmlPath: string | null;
  sortOrder: number | null;
  evidence: string | null;
  verifiedVersion: string | null;
  values: StepOptionValue[];
}

export interface StepConstraint {
  constraintKind: string;
  detail: string | null;
  evidence: string | null;
  verifiedVersion: string | null;
}

export interface StepXmlMap {
  snippetTemplate: string;
  saxmlParamTypes: string | null;
  saxmlExample: string | null;
  elementOrder: string | null;
  evidence: string | null;
  verifiedVersion: string | null;
  notes: string | null;
}

export interface StepGrammar {
  stepId: number;
  canonicalName: string;
  available: boolean;
  xmlMap: StepXmlMap | null;
  options: StepOption[];
  constraints: StepConstraint[];
}

/** Returns `null` when no grammar row exists (or reference < 1.2.0). */
export function fetchStepGrammar(idOrSlug: string | number): Promise<StepGrammar | null> {
  return getJson<StepGrammar | null>(
    `${API}/reference/steps/${encodeURIComponent(String(idOrSlug))}/grammar`,
  ).then((j) => j.data);
}

// ── Function-Detail (bestehender Endpoint, content=full) ──────────────────────

export interface FunctionParameter {
  position: number;
  name: string | null;
  description: string | null;
  optional: boolean;
  variadic: boolean;
}

export interface FunctionDetail {
  functionId: number;
  name: string;
  canonicalName: string;
  returnType: string | null;
  returnTypeDisplay: string | null;
  originVersion: string | null;
  displayName: string;
  signature: string | null;
  description: string | null;
  purpose: string | null;
  notes: string | null;
  example1: string | null;
  categoryId: number;
  category: { id: number; slug: string; nameEn: string; name: string } | null;
  parameters: FunctionParameter[];
  helpUrl: string | null;
  localHelpUrl: string | null;
}

export function fetchFunctionDetail(idOrName: string | number, lang: string): Promise<FunctionDetail> {
  return getJson<FunctionDetail>(
    `${API}/reference/functions/${encodeURIComponent(String(idOrName))}?content=full&lang=${encodeURIComponent(lang)}`,
  ).then((j) => j.data);
}
