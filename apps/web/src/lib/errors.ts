/**
 * True when an API/template error indicates that the DuckDB catalog is missing
 * a data table or analysis view that only comes into existence after an XML
 * import — i.e. no FileMaker solution has been imported yet. The base tables
 * (FilesCatalog, …) exist on a fresh DB, but the derived analysis views
 * (FolderHierarchy, ClusterEdges, …) are built by the import pipeline. Data-
 * driven entry pages therefore crash with a catalog error before any import.
 *
 * DuckDB emits this message in English regardless of the UI locale, so a plain
 * string match is stable across languages.
 */
export function isNoImportError(error: string | null | undefined): boolean {
  if (!error) return false;
  // Schema-Drift (befüllte, aber veraltete Lösung) darf NICHT als „noch kein
  // Import" durchgehen — der Backend-Klassifikator veredelt solche Fälle vorab zu
  // SCHEMA_DRIFT. Falls doch eine rohe „Table … does not exist"-Meldung eines
  // gedrifteten Katalogs durchrutscht, hat die Drift-Erkennung Vorrang.
  if (isSchemaDriftError(error)) return false;
  return /Table with name\s+\S+\s+does not exist/i.test(error);
}

/**
 * True when the backend flagged the active solution's catalog as out of date
 * relative to what the app's templates expect (schema drift). The backend emits
 * a stable, English, `SCHEMA_DRIFT:`-prefixed message regardless of UI locale, so
 * a plain prefix match is stable across languages — and survives the string-only
 * error propagation of the detail hooks (which discard the structured code).
 */
export function isSchemaDriftError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /^SCHEMA_DRIFT:/.test(error);
}

/**
 * True when the backend flagged a query as failing only because the plugin
 * reference database (reference/plugin_spec.duckdb, ATTACHed as 'plugref') is
 * not installed. The backend emits a stable, English, `PLUGSPEC_MISSING:`-
 * prefixed message regardless of UI locale (same contract as SCHEMA_DRIFT);
 * matched non-anchored because dataset errors may arrive wrapped.
 */
export function isPlugSpecMissingError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /PLUGSPEC_MISSING:/.test(error);
}

/**
 * Pulls the two catalog versions out of a SCHEMA_DRIFT message for display
 * ("imported with 1.11.0, app expects 1.12.1"). Either side may be null when the
 * backend could not determine it. Returns null when the message is not a drift
 * message.
 */
export function parseSchemaDrift(
  error: string | null | undefined
): { dbVersion: string | null; appVersion: string | null } | null {
  if (!isSchemaDriftError(error)) return null;
  const m = /catalog schema\s+(\S+)\s+but the app expects\s+([\d.]+)/i.exec(error as string);
  return {
    dbVersion: m ? m[1] : null,
    appVersion: m ? m[2] : null,
  };
}
