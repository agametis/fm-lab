/**
 * Navigation-Helper für Cross-Reference Highlight.
 *
 * Klick-Quellen, die zwischen Objekten springen (Referenzen-Tab, RefSpan,
 * LayoutCanvas Cross-Nav, DependencyGraph, CF-Token-Links, RG-Doppelklick),
 * hängen `?ref=<currentObjectUuid>` an. Der Ziel-View liest den Param und
 * blendet einen Origin-Indikator ein, der die Back-References hervorhebt.
 *
 * `currentUuid` darf weggelassen werden — z.B. bei der initialen Suche oder
 * wenn kein Origin sinnvoll ist; dann wird kein `ref` angehängt.
 *
 * Klon-Disambiguierung (`file`): Geklonte/modulare FileMaker-Dateien teilen sich
 * dieselbe Object_UUID, d.h. die bare UUID ist nicht mehr global eindeutig
 * (REST liefert sonst `AMBIGUOUS_UUID` 409). Die Objekt-Identität ist deshalb das
 * Paar (UUID, File_Name); `file` reitet als zweiter Identitäts-Begleiter auf
 * derselben Query-Param-Maschinerie wie `ref`. Fehlt `file`, gilt Graceful
 * Downgrade (bare UUID, unverändertes Verhalten auf klonfreien Lösungen).
 */

export type ObjectPathExtras = Record<string, string | null | undefined>;

/**
 * Baut einen `/object/<uuid>`-Pfad mit optionalem Origin-, File- und Zusatz-Parametern.
 *
 * - `originUuid` wird als `ref`-Query-Param angehängt (Cross-Reference Highlight).
 * - `file` wird als `file`-Query-Param angehängt (Klon-Disambiguierung). Leeres /
 *   `null` / `undefined` → kein Param ⇒ Graceful Downgrade auf bare-UUID.
 * - `extras` erlauben zusätzliche Query-Params (z.B. `tab=graph`); `null`/`undefined`
 *   Werte werden ignoriert, damit Aufrufer nicht selbst filtern müssen.
 *
 * Hinweis: `originUuid === targetUuid` wird verworfen — kein Self-Highlight.
 */
export function buildObjectPath(
  targetUuid: string,
  originUuid?: string | null,
  file?: string | null,
  extras?: ObjectPathExtras,
): string {
  const params = new URLSearchParams();
  if (originUuid && originUuid !== targetUuid) {
    params.set('ref', originUuid);
  }
  if (file) {
    params.set('file', file);
  }
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (v == null || v === '') continue;
      params.set(k, v);
    }
  }
  const qs = params.toString();
  return qs ? `/object/${targetUuid}?${qs}` : `/object/${targetUuid}`;
}

/**
 * Container-aware Navigation für Sub-Knoten.
 *
 * Sub-Knoten wie LayoutObject oder ScriptStep haben keinen sinnvollen Standalone-
 * Detail-View — ihr Wert liegt im Container-Kontext. Wenn ein Reference-Item
 * (oder Graph-Node) einen `containerUuid` mitführt, wird transparent der
 * Container geöffnet und der Sub-Knoten als ref-Highlight gesetzt.
 *
 * Fallback (kein containerUuid): identisch zu `buildObjectPath(targetUuid, originUuid, file)`.
 *
 * Beispiel — Klick auf LayoutObject im Script-Referenzen-Tab:
 *   buildNavigablePath('<layoutobject>', '<script>', '<layout>', '<file>')
 *   → '/object/<layout>?ref=<layoutobject>&file=<file>'   (Layout öffnet sich, LayoutObject highlighted)
 *
 * Beispiel — Klick auf Field im Script-Referenzen-Tab:
 *   buildNavigablePath('<field>', '<script>', null, '<file>')
 *   → '/object/<field>?ref=<script>&file=<file>'          (normales Verhalten)
 */
export function buildNavigablePath(
  targetUuid: string,
  originUuid?: string | null,
  containerUuid?: string | null,
  file?: string | null,
  extras?: ObjectPathExtras,
): string {
  if (containerUuid && containerUuid !== targetUuid) {
    // Sub-Knoten → Container öffnen, Sub-Knoten als ref. Der ursprüngliche
    // Origin (originUuid) geht in dem Fall verloren — der spezifische Treffer
    // (Sub-Knoten) ist die nützlichere Hervorhebung. Browser-Back führt zurück.
    // `file` gilt für den geöffneten Container; Container und Sub-Knoten liegen
    // per Definition in derselben Datei, also ist es dieselbe File_Name.
    return buildObjectPath(containerUuid, targetUuid, file, extras);
  }
  return buildObjectPath(targetUuid, originUuid, file, extras);
}

/**
 * Vereinfachte Variante für Layout-Vollbild (`/layout/:uuid`) — gleiches Schema
 * inkl. `file`-Klon-Disambiguierung (siehe buildObjectPath).
 */
export function buildLayoutPath(
  layoutUuid: string,
  originUuid?: string | null,
  file?: string | null,
  extras?: ObjectPathExtras,
): string {
  const params = new URLSearchParams();
  if (originUuid && originUuid !== layoutUuid) {
    params.set('ref', originUuid);
  }
  if (file) {
    params.set('file', file);
  }
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (v == null || v === '') continue;
      params.set(k, v);
    }
  }
  const qs = params.toString();
  return qs ? `/layout/${layoutUuid}?${qs}` : `/layout/${layoutUuid}`;
}
