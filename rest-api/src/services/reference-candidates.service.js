const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const { resolveByUUID } = require('./object.service');
const {
  CANDIDATES,
  ROLE_EXCEPTIONS,
  SUBTYPE_SOURCES,
  AGGREGATES,
} = require('../config/reference-candidates');

/**
 * Referenz-Kandidaten eines Objekts („Nicht referenziert“-Zeile).
 *
 * Wertet die kuratierte Matrix aus `config/reference-candidates.js` für EIN
 * Fokus-Objekt aus und liefert je Kandidat den Status:
 *   present  — direkte Kante mit Kandidaten-Rolle
 *   indirect — nur über Aggregat-Mitglieder erfüllt (Layout → eigene Layout-Objekte)
 *   missing  — weder direkt noch über Mitglieder erfüllt
 * `direct`/`indirect` zählen distinkte Gegenobjekte, keine Kanten.
 *
 * Reiner Lesepfad auf ObjectLinks/ObjectCatalog; die Subtyp-Tabellen sind
 * optional (fehlt eine, entfällt das Gating, der Kandidat bleibt aktiv).
 */

// Pro Lösung gecacht (ctx.solution) und beim Reload geleert — ein Re-Import
// ändert Typ-Bestand, Registry und Schema.
const typeCountCache = new Map();
const registryCache = new Map();
const subtypeSourceCache = new Map();
const warnedRoles = new Set();

function clearReferenceCandidateCaches() {
  typeCountCache.clear();
  registryCache.clear();
  subtypeSourceCache.clear();
  warnedRoles.clear();
}

const cacheKey = (ctx) => ctx?.solution ?? '';

/** Objektanzahl je Object_Type der Lösung (Existenz-Filter). */
async function getTypeCounts(ctx) {
  const key = cacheKey(ctx);
  if (typeCountCache.has(key)) return typeCountCache.get(key);
  const result = await db.executeQuery(
    ctx,
    'SELECT Object_Type, count(*) AS n FROM ObjectCatalog GROUP BY Object_Type'
  );
  const counts = new Map(result.rows.map((r) => [r.Object_Type, Number(r.n)]));
  typeCountCache.set(key, counts);
  return counts;
}

/**
 * LinkRoleRegistry als Map Rolle → { kind, whereUsed }. `null`, wenn der
 * Katalog die Tabelle nicht trägt — dann entfällt die Gegenprüfung.
 */
async function getRoleRegistry(ctx) {
  const key = cacheKey(ctx);
  if (registryCache.has(key)) return registryCache.get(key);
  let registry = null;
  const exists = await db.executeQuery(
    ctx,
    "SELECT 1 AS ok FROM duckdb_tables() WHERE table_name = 'LinkRoleRegistry' LIMIT 1"
  );
  if (exists.rows.length > 0) {
    const result = await db.executeQuery(
      ctx,
      'SELECT Link_Role, Link_Kind, Counts_For_Where_Used FROM LinkRoleRegistry'
    );
    registry = new Map(result.rows.map((r) => [
      r.Link_Role,
      { kind: r.Link_Kind, whereUsed: r.Counts_For_Where_Used === true },
    ]));
  }
  registryCache.set(key, registry);
  return registry;
}

/** Trägt der Katalog Tabelle + Spalte der Subtyp-Quelle? (gecacht) */
async function hasSubtypeSource(ctx, source) {
  const key = `${cacheKey(ctx)}\u0000${source.table}.${source.column}`;
  if (subtypeSourceCache.has(key)) return subtypeSourceCache.get(key);
  const result = await db.executeQuery(
    ctx,
    'SELECT 1 AS ok FROM duckdb_columns() WHERE table_name = ? AND column_name = ? LIMIT 1',
    [source.table, source.column]
  );
  const ok = result.rows.length > 0;
  subtypeSourceCache.set(key, ok);
  return ok;
}

/**
 * Subtyp des Fokus laut SUBTYPE_SOURCES — `null`, wenn der Typ keine Quelle
 * hat, die Quelle im Katalog fehlt oder keine Zeile trifft.
 */
async function getFocusSubtype(ctx, focus) {
  const source = SUBTYPE_SOURCES[focus.Object_Type];
  if (!source || !(await hasSubtypeSource(ctx, source))) return null;
  let sql;
  let params;
  if (source.match === 'variable') {
    // Kanonische Variablen-UUID wie im Katalog (md5 aus Scope, Anker, Name).
    sql = `SELECT ${source.column} AS subtype FROM ${source.table}
           WHERE md5(Variable_Scope || '::' || Scope_Anchor || '::' || Variable_Name) = ?
           LIMIT 1`;
    params = [focus.Object_UUID];
  } else {
    sql = `SELECT ${source.column} AS subtype FROM ${source.table}
           WHERE Object_UUID = ? AND File_Name IS NOT DISTINCT FROM ?
           LIMIT 1`;
    params = [focus.Object_UUID, focus.File_Name];
  }
  const result = await db.executeQuery(ctx, sql, params);
  return result.rows[0]?.subtype ?? null;
}

