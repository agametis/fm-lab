/**
 * Anzeige-Aufbereitung von ObjectCatalog-Namen.
 *
 * Hintergrund: PluginFunctions tragen im Katalog einen bewusst redundanten
 * Object_Name, aus dem sich die synthetische UUID ableitet
 * (vgl. sql/convert-xml/convert_xml_04_catalog.sql):
 *
 *   Container-Plugin (MBS):  `<Plugin>:<Sub>::<Sub>`   z.B. `MBS:FM.InsertRecord::FM.InsertRecord`
 *   Non-Container-Plugin:    `<Name>`                  (kein `::`)
 *
 * Der Katalogname MUSS so bleiben (UUID- und Namens-Joins hängen daran) — für
 * die reine Anzeige lösen wir ihn hier in den fachlichen Funktionsnamen
 * (`FM.InsertRecord`) und die Plugin-Komponente (`MBS`) auf.
 */

export interface PluginNameParts {
  /** Fachlicher Funktionsname, z.B. `FM.InsertRecord`. */
  name: string;
  /** Plugin-Namespace, z.B. `MBS` — null bei Non-Container-Plugins. */
  component: string | null;
}

/**
 * Zerlegt einen PluginFunction-Object_Name in Funktionsname + Komponente.
 * Robust gegen die redundante `<Plugin>:<Sub>::<Sub>`-Form: der SubName steht
 * immer hinter `::`, der Plugin-Namespace vor dem ersten `:`.
 */
export function parsePluginFunctionName(rawName: string): PluginNameParts {
  const sep = rawName.indexOf('::');
  if (sep === -1) {
    // Non-Container-Plugin: kein SubName-Suffix, Name unverändert.
    return { name: rawName, component: null };
  }
  const sub = rawName.slice(sep + 2);          // `FM.InsertRecord`
  const head = rawName.slice(0, sep);          // `MBS:FM.InsertRecord`
  const colon = head.indexOf(':');
  const component = colon === -1 ? null : head.slice(0, colon); // `MBS`
  return { name: sub || head, component };
}

/**
 * Liefert den anzuzeigenden Namen für ein Objekt. Für PluginFunctions wird der
 * redundante Katalogname auf den fachlichen Funktionsnamen reduziert; alle
 * anderen Objekttypen bleiben unverändert.
 */
export function formatObjectDisplayName(objectType: string, rawName: string): string {
  if (objectType === 'PluginFunction' && rawName) {
    return parsePluginFunctionName(rawName).name;
  }
  return rawName;
}
