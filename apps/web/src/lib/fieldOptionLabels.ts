/**
 * Gemeinsame Lokalisierung kanonischer FileMaker-Feldoptions-Enums.
 *
 * Einzige Quelle für die Anzeige-Labels der DB-Tokens (Feldtyp, Datentyp,
 * AutoEnter-Typ, Indizierung, Summary-Operation …). Wird sowohl vom
 * Feld-Detailview (FieldViewer) als auch von der Base-Table-Feldliste
 * (BaseTableViewer) genutzt, damit z.B. die Indizierung an beiden Stellen
 * identisch benannt ist.
 *
 * defaultValue = Rohwert ⇒ unbekannte/künftige Tokens fallen sauber auf den
 * DB-Token zurück statt eine leere Übersetzung zu zeigen.
 */
import type { TranslateFn } from './navigation';

/** Übersetzt einen Enum-Wert der Gruppe `group` über detail:fieldOptions.<group>.<value>. */
export const fieldOptionLabel = (
  t: TranslateFn,
  group: string,
  value: string | null | undefined,
): string => (value ? t(`detail:fieldOptions.${group}.${value}`, { defaultValue: value }) : '–');

/** Indizierung (None | Minimal | All) — gemeinsam für Feld- und Base-Table-View. */
export const indexLabel = (t: TranslateFn, value: string | null | undefined): string =>
  fieldOptionLabel(t, 'index', value);
