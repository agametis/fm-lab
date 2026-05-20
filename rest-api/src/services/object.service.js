const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const { buildWhereClause, buildGroupByClause } = require('../utils/query-builder');
const environment = require('../config/environment');
const { OBJECT_TYPE_MAP, DETAIL_TEMPLATE_MAP, FOLDER_PSEUDO_TYPES, PSEUDO_TOKEN_TYPES } = require('../config/constants');
const aggregations = require('./aggregations');

/**
 * Resolve a possibly-pseudo Object_Type into a SQL filter fragment + params.
 * For Folder-Pseudo-Types ('ScriptFolder', 'LayoutFolder') the filter constrains
 * Object_Type='Folder' AND Source_Table=<mapped>. For all other types it's a plain
 * Object_Type=? filter.
 */
function buildTypeFilter(dbType) {
  if (FOLDER_PSEUDO_TYPES[dbType]) {
    return {
      sql: 'oc.Object_Type = ? AND oc.Source_Table = ?',
      sqlNoAlias: 'Object_Type = ? AND Source_Table = ?',
      params: ['Folder', FOLDER_PSEUDO_TYPES[dbType]],
    };
  }
  return {
    sql: 'oc.Object_Type = ?',
    sqlNoAlias: 'Object_Type = ?',
    params: [dbType],
  };
}
const templateService = require('./template.service');

/**
 * Object Service
 * Handles queries to ObjectCatalog table
 */

/**
 * Convert BigInt values in object to Numbers for JSON serialization
 */
function convertBigInts(obj) {
  if (Array.isArray(obj)) {
    return obj.map(convertBigInts);
  } else if (obj !== null && typeof obj === 'object') {
    const converted = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = typeof value === 'bigint' ? Number(value) : convertBigInts(value);
    }
    return converted;
  }
  return obj;
}

/**
 * Get object by UUID
 * @param {string} uuid - Object UUID
 * @returns {Promise<Object>} Object data
 */
async function getByUUID(uuid) {
  try {
    const sql = 'SELECT * FROM ObjectCatalog WHERE Object_UUID = ?';
    const result = await db.executeQuery(sql, [uuid]);

    if (result.rows.length === 0) {
      throw createError('OBJECT_NOT_FOUND', `Object with UUID '${uuid}' not found`, { uuid });
    }

    return {
      data: convertBigInts(result.rows[0]),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, { uuid });
  }
}

/**
 * List objects by type with optional filters
 * @param {Object} filters - Filter options
 * @param {string} filters.type
 * @param {string} [filters.file]
 * @param {number} [filters.limit]
 * @param {boolean} [filters.withUsage]   - Pseudo-Token-Erweiterung: usage_count Spalte
 * @param {boolean} [filters.withCategory] - Pseudo-Token-Erweiterung: category/category_id Spalten
 * @param {string|string[]} [filters.category] - Category-Filter (kommasepariert oder Array)
 * @param {string} [filters.sort]         - 'usage' | 'name' | 'category'
 * @returns {Promise<Object>} List of objects with metadata
 */
