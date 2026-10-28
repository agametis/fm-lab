/**
 * Kandidaten-Matrix für die Zeile „Nicht referenziert“ im Referenzen-Tab.
 *
 * Ein Kandidat beschreibt eine Referenz, die ein Objekt des Fokustyps haben
 * KÖNNTE: Richtung (`in` = eingehend, `out` = ausgehend) × Typgruppe (Gegentypen,
 * die dieselbe Frage beantworten) × Rollenmenge. Erfüllt ist er, sobald in der
 * Richtung mindestens eine Kante zu einem Typ der Gruppe mit einer Rolle aus der
 * Menge existiert — rollen-genau, nicht typ-genau (die `parent_layout`-Kanten der
 * eigenen Layout-Objekte zählen z.B. nicht als Navigation auf das Layout).
 *
 * Die Matrix ist Präsentations-Policy, keine Katalog-Semantik: kuratiert nach
 * Erwartbarkeit (das Fehlen muss beim typischen Vertreter eine Aussage sein, kein
 * Normalfall), ohne Containment-/Restriktions-Rollen, ohne Singletons
 * (`default_layout`, `auto_login_account`) und ohne Satelliten-Spiegel
 * (`trigger_script`). Kandidaten ergänzen oder streichen heißt: nur diese Datei
 * ändern. Der Service prüft jede Rolle zur Laufzeit gegen `LinkRoleRegistry`.
 *
 * Felder eines Kandidaten:
 *   direction  'in' | 'out'
 *   types      Typgruppe; ein Treffer auf einen der Typen erfüllt den Kandidaten
 *   roles      Kandidaten-Rollen
 *   when       optionales Gating-Prädikat auf den Subtyp des Fokus
 *              ({ subtype: [...] }); bei unbekanntem Subtyp entfällt das Gating
 *   aggregate  true = Quellmenge ist Fokus + Aggregat-Mitglieder (AGGREGATES)
 *   caveat     Schlüssel eines Vorbehalts (Tooltip-Hinweis im Frontend)
 *   excludedRoles  Rollen, die für dieses Typ-Paar vorkommen, den Kandidaten
 *              aber bewusst NICHT erfüllen. Wirkt nur im Drift-Test (jede
 *              andere vorkommende Usage-Rolle außerhalb von `roles` schlägt
 *              dort fehl); der Service wertet das Feld nicht aus.
 */

// Feld-Rollen der Script-Steps (Set Field, Find, Sort, Import/Export, …).
const SCRIPT_FIELD_ROLES = [
  'sets_field', 'reads_field', 'finds_in_field', 'sorts_by_field',
  'imports_to_field', 'exports_from_field', 'inputs_to_field',
  'navigates_to_field', 'references_field',
];

// Feld-Rollen der Oberfläche: Anzeige plus die Feld-Rollen der Button-Steps.
const UI_FIELD_ROLES = [
  'displays_field', 'reads_field', 'sorts_by_field', 'navigates_to_field',
  'sets_field', 'exports_from_field',
];

// Formel-Abhängigkeiten zwischen Feldern (Formel, Lookup, Statistik, Validierung).
const FIELD_FIELD_ROLES = ['reads_field', 'lookup_source', 'summarizes_field', 'validates_by_calc'];

// LayoutObject-Subtypen (LayoutObjects.Object_Type), die ein Feld darstellen …
const FIELD_CONTROLS = [
  'Edit Box', 'Drop-down List', 'Pop-up Menu', 'Checkbox Set', 'Radio Button Set',
  'Drop-down Calendar', 'Container', 'Concealed Edit Box',
];
// … bzw. eine Werteliste brauchen.
const LIST_CONTROLS = ['Drop-down List', 'Pop-up Menu', 'Checkbox Set', 'Radio Button Set'];

