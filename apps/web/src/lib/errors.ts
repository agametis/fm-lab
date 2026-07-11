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
  return /Table with name\s+\S+\s+does not exist/i.test(error);
}