async function listObjects(filters) {
  try {
    const {
      type,
      file,
      limit = environment.api.defaultLimit,
      withUsage = false,
      withCategory = false,
      category,
      sort,
    } = filters;

    // Normalize type to PascalCase for database
    const dbType = OBJECT_TYPE_MAP[type] || type;

    // Categories als Array normalisieren (akzeptiert "A,B,C" oder Array).
    const categories = normalizeCategories(category);

    // Wenn der Typ eine Aggregations-Erweiterung verlangt, gehen wir über den
    // Aggregations-Builder. Sonst klassischer Pfad mit Reference_Count.
    const wantsAggregation =
      withUsage || withCategory || categories.length > 0 || (sort && PSEUDO_TOKEN_TYPES.includes(dbType));

    const supportsAggregation = aggregations.USAGE_TYPES.includes(dbType);

    if (wantsAggregation && supportsAggregation) {
      // Validierung: PluginComponent kennt keine Category-Schicht über sich.
      if (dbType === 'PluginComponent') {
        if (withCategory || categories.length > 0) {
          throw createError(
            'VALIDATION_ERROR',
            "PluginComponent has no parent category — '?withCategory' / '?category' are not supported.",
            { type, withCategory, category }
          );
        }
      }
      const { sql, params } = aggregations.buildListQuery(dbType, {
        file,
        withUsage,
        withCategory,
        categories,
        sort,
        limit,
        refAttached: db.isReferenceAttached(),
      });
      const result = await db.executeQuery(sql, params);
      return {
        data: convertBigInts(result.rows),
        meta: result.meta,
      };
    }

    // Standardpfad — bestehend, mit Reference_Count.
    const typeFilter = buildTypeFilter(dbType);

    let sql = `
      SELECT
        oc.*,
        COUNT(ol.Target_UUID) as Reference_Count
      FROM ObjectCatalog oc
      LEFT JOIN ObjectLinks ol ON oc.Object_UUID = ol.Source_UUID
        AND ol.Link_Type = 'operational'
      WHERE ${typeFilter.sql}
    `;

    const params = [...typeFilter.params];

    if (file) {
      sql += ' AND oc.File_Name = ?';
      params.push(file);
    }

    sql += `
      GROUP BY oc.Object_UUID, oc.Object_Type, oc.Object_Name,
               oc.File_Name, oc.Source_Table, oc.Object_ID
      ORDER BY oc.Object_Name
    `;

    if (limit > 0) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, filters);
  }
}

/**
 * Normalisiert den Category-Parameter zu einem String-Array.
 * Akzeptiert: undefined/null → []; String "A,B,C" → ['A','B','C']; Array → unverändert.
 */