const CANDIDATES = {
  Script: [
    { direction: 'in', types: ['Script'], roles: ['calls_script'], caveat: 'scriptCallers' },
    // Oberflächen-Einstiege: Button-Aktion, Trigger-Spiegel (Objekt/Layout/Datei)
    // und Custom-Menü-Aktion beantworten dieselbe Frage — eine Gruppe.
    {
      direction: 'in',
      types: ['LayoutObject', 'Layout', 'File', 'CustomMenuItem'],
      roles: ['triggers_script'],
      caveat: 'scriptCallers',
    },
    { direction: 'out', types: ['Script'], roles: ['calls_script'] },
    { direction: 'out', types: ['Field'], roles: SCRIPT_FIELD_ROLES },
    { direction: 'out', types: ['Layout'], roles: ['navigates_to_layout'] },
    { direction: 'out', types: ['Variable'], roles: ['sets_variable', 'reads_variable'] },
    { direction: 'out', types: ['CustomFunction'], roles: ['calls_customfunction'] },
    { direction: 'out', types: ['PluginFunction'], roles: ['calls_pluginfunction'] },
  ],
  Layout: [
    { direction: 'in', types: ['Script', 'LayoutObject'], roles: ['navigates_to_layout'] },
    { direction: 'out', types: ['Field'], roles: UI_FIELD_ROLES, aggregate: true },
    { direction: 'out', types: ['Script'], roles: ['triggers_script'], aggregate: true },
    { direction: 'out', types: ['Variable'], roles: ['reads_variable', 'displays_variable'], aggregate: true },
    { direction: 'out', types: ['CustomFunction'], roles: ['calls_customfunction'], aggregate: true },
    { direction: 'out', types: ['PluginFunction'], roles: ['calls_pluginfunction'], aggregate: true },
    { direction: 'out', types: ['ValueList'], roles: ['uses_valuelist', 'sorts_by_valuelist'], aggregate: true },
  ],
  // Nur die Bindung des Steuerelements zählt: ein Feldobjekt ohne Feld bzw. ein
  // Listen-Steuerelement ohne Werteliste ist der Befund. Button-Steps und Formeln
  // desselben Objekts (Set Field, Sortieren nach Werteliste, …) erfüllen ihn nicht.
  LayoutObject: [
    {
      direction: 'out',
      types: ['Field'],
      roles: ['displays_field'],
      when: { subtype: FIELD_CONTROLS },
      excludedRoles: ['reads_field', 'sets_field', 'sorts_by_field', 'navigates_to_field', 'exports_from_field'],
    },
    {
      direction: 'out',
      types: ['ValueList'],
      roles: ['uses_valuelist'],
      when: { subtype: LIST_CONTROLS },
      excludedRoles: ['sorts_by_valuelist'],
    },
  ],
  Field: [
    { direction: 'in', types: ['Script'], roles: SCRIPT_FIELD_ROLES },
    { direction: 'in', types: ['LayoutObject', 'Layout'], roles: UI_FIELD_ROLES },
    { direction: 'in', types: ['Field'], roles: FIELD_FIELD_ROLES },
  ],
  TableOccurrence: [
    { direction: 'in', types: ['Layout'], roles: ['context_table'], caveat: 'toFieldAccess' },
    { direction: 'in', types: ['Relationship'], roles: ['left_table', 'right_table'] },
  ],
  BaseTable: [
    { direction: 'in', types: ['TableOccurrence'], roles: ['base_table'] },
  ],
  ValueList: [
    { direction: 'in', types: ['LayoutObject'], roles: ['uses_valuelist', 'sorts_by_valuelist'] },
  ],
  CustomFunction: [
    { direction: 'in', types: ['Script'], roles: ['calls_customfunction'] },
    { direction: 'in', types: ['Field'], roles: ['calls_customfunction'] },
    { direction: 'in', types: ['LayoutObject'], roles: ['calls_customfunction'] },
    { direction: 'in', types: ['CustomFunction'], roles: ['calls_customfunction'] },
  ],
  BuiltinFunction: [
    { direction: 'in', types: ['Script'], roles: ['calls_function'] },
    { direction: 'in', types: ['Field'], roles: ['calls_function'] },
    { direction: 'in', types: ['LayoutObject'], roles: ['calls_function', 'displays_symbol'] },
    { direction: 'in', types: ['CustomFunction'], roles: ['calls_function'] },
  ],
  PluginFunction: [
    { direction: 'in', types: ['Script'], roles: ['calls_pluginfunction'] },
    { direction: 'in', types: ['Field'], roles: ['calls_pluginfunction'] },
    { direction: 'in', types: ['LayoutObject'], roles: ['calls_pluginfunction'] },
    { direction: 'in', types: ['CustomFunction'], roles: ['calls_pluginfunction'] },
  ],
  Variable: [
    {
      direction: 'in',
      types: ['Script'],
      roles: ['sets_variable', 'reads_variable'],
      when: { subtype: ['local', 'global', 'superglobal'] },
    },
    // Lokale $-Variablen leben nur im Script — ein Layout-Objekt kann sie nicht lesen.
    {
      direction: 'in',
      types: ['LayoutObject'],
      roles: ['reads_variable', 'displays_variable'],
      when: { subtype: ['global', 'superglobal'] },
    },
  ],
  Theme: [
    { direction: 'in', types: ['Layout'], roles: ['uses_theme'] },
  ],
  CustomMenuSet: [
    { direction: 'in', types: ['Layout', 'Script'], roles: ['uses_menuset', 'installs_menuset'] },
  ],
  CustomMenu: [
    // contains_menu ist Containment, hier aber die eigentliche Verwendung des Menüs.
    { direction: 'in', types: ['CustomMenuSet', 'CustomMenuItem'], roles: ['contains_menu', 'opens_menu'] },
  ],
  PrivilegeSet: [
    { direction: 'in', types: ['Account'], roles: ['privilege_set'] },
  ],
  ExtendedPrivilege: [
    { direction: 'in', types: ['PrivilegeSet'], roles: ['grants_privilege'] },
  ],
  ExternalDataSource: [
    { direction: 'in', types: ['TableOccurrence', 'ValueList', 'Script'], roles: ['data_source'] },
  ],
};

/**
 * Rollen, die NICHT als `usage` mit Where-used-Flag registriert sind, aber
 * bewusst als Kandidaten-Rolle gelten (siehe CustomMenu).
 */
const ROLE_EXCEPTIONS = ['contains_menu'];

/**
 * Subtyp-Quelle je Fokustyp (für `when.subtype`).
 *   match 'uuid_file' → Zeile über (Object_UUID, File_Name) des Fokus
 *   match 'variable'  → Zeile über die kanonische Variablen-UUID
 *                       md5(Variable_Scope::Scope_Anchor::Variable_Name)
 */
const SUBTYPE_SOURCES = {
  LayoutObject: { table: 'LayoutObjects', column: 'Object_Type', match: 'uuid_file' },
  Variable: { table: 'VariablesCatalog', column: 'Variable_Scope', match: 'variable' },
};

/**
 * Aggregat je Fokustyp: Kandidaten mit `aggregate: true` werten zusätzlich die
 * Kanten der Mitglieder aus — Quellen der `role`-Kanten auf den Fokus vom Typ
 * `via`, datei-gleich. Ein nur dort erfüllter Kandidat bekommt `indirect`.
 */
const AGGREGATES = {
  Layout: { via: 'LayoutObject', role: 'parent_layout' },
};

module.exports = {
  CANDIDATES,
  ROLE_EXCEPTIONS,
  SUBTYPE_SOURCES,
  AGGREGATES,
};