/**
 * Kandidaten-Rollen gegen die Registry prüfen: zulässig sind Usage-Rollen mit
 * Where-used-Flag plus die explizit markierten Ausnahmen. Verworfene Rollen
 * werden einmal je Lösung geloggt.
 */
function filterRegisteredRoles(ctx, roles, registry) {
  if (!registry) return roles;
  return roles.filter((role) => {
    if (ROLE_EXCEPTIONS.includes(role)) return true;
    const entry = registry.get(role);
    const ok = !!entry && entry.kind === 'usage' && entry.whereUsed;
    if (!ok) {
      const warnKey = `${cacheKey(ctx)}\u0000${role}`;
      if (!warnedRoles.has(warnKey)) {
        warnedRoles.add(warnKey);
        console.warn(`[reference-candidates] role '${role}' is not a registered where-used usage role — dropped`);
      }
    }
    return ok;
  });
}

/**
 * VALUES-Liste (idx, Gegentyp, Rolle) über alle Kandidaten einer Richtung —
 * eine Presence-Query je Richtung statt einer je Kandidat.
 */
function candidateValues(entries) {
  const tuples = [];
  const params = [];
  for (const { idx, candidate } of entries) {
    for (const type of candidate.types) {
      for (const role of candidate.roles) {
        tuples.push('(CAST(? AS INTEGER), CAST(? AS VARCHAR), CAST(? AS VARCHAR))');
        params.push(idx, type, role);
      }
    }
  }
  return { sql: `SELECT * FROM (VALUES ${tuples.join(', ')}) AS v(idx, other_type, link_role)`, params };
}

/**
 * Distinkte Gegenobjekte je Kandidat (idx → n). Der Fokus ist eine Kanten-
 * Seite; die Datei-Begrenzung greift nur, wenn der Fokus eine Datei hat —
 * Pseudo-Typen (BuiltinFunction, PluginFunction) tragen File_Name NULL und
 * alle Kanten auf sie Target_File NULL. Die Gegenseite muss im Katalog
 * existieren (IS NOT DISTINCT FROM: Gegenobjekte ohne Datei matchen mit).
 */
async function countDirect(ctx, focus, direction, entries) {
  if (entries.length === 0) return new Map();
  const values = candidateValues(entries);
  const [self, other] = direction === 'in' ? ['Target', 'Source'] : ['Source', 'Target'];
  const fileFilter = focus.File_Name != null ? `AND ol.${self}_File = ?` : '';
  const sql = `
    WITH cand AS (${values.sql})
    SELECT c.idx, count(DISTINCT concat_ws('|', ol.${other}_UUID, ol.${other}_File)) AS n
    FROM ObjectLinks ol
    JOIN cand c ON c.other_type = ol.${other}_Type AND c.link_role = ol.Link_Role
    JOIN ObjectCatalog oc ON oc.Object_UUID = ol.${other}_UUID
                         AND oc.File_Name IS NOT DISTINCT FROM ol.${other}_File
    WHERE ol.${self}_UUID = ? ${fileFilter}
    GROUP BY c.idx
  `;
  const params = [...values.params, focus.Object_UUID];
  if (focus.File_Name != null) params.push(focus.File_Name);
  const result = await db.executeQuery(ctx, sql, params);
  return new Map(result.rows.map((r) => [Number(r.idx), Number(r.n)]));
}

/**
 * Ausgehende Treffer über die Aggregat-Mitglieder (z.B. die eigenen Layout-
 * Objekte eines Layouts, datei-gleich). Liefert idx → n und die Mitgliederzahl.
 */
async function countViaAggregate(ctx, focus, aggregate, entries) {
  const membersSql = `
    SELECT DISTINCT m.Source_UUID AS uuid
    FROM ObjectLinks m
    WHERE m.Target_UUID = ? AND m.Target_File IS NOT DISTINCT FROM ?
      AND m.Link_Role = ? AND m.Source_Type = ?
      AND m.Source_File IS NOT DISTINCT FROM ?
  `;
  const memberParams = [focus.Object_UUID, focus.File_Name, aggregate.role, aggregate.via, focus.File_Name];
  const countResult = await db.executeQuery(
    ctx,
    `SELECT count(*) AS n FROM (${membersSql})`,
    memberParams
  );
  const memberCount = Number(countResult.rows[0]?.n ?? 0);
  if (memberCount === 0 || entries.length === 0) return { counts: new Map(), memberCount };

  const values = candidateValues(entries);
  const sql = `
    WITH cand AS (${values.sql}),
         members AS (${membersSql})
    SELECT c.idx, count(DISTINCT concat_ws('|', ol.Target_UUID, ol.Target_File)) AS n
    FROM ObjectLinks ol
    JOIN members mb ON mb.uuid = ol.Source_UUID
    JOIN cand c ON c.other_type = ol.Target_Type AND c.link_role = ol.Link_Role
    JOIN ObjectCatalog oc ON oc.Object_UUID = ol.Target_UUID
                         AND oc.File_Name IS NOT DISTINCT FROM ol.Target_File
    WHERE ol.Source_File IS NOT DISTINCT FROM ?
    GROUP BY c.idx
  `;
  const params = [...values.params, ...memberParams, focus.File_Name];
  const result = await db.executeQuery(ctx, sql, params);
  return {
    counts: new Map(result.rows.map((r) => [Number(r.idx), Number(r.n)])),
    memberCount,
  };
}

