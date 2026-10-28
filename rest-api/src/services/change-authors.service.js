const db = require('../config/database');
const annoDb = require('../config/annotations-db');

/**
 * Autoren der Änderungs-Metadaten und ihre kuratierten Aliase.
 *
 * Die Autoren (ein Eintrag je Author_Key) liest die API aus der TEMP-View
 * v_change_meta_authors der Katalogverbindung; die Aliase stehen im
 * Annotations-Sidecar (ChangeAuthorAlias) und überleben so einen Force-Rebuild.
 * Nach jedem Schreiben baut die API das Overlay der Lösung neu auf.
 *
 * Ein Alias trifft einen Schlüssel ohne Groß-/Kleinschreibung und Randleerzeichen
 * (Raw_Value ~ Author_Key) und setzt — jeweils optional — die Ziel-Person
 * (Author_Key, um Schreibvarianten zusammenzuführen), den Anzeigenamen und
 * „technischer Autor ja/nein". Je (Kind, normalisiertem Raw_Value) gibt es höchstens
 * einen Eintrag.
 */

/** BigInt → Number für die JSON-Serialisierung (Listen bleiben Listen). */
function convertBigInts(value) {
  if (Array.isArray(value)) return value.map(convertBigInts);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = typeof v === 'bigint' ? Number(v) : convertBigInts(v);
    return out;
  }
  return value;
}

const esc = (s) => String(s).replace(/'/g, "''");
const lit = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${esc(v)}'`);
const boolLit = (v) => (v === null || v === undefined ? 'NULL' : (v ? 'TRUE' : 'FALSE'));
const norm = (v) => String(v).trim().toLowerCase();

/** Autoren der Lösung (Katalog) + alle gespeicherten Aliase (Sidecar). */
async function listChangeAuthors(ctx) {
  const authors = await db.executeQuery(
    ctx,
    `SELECT a.Author_Key, a.Person_Key, a.Display_Name, a.Is_Technical, a.Author_Kind,
            a.Is_Curated, a.Raw_Names, a.Accounts, a.Stamps, a.Single_Stamps, a.Files,
            CAST(a.First_At AS VARCHAR) AS First_At, CAST(a.Last_At AS VARCHAR) AS Last_At
     FROM v_change_meta_authors a
     ORDER BY a.Stamps DESC, a.Author_Key`
  );
  const aliases = await annoDb.query(
    ctx,
    `SELECT Raw_Value, Kind, Author_Key, Display_Name, Is_Technical,
            CAST(Updated_At AS VARCHAR) AS Updated_At
     FROM ChangeAuthorAlias
     ORDER BY Kind, lower(trim(Raw_Value))`
  );
  return {
    authors: convertBigInts(authors.rows),
    aliases: convertBigInts(aliases),
  };
}

async function deleteAliasRows(ctx, kind, rawValue) {
  await annoDb.run(
    ctx,
    `DELETE FROM ChangeAuthorAlias
     WHERE Kind = ${lit(kind)} AND lower(trim(Raw_Value)) = ${lit(norm(rawValue))}`
  );
}

/**
 * Alias setzen (UPSERT). Sind Ziel-Person, Anzeigename und Is_Technical alle
 * leer, entfällt der Eintrag — der Schlüssel fällt auf die Import-Werte zurück.
 */
async function setChangeAuthorAlias(ctx, { rawValue, kind = 'user', authorKey, displayName, isTechnical }) {
  const person = authorKey ? norm(authorKey) : null;
  const display = displayName ? String(displayName).trim() : null;
  const technical = isTechnical === undefined ? null : isTechnical;
  await deleteAliasRows(ctx, kind, rawValue);
  const empty = !person && !display && technical === null;
  if (!empty) {
    await annoDb.run(
      ctx,
      `INSERT INTO ChangeAuthorAlias (Raw_Value, Kind, Author_Key, Display_Name, Is_Technical)
       VALUES (${lit(String(rawValue).trim())}, ${lit(kind)}, ${lit(person)}, ${lit(display)}, ${boolLit(technical)})`
    );
  }
  await db.refreshChangeAuthorOverlay(ctx);
  return {
    raw_value: String(rawValue).trim(),
    kind,
    author_key: empty ? null : person,
    display_name: empty ? null : display,
    is_technical: empty ? null : technical,
    removed: empty,
  };
}

/** Alias entfernen. */
async function deleteChangeAuthorAlias(ctx, { rawValue, kind = 'user' }) {
  await deleteAliasRows(ctx, kind, rawValue);
  await db.refreshChangeAuthorOverlay(ctx);
  return { raw_value: String(rawValue).trim(), kind, removed: true };
}

module.exports = { listChangeAuthors, setChangeAuthorAlias, deleteChangeAuthorAlias };