function normalizeCategories(category) {
  if (!category) return [];
  if (Array.isArray(category)) return category.filter(Boolean);
  if (typeof category === 'string') {
    return category.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * GET /api/list/categories — Filter-Pillen-Datenbasis.
 * PRD prd_pseudo_object_types_filter.md §7.2: liefert pro Category eines
 * Pseudo-Token-Typs { category, token_count, total_usage }, sortiert nach
 * total_usage desc.
 */
async function listCategorySummary({ type, file }) {
  try {
    const dbType = OBJECT_TYPE_MAP[type] || type;
    if (!PSEUDO_TOKEN_TYPES.includes(dbType)) {
      throw createError(
        'VALIDATION_ERROR',
        `Type '${dbType}' has no category schema (only PSEUDO_TOKEN_TYPES are supported).`,
        { type, supported: PSEUDO_TOKEN_TYPES }
      );
    }
    const { sql, params } = aggregations.buildCategorySummaryQuery(
      dbType,
      db.isReferenceAttached(),
      file
    );
    const result = await db.executeQuery(sql, params);
    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, { type, file });
  }
}

/**
 * Count objects with optional grouping
 * @param {Object} options - Count options {type, file, group_by}
 * @returns {Promise<Object>} Count results with metadata
 */
async function countObjects(options) {
  try {
    const { type, file, group_by } = options;

    // Normalize type to PascalCase for database
    const dbType = type ? (OBJECT_TYPE_MAP[type] || type) : null;

    const { clause: groupByClause, columns } = buildGroupByClause(group_by);

    let sql;
    const params = [];

    if (columns.length > 0) {
      // Grouped count
      sql = `
        SELECT ${columns.join(', ')}, COUNT(*) as count
        FROM ObjectCatalog
      `;

      const conditions = [];
      // Exclude DDR-specific object types from count
      conditions.push("Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation')");

      if (dbType) {
        const typeFilter = buildTypeFilter(dbType);
        conditions.push(typeFilter.sqlNoAlias);
        params.push(...typeFilter.params);
      }
      if (file) {
        conditions.push('File_Name = ?');
        params.push(file);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ` ${groupByClause} ORDER BY ${columns.join(', ')}`;
    } else {
      // Simple count
      sql = 'SELECT COUNT(*) as count FROM ObjectCatalog';

      const conditions = [];
      // Exclude DDR-specific object types from count
      conditions.push("Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation')");

      if (dbType) {
        const typeFilter = buildTypeFilter(dbType);
        conditions.push(typeFilter.sqlNoAlias);
        params.push(...typeFilter.params);
      }
      if (file) {
        conditions.push('File_Name = ?');
        params.push(file);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
    }

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

/**
 * COALESCE-Ausdruck für den vollständigen Step_Text einer ScriptStep-Reihe.
 * Wird sowohl in SELECT (Anzeige) als auch in WHERE (Volltextsuche) verwendet.
 * Quellen-Priorität: DDR_ScriptSteps.Step_Text → Comment aus Parameters_XML
 * → generischer Step_Name. Identisch zu SCRIPTSTEP_SEARCH_CTE (siehe unten).
 */
const STEP_TEXT_EXPR = `
  COALESCE(
    ddr.Step_Text,
    CASE WHEN s.Step_Name = '# (comment)'
         THEN NULLIF('# ' || regexp_extract(s.Parameters_XML, '<Comment value="([^"]*)"', 1), '# ')
         ELSE NULL
    END,
    s.Step_Name
  )
`;

/**
 * Baut den Standard-Such-SQL und die Parameter-Liste.
 *
 * Drei Pfade je nach Filter-Konstellation:
 *  - dbType gesetzt (≠ ScriptStep): plain ObjectCatalog-Match auf Object_Name.
 *  - dbType nicht gesetzt, name selektiv: UNION ALL (non-ScriptStep via Object_Name)
 *    + (ScriptStep via Step_Text). Beide Branches schließen DDR-Internals aus.
 *  - dbType nicht gesetzt, name = '%'-only: nur non-ScriptStep — Initial-Load,
 *    keine 196k Steps in der Default-Liste.
 *
 * @param {Object} opts - {name, dbType, file, limit, offset, countOnly?}
 * @returns {{sql: string, params: Array}}
 */
function buildSearchSql({ name, dbType, file, limit, offset, countOnly = false }) {
  const params = [];

  // Pfad A: expliziter Type-Filter (nicht ScriptStep — der wird oben abgefangen)
  if (dbType) {
    const typeFilter = buildTypeFilter(dbType);
    let inner = `
      SELECT Object_UUID, Object_Type, Object_Name, File_Name, Source_Table, Object_ID,
             CAST(NULL AS VARCHAR) AS Step_Text,
             CAST(NULL AS VARCHAR) AS Script_Name,
             CAST(NULL AS INTEGER) AS Step_Index
      FROM ObjectCatalog
      WHERE Object_Name ILIKE ?
        AND Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation')
        AND ${typeFilter.sqlNoAlias}
    `;
    params.push(name, ...typeFilter.params);
    if (file) {
      inner += ' AND File_Name = ?';
      params.push(file);
    }
    if (countOnly) {
      return { sql: `SELECT COUNT(*) AS count FROM (${inner}) c`, params };
    }
    let sql = `${inner} ORDER BY Object_Name`;
    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    return { sql, params };
  }

  // Pfad B/C: kein Type-Filter
  // Non-ScriptStep-Branch (Object_Name-Match, ScriptSteps explizit ausgeschlossen)
  let nonStepInner = `
    SELECT Object_UUID, Object_Type, Object_Name, File_Name, Source_Table, Object_ID,
           CAST(NULL AS VARCHAR) AS Step_Text,
           CAST(NULL AS VARCHAR) AS Script_Name,
           CAST(NULL AS INTEGER) AS Step_Index
    FROM ObjectCatalog
    WHERE Object_Name ILIKE ?
      AND Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation', 'ScriptStep')
  `;
  params.push(name);
  if (file) {
    nonStepInner += ' AND File_Name = ?';
    params.push(file);
  }

  // Wildcard-only ('%' bzw. nur Wildcards): ScriptStep-Branch weglassen, sonst
  // landen 196k Steps in der Default-Liste ohne erkennbaren Nutzen.
  const isWildcardOnly = !name.replace(/%/g, '').trim();
  if (isWildcardOnly) {
    if (countOnly) {
      return { sql: `SELECT COUNT(*) AS count FROM (${nonStepInner}) c`, params };
    }
    let sql = `${nonStepInner} ORDER BY Object_Name`;
    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    return { sql, params };
  }

  // ScriptStep-Branch (Step_Text-Match, mit Anreicherung der Step-Spalten)
  let stepInner = `
    SELECT
      oc.Object_UUID, oc.Object_Type, oc.Object_Name, oc.File_Name,
      oc.Source_Table, oc.Object_ID,
      ${STEP_TEXT_EXPR} AS Step_Text,
      s.Script_Name,
      s.Step_Index
    FROM ObjectCatalog oc
    LEFT JOIN StepsForScripts s ON s.Step_UUID = oc.Object_UUID
    LEFT JOIN DDR_ScriptSteps ddr ON ddr.Step_UUID = oc.Object_UUID
    WHERE oc.Object_Type = 'ScriptStep'
      AND ${STEP_TEXT_EXPR} ILIKE ?
  `;
  params.push(name);
  if (file) {
    stepInner += ' AND oc.File_Name = ?';
    params.push(file);
  }

  const combined = `(${nonStepInner}) UNION ALL (${stepInner})`;
  if (countOnly) {
    return { sql: `SELECT COUNT(*) AS count FROM (${combined}) c`, params };
  }
  let sql = `SELECT * FROM (${combined}) c ORDER BY Object_Name`;
  if (limit > 0) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }
  return { sql, params };
}

/**
 * Search objects by name pattern
 * @param {Object} searchOptions - Search options {name, type, file, limit, offset}
 * @returns {Promise<Object>} Search results with metadata
 */
async function searchObjects(searchOptions) {
  try {
    const { name, type, file, limit = environment.api.defaultLimit, offset = 0 } = searchOptions;

    // Normalize type to PascalCase for database
    const dbType = type ? (OBJECT_TYPE_MAP[type] || type) : null;

    // ScriptStep-Spezialpfad: Volltextsuche im DDR_Step_Text + Comment-Inhalt
    // aus Parameters_XML, mit Script_Name/Step_Index/Step_Text in der Response.
    if (dbType === 'ScriptStep') {
      return await searchScriptSteps({ name, file, limit, offset });
    }

    // Suchstrategie (PRD ScriptStep-Filtering):
    //   1. dbType === 'ScriptStep'  → searchScriptSteps (oben abgefangen).
    //   2. dbType ist ein anderer Typ → ObjectCatalog mit Type-Filter; ScriptSteps
    //      kommen hier nicht vor.
    //   3. Kein dbType-Filter        → UNION ALL:
    //        a) Non-ScriptStep mit Object_Name-Match.
    //        b) ScriptStep mit Step_Text-Match (Skriptname-Treffer würden
    //           sonst die Trefferliste überschwemmen — der Script-Treffer
    //           selbst erscheint ja schon in (a)).
    //      Wildcard-only-Suche ('%') überspringt (b), weil dann sonst 196k
    //      Steps in die Initial-Liste flössen.
    const { sql, params } = buildSearchSql({ name, dbType, file, limit, offset });

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, searchOptions);
  }
}

/**
 * ScriptStep-Spezial-CTE: löst den vollen Klartext einer Skriptzeile auf.
 * Priorität:
 *   1. DDR_ScriptSteps.Step_Text  (FileMaker 21+ DDR_INFO — fertig gerendert
 *      mit Parametern/Formeln/Referenzen)
 *   2. "# " + Comment-value aus StepsForScripts.Parameters_XML  (Fallback für
 *      Comment-Steps ohne DDR-Text)
 *   3. StepsForScripts.Step_Name  (generischer Step-Typ als Last-Resort)
 *
 * Liefert außerdem Script_Name und Step_Index, damit das Frontend einen
 * "Datei ▸ Skript ▸ Step N"-Breadcrumb unter dem Step-Text anzeigen kann.
 */
const SCRIPTSTEP_SEARCH_CTE = `
  WITH script_steps AS (
    SELECT
      oc.Object_UUID,
      oc.Object_Type,
      oc.Object_Name,
      oc.File_Name,
      oc.Source_Table,
      oc.Object_ID,
      COALESCE(
        ddr.Step_Text,
        CASE WHEN s.Step_Name = '# (comment)'
             THEN NULLIF('# ' || regexp_extract(s.Parameters_XML, '<Comment value="([^"]*)"', 1), '# ')
             ELSE NULL
        END,
        s.Step_Name
      ) AS Step_Text,
      s.Script_Name,
      s.Step_Index
    FROM ObjectCatalog oc
    LEFT JOIN StepsForScripts s ON s.Step_UUID = oc.Object_UUID
    LEFT JOIN DDR_ScriptSteps ddr ON ddr.Step_UUID = oc.Object_UUID
    WHERE oc.Object_Type = 'ScriptStep'
  )
`;

async function searchScriptSteps({ name, file, limit, offset }) {
  // Filter NUR auf Step_Text. Object_Name enthält bei ScriptSteps auch den
  // Skriptnamen ("<Script> [<Index>] <StepType>") — wenn wir den mitdurch-
  // suchen würden, käme jeder Skriptnamen-Treffer als rauschende Step-Liste
  // zurück. Skriptnamen-Suche gehört in den Typ=Script-Filter, nicht hier.
  let sql = `${SCRIPTSTEP_SEARCH_CTE}
    SELECT *
    FROM script_steps
    WHERE Step_Text ILIKE ?`;
  const params = [name];

  if (file) {
    sql += ' AND File_Name = ?';
    params.push(file);
  }

  sql += ' ORDER BY File_Name, Script_Name, Step_Index';

  if (limit > 0) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  const result = await db.executeQuery(sql, params);
  return {
    data: convertBigInts(result.rows),
    meta: result.meta,
  };
}

async function countScriptSteps({ name, file }) {
  let sql = `${SCRIPTSTEP_SEARCH_CTE}
    SELECT COUNT(*) AS count
    FROM script_steps
    WHERE Step_Text ILIKE ?`;
  const params = [name];

  if (file) {
    sql += ' AND File_Name = ?';
    params.push(file);
  }

  const result = await db.executeQuery(sql, params);
  return {
    data: convertBigInts(result.rows),
    meta: result.meta,
  };
}

/**
 * Count search results by name pattern
 * @param {Object} searchOptions - Search options {name, type, file}
 * @returns {Promise<Object>} Count result with metadata
 */
async function countSearchResults(searchOptions) {
  try {
    const { name, type, file } = searchOptions;

    // Normalize type to PascalCase for database
    const dbType = type ? (OBJECT_TYPE_MAP[type] || type) : null;

    // ScriptStep-Spezialpfad: muss denselben WHERE-Filter wie searchScriptSteps
    // verwenden, sonst weicht der Total-Count von der gepaginierten Liste ab.
    if (dbType === 'ScriptStep') {
      return await countScriptSteps({ name, file });
    }

    // Identische Filterlogik wie searchObjects (UNION ALL bei Volltextsuche
    // ohne Type-Filter). Gemeinsamer Builder, damit Count == List-Total.
    const { sql, params } = buildSearchSql({ name, dbType, file, countOnly: true });

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, searchOptions);
  }
}

/**
 * Pseudo-Type Reference-Resolver.
 *
 * ScriptStepType + PluginComponent haben keine vollständigen ObjectLinks-
 * Spiegelungen (PRD prd_pseudo_object_types_filter.md §6.4). Damit der
 * Referenzen-Tab im Frontend trotzdem die aufrufenden Scripts/Container
 * anzeigen kann, aggregieren wir die "parent"-Liste live aus den Basis-
 * Tabellen:
 *   - ScriptStepType  → StepsForScripts (alle Scripts mit Step_Name = Object_Name)
 *   - PluginComponent → ObjectLinks via groups_into → calls_pluginfunction
 *                       (Aufrufer-Container)
 *
 * Liefert ein {data, meta}-Objekt (kompatibel zum Standard-References-Pfad)
 * oder NULL, wenn das Objekt kein Pseudo-Typ ist.
 */
async function getPseudoTypeReferences(uuid, direction, link_type, limit) {
  // Object-Type lookup
  const typeLookup = await db.executeQuery(
    'SELECT Object_Type, Object_Name FROM ObjectCatalog WHERE Object_UUID = ?',
    [uuid]
  );
  if (typeLookup.rows.length === 0) return null;
  const objType = typeLookup.rows[0].Object_Type;

  // Pseudo-Type-Gate: dieser Resolver ist NUR für Aggregate (ScriptStepType,
  // PluginComponent) zuständig. Für alle anderen Typen sofort durchreichen
  // an den Standard-References-Pfad — sonst würde der frühe structural-Filter
  // unten z.B. parent_script-Links für ScriptStep verschlucken.
  if (objType !== 'ScriptStepType' && objType !== 'PluginComponent') {
    return null;
  }

  // 'child'-direction macht für Aggregate keinen Sinn — sie haben keine
  // Downstream-Abhängigkeiten. 'parent' und 'all' liefern die Aufrufer-Liste.
  if (direction === 'child' || direction === 'recursive') return null;

  // Pseudo-Typen haben nur "operational"-Equivalente; auf structural-Anfragen
  // liefern wir explizit ein leeres Result, damit der Frontend-Hook nicht
  // versehentlich Aufrufer doppelt sieht.
  if (link_type === 'structural') {
    return { data: [], meta: { source: 'pseudo_type_resolver', object_type: objType } };
  }

  if (objType === 'ScriptStepType') {
    // Aufrufer = Scripts mit Step_Name = Object_Name
    const sql = `
      SELECT
        'parent' as direction,
        s.Script_UUID as uuid,
        'Script' as Object_Type,
        s.Script_Name as Object_Name,
        s.File_Name as File_Name,
        'uses_step_type' as Link_Role,
        FALSE as Is_Cross_File,
        NULL as Container_UUID,
        NULL as Container_Type,
        COUNT(*) as Call_Count
      FROM StepsForScripts s
      JOIN ObjectCatalog oc ON oc.Object_UUID = ?
      WHERE s.Step_Name = oc.Object_Name
      GROUP BY s.Script_UUID, s.Script_Name, s.File_Name
      ORDER BY Call_Count DESC, s.Script_Name ASC
      ${limit > 0 ? 'LIMIT ?' : ''}
    `;
    const params = limit > 0 ? [uuid, limit] : [uuid];
    const result = await db.executeQuery(sql, params);
    return {
      data: convertBigInts(result.rows),
      meta: { ...result.meta, source: 'pseudo_type_resolver', object_type: objType },
    };
  }

  if (objType === 'PluginComponent') {
    // Zwei-Stufen-Aggregation: groups_into → calls_pluginfunction
    // Aufrufer-Containers (Script/CustomFunction) der Funktionen dieser Component.
    const sql = `
      WITH funcs AS (
        SELECT pf.Object_UUID
        FROM ObjectCatalog pc
        JOIN ObjectLinks gi ON gi.Target_UUID = pc.Object_UUID
                           AND gi.Link_Role = 'groups_into'
        JOIN ObjectCatalog pf ON pf.Object_UUID = gi.Source_UUID
                             AND pf.Object_Type = 'PluginFunction'
        WHERE pc.Object_UUID = ?
      )
      SELECT
        'parent' as direction,
        oc.Object_UUID as uuid,
        oc.Object_Type as Object_Type,
        oc.Object_Name as Object_Name,
        oc.File_Name as File_Name,
        'calls_component' as Link_Role,
        FALSE as Is_Cross_File,
        pl.Target_UUID as Container_UUID,
        pc_container.Object_Type as Container_Type,
        COUNT(*) as Call_Count
      FROM funcs f
      JOIN ObjectLinks call ON call.Target_UUID = f.Object_UUID
                           AND call.Link_Role = 'calls_pluginfunction'
      JOIN ObjectCatalog oc ON oc.Object_UUID = call.Source_UUID
      LEFT JOIN ObjectLinks pl ON pl.Source_UUID = oc.Object_UUID
                              AND pl.Link_Role IN ('parent_layout', 'parent_script')
      LEFT JOIN ObjectCatalog pc_container ON pc_container.Object_UUID = pl.Target_UUID
      GROUP BY oc.Object_UUID, oc.Object_Type, oc.Object_Name, oc.File_Name,
               pl.Target_UUID, pc_container.Object_Type
      ORDER BY Call_Count DESC, oc.Object_Name ASC
      ${limit > 0 ? 'LIMIT ?' : ''}
    `;
    const params = limit > 0 ? [uuid, limit] : [uuid];
    const result = await db.executeQuery(sql, params);
    return {
      data: convertBigInts(result.rows),
      meta: { ...result.meta, source: 'pseudo_type_resolver', object_type: objType },
    };
  }

  return null;
}

/**
 * Get object references (dependencies)
 * @param {Object} refOptions - Reference options {uuid, direction, link_type, limit}
 * @returns {Promise<Object>} References with metadata
 */
async function getReferences(refOptions) {
  try {
    const {
      uuid,
      direction = 'all',
      link_type = 'operational',
      limit = environment.api.defaultLimit
    } = refOptions;

    // Pseudo-Type-Sonderfall: ScriptStepType + PluginComponent haben keine
    // (vollständigen) ObjectLinks-Spiegelungen (PRD §6.4). Die "Verwendet in"-
    // Liste muss daher live aus den Basis-Tabellen aggregiert werden.
    const pseudoRefs = await getPseudoTypeReferences(uuid, direction, link_type, limit);
    if (pseudoRefs !== null) return pseudoRefs;

    let sql;
    let params;

    // Container-Resolution für Sub-Knoten (PRD prd_cross_references_hilite.md):
    // LayoutObject und ScriptStep haben keinen sinnvollen Standalone-Detail-View —
    // ihr Wert liegt im Container-Kontext. Die zusätzlichen LEFT JOINs liefern
    // den Container-UUID/Type über `parent_layout`/`parent_script`-Links mit.
    // Für andere Object-Types bleibt Container_UUID = NULL, und das Frontend
    // navigiert wie gewohnt direkt auf das Objekt.
    const CONTAINER_JOIN = `
      LEFT JOIN ObjectLinks pl ON pl.Source_UUID = oc.Object_UUID
        AND pl.Link_Role IN ('parent_layout', 'parent_script')
      LEFT JOIN ObjectCatalog pc ON pl.Target_UUID = pc.Object_UUID
    `;

    if (direction === 'child') {
      // Downstream dependencies (what this object references)
      sql = `
        SELECT
          ol.Target_UUID,
          oc.Object_Type as Target_Type,
          oc.Object_Name as Target_Name,
          oc.File_Name as Target_File,
          ol.Link_Role,
          ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Source_UUID = ?
      `;
      params = [uuid];

      if (link_type !== 'all') {
        sql += ' AND ol.Link_Type = ?';
        params.push(link_type);
      }
    } else if (direction === 'parent') {
      // Upstream dependencies (what references this object)
      sql = `
        SELECT
          ol.Source_UUID,
          oc.Object_Type as Source_Type,
          oc.Object_Name as Source_Name,
          oc.File_Name as Source_File,
          ol.Link_Role,
          ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Target_UUID = ?
      `;
      params = [uuid];

      if (link_type !== 'all') {
        sql += ' AND ol.Link_Type = ?';
        params.push(link_type);
      }
    } else if (direction === 'recursive') {
      // Recursive dependencies
      sql = `
        WITH RECURSIVE dependency_tree AS (
          SELECT Source_UUID, Target_UUID, Link_Role, 1 as depth
          FROM ObjectLinks
          WHERE Source_UUID = ? AND Link_Type = 'operational'

          UNION ALL

          SELECT ol.Source_UUID, ol.Target_UUID, ol.Link_Role, dt.depth + 1
          FROM ObjectLinks ol
          JOIN dependency_tree dt ON ol.Source_UUID = dt.Target_UUID
          WHERE dt.depth < 10 AND ol.Link_Type = 'operational'
        )
        SELECT DISTINCT
          dt.Target_UUID,
          dt.Link_Role,
          dt.depth,
          oc.Object_Type,
          oc.Object_Name,
          oc.File_Name
        FROM dependency_tree dt
        JOIN ObjectCatalog oc ON dt.Target_UUID = oc.Object_UUID
        ORDER BY depth, Object_Name
      `;
      params = [uuid];
    } else {
      // All (both parent and child) — beide Hälften mit Container-Resolution.
      const baseChild = `
        SELECT 'child' as direction,
          ol.Target_UUID as uuid,
          oc.Object_Type, oc.Object_Name, oc.File_Name,
          ol.Link_Role, ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Source_UUID = ?
      `;
      const baseParent = `
        SELECT 'parent' as direction,
          ol.Source_UUID as uuid,
          oc.Object_Type, oc.Object_Name, oc.File_Name,
          ol.Link_Role, ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Target_UUID = ?
      `;
      if (link_type !== 'all') {
        sql = `${baseChild} AND ol.Link_Type = ? UNION ALL ${baseParent} AND ol.Link_Type = ?`;
        params = [uuid, link_type, uuid, link_type];
      } else {
        sql = `${baseChild} UNION ALL ${baseParent}`;
        params = [uuid, uuid];
      }
    }

    if (limit > 0 && direction !== 'recursive') {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, refOptions);
  }
}

/**
 * Get object details using type-specific SQL template
 * Dispatches to object_details_<type>.sql based on Object_Type
 * Falls back to object_details_generic.sql for types without dedicated template
 * @param {string} uuid - Object UUID
 * @returns {Promise<Object>} Detail data with metadata
 */
async function getDetails(uuid) {
  try {
    // 1. Look up object type from ObjectCatalog
    const lookupSql = 'SELECT Object_Type, Object_Name, File_Name, Source_Table, Object_ID FROM ObjectCatalog WHERE Object_UUID = ?';
    const lookupResult = await db.executeQuery(lookupSql, [uuid]);

    if (lookupResult.rows.length === 0) {
      throw createError('OBJECT_NOT_FOUND', `Object with UUID '${uuid}' not found`, { uuid });
    }

    const objectInfo = lookupResult.rows[0];
    const objectType = objectInfo.Object_Type;

    // 2. Determine template name from explicit map
    const templateName = DETAIL_TEMPLATE_MAP[objectType] || 'object_details_generic';
    const hasDedicatedTemplate = objectType in DETAIL_TEMPLATE_MAP;

    // 3. Execute the detail template (templates/sql/ = 'report' source)
    const result = await templateService.executeTemplate(templateName, { uuid }, 'report');

    return {
      data: result.data,
      meta: {
        ...result.meta,
        object_type: objectType,
        object_name: objectInfo.Object_Name,
        file_name: objectInfo.File_Name,
        template_used: templateName,
        has_dedicated_template: hasDedicatedTemplate,
      },
      sql: result.sql,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, { uuid });
  }
}

module.exports = {
  getByUUID,
  getDetails,
  listObjects,
  listCategorySummary,
  countObjects,
  searchObjects,
  countSearchResults,
  getReferences,
};