/**
 * GET /api/references/candidates
 * @param {Object} ctx - Request-Kontext (Solution-Scope)
 * @param {Object} options - { uuid, file } (file = Klon-Disambiguierung wie bei getReferences)
 * @returns {Promise<{data: Array, meta: Object}>}
 */
async function getReferenceCandidates(ctx, { uuid, file }) {
  const startTime = Date.now();
  try {
    // 1. Fokus (klon-sicher) und Subtyp.
    const focusResult = await resolveByUUID(
      ctx, uuid, file, 'Object_UUID, Object_Type, Object_Name, File_Name'
    );
    const focus = focusResult.rows[0];
    const focusType = focus.Object_Type;
    const configured = CANDIDATES[focusType] ?? [];
    const aggregate = AGGREGATES[focusType] ?? null;
    const needsSubtype = configured.some((c) => c.when?.subtype);
    const focusSubtype = needsSubtype ? await getFocusSubtype(ctx, focus) : null;

    const meta = {
      focus_type: focusType,
      focus_subtype: focusSubtype,
      aggregate: aggregate && configured.some((c) => c.aggregate) ? aggregate.via : null,
      suppressed: [],
    };
    if (configured.length === 0) {
      meta.execution_time_ms = Date.now() - startTime;
      return { data: [], meta };
    }

    // 2.–4. Gating, Registry-Gegenprüfung, Existenz-Filter.
    const [registry, typeCounts] = await Promise.all([getRoleRegistry(ctx), getTypeCounts(ctx)]);
    const active = [];
    configured.forEach((candidate, idx) => {
      const suppress = (reason) => meta.suppressed.push({
        direction: candidate.direction, types: candidate.types, reason,
      });
      const allowed = candidate.when?.subtype;
      if (allowed && focusSubtype != null && !allowed.includes(focusSubtype)) {
        suppress('subtype');
        return;
      }
      const roles = filterRegisteredRoles(ctx, candidate.roles, registry);
      if (roles.length === 0) {
        suppress('roles_unregistered');
        return;
      }
      if (!candidate.types.some((t) => (typeCounts.get(t) ?? 0) > 0)) {
        suppress('not_in_solution');
        return;
      }
      active.push({ idx, candidate: { ...candidate, roles } });
    });

    // 5. Presence je Richtung, 6. Aggregat (nur ausgehend).
    const incoming = active.filter((e) => e.candidate.direction === 'in');
    const outgoing = active.filter((e) => e.candidate.direction === 'out');
    const aggregated = aggregate ? outgoing.filter((e) => e.candidate.aggregate) : [];
    const [inCounts, outCounts, viaAggregate] = await Promise.all([
      countDirect(ctx, focus, 'in', incoming),
      countDirect(ctx, focus, 'out', outgoing),
      aggregated.length > 0
        ? countViaAggregate(ctx, focus, aggregate, aggregated)
        : Promise.resolve(null),
    ]);
    if (viaAggregate) meta.aggregate_members = viaAggregate.memberCount;

    // 7. Status ableiten.
    const data = active.map(({ idx, candidate }) => {
      const direct = (candidate.direction === 'in' ? inCounts : outCounts).get(idx) ?? 0;
      const indirect = candidate.aggregate && viaAggregate ? viaAggregate.counts.get(idx) ?? 0 : 0;
      let status = 'missing';
      if (direct > 0) status = 'present';
      else if (indirect > 0) status = 'indirect';
      const row = {
        direction: candidate.direction,
        types: candidate.types,
        roles: candidate.roles,
        status,
        direct,
        indirect,
      };
      if (candidate.aggregate && aggregate) row.aggregate = true;
      if (indirect > 0) row.via = aggregate.via;
      if (candidate.caveat) row.caveat = candidate.caveat;
      return row;
    });

    meta.execution_time_ms = Date.now() - startTime;
    return { data, meta };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, file ? { uuid, file } : { uuid });
  }
}

module.exports = {
  getReferenceCandidates,
  clearReferenceCandidateCaches,
};
