const objectService = require('../services/object.service');
const templateService = require('../services/template.service');
const formatters = require('../formatters');
const { sendFormatted, buildSuccess } = require('../utils/response-builder');
const { createError } = require('../middleware/error-handler');
const referenceService = require('../services/reference.service');

// UUID-Erkennung: Standard-UUID v1–v5 mit Bindestrichen ODER 32 Hex-Chars ohne
// Bindestriche (Pseudo-Type-UUIDs aus md5() wie ScriptStepType, BuiltinFunction,
// PluginFunction, PluginComponent — vgl. PRD prd_pseudo_object_types_filter.md §5).
const UUID_REGEX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

/**
 * Object Controller
 * Handles requests for object-related endpoints
 */

// Mapping API-Type → interne Source_Table für FolderHierarchy/list_with_folders.sql
const SUBTYPE_FOR_TYPE = {
  script:         'ScriptCatalog',
  layout:         'Layouts',
  customfunction: 'CustomFunctionsCatalog',
};

/**
 * GET /api/get - Get object by UUID
 */
async function get(req, res, next) {
  try {
    const { uuid, format = 'json', meta, debug } = req.query;

    const result = await objectService.getByUUID(uuid);

    const formattedData = formatters.format([result.data], format);

    sendFormatted(
      res,
      format === 'json' ? formattedData[0] : formattedData,
      format,
      meta ? result.meta : null,
      debug ? `SELECT * FROM ObjectCatalog WHERE Object_UUID = '${uuid}'` : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/list - List objects by type
 *
 * PRD prd_pseudo_object_types_filter.md §7.2 — neue Pseudo-Token-Parameter
 * (?withUsage, ?withCategory, ?category, ?sort) durchgereicht an den Service.
 */
async function list(req, res, next) {
  try {
    const {
      type, file, limit,
      with_usage, with_category, category, sort,
      format = 'json', meta, debug,
    } = req.query;

    const result = await objectService.listObjects({
      type, file, limit,
      withUsage: with_usage, withCategory: with_category, category, sort,
    });

    const formattedData = formatters.format(result.data, format);

    // Debug-SQL nur für den einfachen (nicht aggregierten) Pfad sinnvoll.
    const debugQuery = debug
      ? `list type=${type} with_usage=${!!with_usage} with_category=${!!with_category} category=${category || ''} sort=${sort || '(default)'} file=${file || ''} limit=${limit}`
      : null;

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debugQuery
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/list/categories - Pseudo-Token-Filter-Pillen Datenbasis
 * PRD §7.2 — { category, token_count, total_usage } pro Category.
 */
async function listCategories(req, res, next) {
  try {
    const { type, file, format = 'json', meta, debug } = req.query;

    const result = await objectService.listCategorySummary({ type, file });

    const formattedData = formatters.format(result.data, format);

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debug ? `list-categories type=${type} file=${file || ''}` : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/list-with-folders - Hierarchisch annotierte Liste eines Subtyps (Scripts/Layouts/CFs).
 * Liefert Items + Folder + Separators in sequenzieller Reihenfolge mit nesting_level.
 * Wrappt das Custom-Template list_with_folders.sql.
 */
async function listWithFolders(req, res, next) {
  try {
    const { type, file, format = 'json', meta, debug } = req.query;
    const subtype = SUBTYPE_FOR_TYPE[type];

    const result = await templateService.executeTemplate(
      'list_with_folders',
      { subtype, file },
      'query'
    );

    const formattedData = formatters.format(result.data, format);

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debug ? result.sql : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/count - Count objects
 */
async function count(req, res, next) {
  try {
    const { type, file, group_by, format = 'json', meta, debug } = req.query;

    const result = await objectService.countObjects({ type, file, group_by });

    const formattedData = formatters.format(result.data, format);

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debug ? 'COUNT query (SQL not shown for brevity)' : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/search - Search objects by name
 */
async function search(req, res, next) {
  try {
    const { name, type, file, limit, offset, format = 'json', meta, debug } = req.query;

    const result = await objectService.searchObjects({ name, type, file, limit, offset });

    const formattedData = formatters.format(result.data, format);

    const debugQuery = debug
      ? `SELECT * FROM ObjectCatalog WHERE Object_Name LIKE '${name}'${type ? ` AND Object_Type = '${type}'` : ''}${file ? ` AND File_Name = '${file}'` : ''} ORDER BY Object_Name LIMIT ${limit} OFFSET ${offset}`
      : null;

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debugQuery
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/search/count - Count search results by name pattern
 */
async function searchCount(req, res, next) {
  try {
    const { name, type, file, format = 'json', meta, debug } = req.query;

    const result = await objectService.countSearchResults({ name, type, file });

    const formattedData = formatters.format(result.data, format);

    const debugQuery = debug
      ? `SELECT COUNT(*) as count FROM ObjectCatalog WHERE Object_Name ILIKE '${name}'${type ? ` AND Object_Type = '${type}'` : ''}${file ? ` AND File_Name = '${file}'` : ''}`
      : null;

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debugQuery
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/references - Get object references
 */
async function references(req, res, next) {
  try {
    const { uuid, direction, link_type, limit, format = 'json', meta, debug } = req.query;

    const result = await objectService.getReferences({ uuid, direction, link_type, limit });

    const formattedData = formatters.format(result.data, format);

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debug ? `References query for ${direction} direction (SQL not shown for brevity)` : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/get-details - Get object details by UUID (type-specific template dispatch)
 */
async function getDetails(req, res, next) {
  try {
    const { uuid, format = 'json', meta, debug } = req.query;

    // format=tokens has its own dispatch path with type-specific templates and
    // dedicated post-processing. Use a per-type look-up plus the tokens formatter
    // instead of running the generic detail template through the format pipeline.
    if (format === 'tokens') {
      return await respondWithTokens(req, res, { uuid, meta, debug, enrich: req.query.enrich });
    }

    const result = await objectService.getDetails(uuid);

    // Content templates auto-override to content formatter (except JSON)
    let effectiveFormat = format;
    if (result.meta.template_type === 'content' && format !== 'json') {
      effectiveFormat = 'content';
    }

    const formattedData = formatters.format(result.data, effectiveFormat);

    sendFormatted(
      res,
      formattedData,
      effectiveFormat,
      meta ? result.meta : null,
      debug ? result.sql : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * format=tokens dispatcher for /api/get-details.
 *
 * Looks up the object type from ObjectCatalog, then runs the token-specific
 * SQL template(s) for that type and feeds the rows through the tokens formatter.
 * Currently supported: Script, CustomFunction. Other types return 400.
 */
async function respondWithTokens(req, res, { uuid, meta, debug, enrich }) {
  // 1. Look up object metadata so we know which token template to run.
  const lookup = await objectService.getByUUID(uuid);
  const objectType = lookup.data.Object_Type;
  const baseObject = {
    uuid,
    name: lookup.data.Object_Name,
    file: lookup.data.File_Name,
  };

  let payload;
  let metaInfo = {
    object_type: objectType,
    object_name: lookup.data.Object_Name,
    file_name: lookup.data.File_Name,
  };
  let debugSql = null;

  if (objectType === 'Script') {
    const stepsResult = await templateService.executeTemplate(
      'object_details_script_tokens',
      { uuid },
      'report'
    );
    const refsResult = await templateService.executeTemplate(
      'object_references_script',
      { uuid },
      'report'
    );

    payload = formatters.format(stepsResult.data, 'tokens', {
      kind: 'script',
      object: baseObject,
      refs: refsResult.data,
    });

    // ?enrich=<lang> — pro Step-Line Display-Name/Beschreibung/Help-URL aus
    // der Reference-DB ergänzen. Ohne `enrich` bleibt der Payload byte-identisch
    // zum bisherigen Verhalten (PRD §5.1 / Akzeptanzkriterium "byte-identisch").
    if (enrich) {
      try {
        const enrichLang = referenceService.resolveStepLang(enrich);
        const stepMeta = await referenceService.getStepMetaMap(enrichLang);

        // Funktion-Refs (type='function') aus Calcs sammeln — diese werden
        // pro Line in den refs[] geliefert (SQL-Block 6 in object_references_script.sql).
        // Wir sammeln alle eindeutigen Tokens für einen Bulk-Lookup.
        const fnRefs = [];
        for (const line of payload.lines) {
          if (line.stepId != null) {
            const m = stepMeta.get(line.stepId);
            if (m) {
              line.stepDisplayName = m.displayName;
              line.stepDescription = m.description;
              line.stepHelpUrl = m.helpUrl;
              line.stepLocalHelpUrl = m.localHelpUrl;
              line.stepCategoryId = m.categoryId;
            }
          }
          if (Array.isArray(line.refs)) {
            for (const r of line.refs) {
              if (r.type === 'function') {
                // enrichFunctionTokens iteriert über Items mit `content`-Feld
                // (analog zum Calc-Token-Format). Wir wrappen ScriptRefs in
                // ein Adapter-Objekt, das auf `name` als `content` zeigt.
                fnRefs.push(r);
              }
            }
          }
        }
        if (fnRefs.length > 0) {
          // Adapter: enrichFunctionTokens erwartet `t.content` — wir aliasen
          // auf `name`, lassen das Ergebnis dann durch.
          const adapted = fnRefs.map((r) => ({
            type: 'function',
            content: r.name,
            __ref: r,
          }));
          await referenceService.enrichFunctionTokens(adapted, enrichLang);
          for (const a of adapted) {
            if (typeof a.functionId === 'number') {
              const r = a.__ref;
              r.functionId          = a.functionId;
              r.functionCanonical   = a.functionCanonical;
              if (a.functionSubParameter) r.functionSubParameter = a.functionSubParameter;
              r.functionDisplayName = a.functionDisplayName;
              r.functionSignature   = a.functionSignature;
              r.functionPurpose     = a.functionPurpose;
              r.functionReturnType  = a.functionReturnType;
              r.functionHelpUrl     = a.functionHelpUrl;
              r.functionLocalHelpUrl = a.functionLocalHelpUrl;
            }
          }
        }
        metaInfo = { ...metaInfo, enrich: enrichLang };
      } catch (e) {
        if (e.code === 'REF_LANG_INVALID') {
          throw createError('VALIDATION_ERROR', e.message, e.details || {});
        }
        if (e.code === 'REF_NOT_ATTACHED') {
          // soft-fail: enrich liefert nichts, Antwort sonst unverändert
          metaInfo = { ...metaInfo, enrich: null, enrich_error: e.code };
        } else {
          throw e;
        }
      }
    }

    metaInfo = {
      ...metaInfo,
      template_used: 'object_details_script_tokens',
      references_template: 'object_references_script',
    };
    debugSql = debug ? `${stepsResult.sql}\n\n-- references:\n${refsResult.sql}` : null;
  } else if (objectType === 'ScriptStep') {
    // ScriptStep-Detail: 1-Zeilen-Variante des Script-Tokens-Payloads. Der
    // Step wird über Step_UUID aufgelöst und der Parent-Script-Kontext in
    // object.parentScript abgelegt, damit das Frontend einen Sprung-Link
    // zum Skript und die Step-Position anzeigen kann.
    const stepResult = await templateService.executeTemplate(
      'object_details_scriptstep_tokens',
      { uuid },
      'report'
    );

    if (!stepResult.data || stepResult.data.length === 0) {
      throw createError('OBJECT_NOT_FOUND', `ScriptStep with UUID '${uuid}' not found`, { uuid });
    }

    const stepRow = stepResult.data[0];
    const parentScriptUuid = stepRow.parent_script_uuid;
    const parentStepIndex  = Number(stepRow.parent_step_index);

    // Refs des Parent-Scripts holen, dann auf den einen Step filtern und
    // line_index auf 0 mappen (im 1-Zeilen-Payload liegt unsere Zeile bei 0).
    // Das vermeidet eine Duplikation des 265-Zeilen-Refs-Templates.
    const refsResult = await templateService.executeTemplate(
      'object_references_script',
      { uuid: parentScriptUuid },
      'report'
    );
    const filteredRefs = (refsResult.data || [])
      .filter(r => Number(r.line_index) === parentStepIndex)
      .map(r => ({ ...r, line_index: 0 }));

    const enrichedObject = {
      ...baseObject,
      parentScript: {
        uuid: parentScriptUuid,
        name: stepRow.parent_script_name,
        file: stepRow.parent_file_name,
      },
      stepIndex: parentStepIndex,
    };

    payload = formatters.format(stepResult.data, 'tokens', {
      kind: 'script',
      object: enrichedObject,
      refs: filteredRefs,
    });

    // Enrich-Pipeline: identisch zum Script-Case (Step-Meta + Function-Refs).
    if (enrich) {
      try {
        const enrichLang = referenceService.resolveStepLang(enrich);
        const stepMeta = await referenceService.getStepMetaMap(enrichLang);

        const fnRefs = [];
        for (const line of payload.lines) {
          if (line.stepId != null) {
            const m = stepMeta.get(line.stepId);
            if (m) {
              line.stepDisplayName = m.displayName;
              line.stepDescription = m.description;
              line.stepHelpUrl     = m.helpUrl;
              line.stepLocalHelpUrl = m.localHelpUrl;
              line.stepCategoryId  = m.categoryId;
            }
          }
          if (Array.isArray(line.refs)) {
            for (const r of line.refs) {
              if (r.type === 'function') fnRefs.push(r);
            }
          }
        }
        if (fnRefs.length > 0) {
          const adapted = fnRefs.map((r) => ({ type: 'function', content: r.name, __ref: r }));
          await referenceService.enrichFunctionTokens(adapted, enrichLang);
          for (const a of adapted) {
            if (typeof a.functionId === 'number') {
              const r = a.__ref;
              r.functionId          = a.functionId;
              r.functionCanonical   = a.functionCanonical;
              if (a.functionSubParameter) r.functionSubParameter = a.functionSubParameter;
              r.functionDisplayName = a.functionDisplayName;
              r.functionSignature   = a.functionSignature;
              r.functionPurpose     = a.functionPurpose;
              r.functionReturnType  = a.functionReturnType;
              r.functionHelpUrl     = a.functionHelpUrl;
              r.functionLocalHelpUrl = a.functionLocalHelpUrl;
            }
          }
        }
        metaInfo = { ...metaInfo, enrich: enrichLang };
      } catch (e) {
        if (e.code === 'REF_LANG_INVALID') {
          throw createError('VALIDATION_ERROR', e.message, e.details || {});
        }
        if (e.code === 'REF_NOT_ATTACHED') {
          metaInfo = { ...metaInfo, enrich: null, enrich_error: e.code };
        } else {
          throw e;
        }
      }
    }

    metaInfo = {
      ...metaInfo,
      template_used: 'object_details_scriptstep_tokens',
      references_template: 'object_references_script',
    };
    debugSql = debug ? `${stepResult.sql}\n\n-- references:\n${refsResult.sql}` : null;
  } else if (objectType === 'CustomFunction') {
    const cfResult = await templateService.executeTemplate(
      'object_details_customfunction_tokens',
      { uuid },
      'report'
    );

    payload = formatters.format(cfResult.data, 'tokens', {
      kind: 'customfunction',
      object: baseObject,
    });

    // ?enrich=<lang> — Calc-Tokens vom Type 'function' aus der Reference-DB
    // anreichern (function_name_lookup → functions / functions_lang). Soft-Fail
    // wenn die Reference-DB nicht attached ist; Validation-Fehler werden
    // hochgereicht (PRD §5.2).
    if (enrich) {
      try {
        await referenceService.enrichFunctionTokens(payload.tokens, enrich);
        metaInfo = { ...metaInfo, enrich };
      } catch (e) {
        if (e.code === 'REF_LANG_INVALID') {
          throw createError('VALIDATION_ERROR', e.message, e.details || {});
        }
        if (e.code === 'REF_NOT_ATTACHED') {
          metaInfo = { ...metaInfo, enrich: null, enrich_error: e.code };
        } else {
          throw e;
        }
      }
    }

    metaInfo = {
      ...metaInfo,
      template_used: 'object_details_customfunction_tokens',
    };
    debugSql = debug ? cfResult.sql : null;
  } else if (objectType === 'Field') {
    const fldResult = await templateService.executeTemplate(
      'object_details_field_tokens',
      { uuid },
      'report'
    );

    payload = formatters.format(fldResult.data, 'tokens', {
      kind: 'field',
      object: baseObject,
    });

    // ?enrich=<lang> — Calc-Tokens vom Type 'function' aus der Reference-DB
    // anreichern. Identische Semantik wie bei CustomFunction.
    if (enrich) {
      try {
        await referenceService.enrichFunctionTokens(payload.tokens, enrich);
        metaInfo = { ...metaInfo, enrich };
      } catch (e) {
        if (e.code === 'REF_LANG_INVALID') {
          throw createError('VALIDATION_ERROR', e.message, e.details || {});
        }
        if (e.code === 'REF_NOT_ATTACHED') {
          metaInfo = { ...metaInfo, enrich: null, enrich_error: e.code };
        } else {
          throw e;
        }
      }
    }

    metaInfo = {
      ...metaInfo,
      template_used: 'object_details_field_tokens',
    };
    debugSql = debug ? fldResult.sql : null;
  } else {
    throw createError(
      'VALIDATION_ERROR',
      `format=tokens is not supported for object type '${objectType}'`,
      { uuid, objectType, supported: ['Script', 'ScriptStep', 'CustomFunction', 'Field'] }
    );
  }

  return sendFormatted(res, payload, 'tokens', meta ? metaInfo : null, debugSql);
}

/**
 * GET /api/get-calc - Standalone calculation by hash (token format only)
 */
async function getCalc(req, res, next) {
  try {
    const { hash, format = 'tokens', meta, debug, enrich } = req.query;

    const result = await templateService.executeTemplate(
      'object_details_calculation_tokens',
      { hash },
      'report'
    );

    if (!result.data || result.data.length === 0) {
      throw createError(
        'OBJECT_NOT_FOUND',
        `Calculation with hash '${hash}' not found`,
        { hash }
      );
    }

    const payload = formatters.format(result.data, 'tokens', {
      kind: 'calculation',
      object: { hash },
    });

    const metaInfo = meta ? {
      template_used: 'object_details_calculation_tokens',
      hash,
    } : null;

    // ?enrich=<lang> — Calc-Token-Anreicherung via function_name_lookup (PRD §5.2)
    if (enrich) {
      try {
        await referenceService.enrichFunctionTokens(payload.tokens, enrich);
        if (metaInfo) metaInfo.enrich = enrich;
      } catch (e) {
        if (e.code === 'REF_LANG_INVALID') {
          throw createError('VALIDATION_ERROR', e.message, e.details || {});
        }
        if (e.code === 'REF_NOT_ATTACHED') {
          if (metaInfo) metaInfo.enrich_error = e.code;
        } else {
          throw e;
        }
      }
    }

    return sendFormatted(res, payload, format, metaInfo, debug ? result.sql : null);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/back-references — PRD prd_cross_references_hilite.md §6.3
 *
 * Liefert alle Objekt-UUIDs, die innerhalb eines Destination-Containers
 * (Layout / Script / CustomFunction) auf das Origin-Objekt verweisen.
 * Wird vom Frontend genutzt, um Cross-Reference-Highlights im Ziel-View
 * (z.B. LayoutCanvas matchUuids) vorzubelegen.
 *
 * Parameter:
 *   destination — Pflicht, UUID des aktuell geöffneten Objekts (Ziel-Container)
 *   origin      — Pflicht, UUID (oder Name) des auslösenden Objekts
 *   mode        — optional 'uuid' | 'name' | 'auto' (Default: auto)
 */
async function backReferences(req, res, next) {
  try {
    const { destination, origin, mode = 'auto', format = 'json', meta, debug } = req.query;

    const destUuid = String(destination || '').trim();
    let originRaw = String(origin || '').trim();

    if (!destUuid || !originRaw) {
      throw createError('VALIDATION_ERROR',
        'Parameter `destination` und `origin` sind beide erforderlich.',
        { destination: destUuid, origin: originRaw });
    }

    // Destination muss eine UUID sein und existieren.
    if (!UUID_REGEX.test(destUuid)) {
      throw createError('VALIDATION_ERROR',
        '`destination` muss eine UUID sein.', { destination: destUuid });
    }
    const destObj = await objectService.getByUUID(destUuid);

    // Origin: UUID-Format ODER Name-Lookup.
    const looksLikeUuid = UUID_REGEX.test(originRaw);
    const useUuid = mode === 'uuid' || (mode === 'auto' && looksLikeUuid);
    const useName = mode === 'name' || (mode === 'auto' && !looksLikeUuid);

    let originObj = null;
    let matchStrategy = 'uuid';

    if (useUuid) {
      try {
        const o = await objectService.getByUUID(originRaw);
        originObj = o.data;
        matchStrategy = 'uuid';
      } catch (e) {
        if (e.code !== 'OBJECT_NOT_FOUND') throw e;
        // Fallback auf Name, falls UUID nicht im ObjectCatalog existiert.
        if (mode === 'auto') {
          originObj = await lookupOriginByName(originRaw);
          matchStrategy = originObj ? 'name-fallback' : 'unresolved';
        }
      }
    } else if (useName) {
      originObj = await lookupOriginByName(originRaw);
      matchStrategy = originObj ? 'name' : 'unresolved';
    }

    // Origin nicht aufgelöst → Antwort mit leerer Match-Liste; Frontend zeigt
    // Pill mit Hinweis "Origin nicht gefunden".
    if (!originObj) {
      return res.json(buildSuccess({
        destination: {
          uuid: destObj.data.Object_UUID,
          type: destObj.data.Object_Type,
          name: destObj.data.Object_Name,
        },
        origin: null,
        matches: [],
        match_strategy: 'unresolved',
      }, meta ? { destination: destUuid, origin: originRaw, mode } : null));
    }

    const result = await templateService.executeTemplate(
      'back_references',
      { destination: destUuid, origin: originObj.Object_UUID },
      'report',
    );

    const payload = {
      destination: {
        uuid: destObj.data.Object_UUID,
        type: destObj.data.Object_Type,
        name: destObj.data.Object_Name,
      },
      origin: {
        uuid: originObj.Object_UUID,
        type: originObj.Object_Type,
        name: originObj.Object_Name,
        file: originObj.File_Name,
      },
      matches: result.data,
      match_strategy: matchStrategy,
    };

    const metaInfo = meta ? {
      destination: destUuid,
      origin: originRaw,
      mode,
      match_count: result.data.length,
      template_used: 'back_references',
    } : null;

    return sendFormatted(res, payload, format, metaInfo, debug ? result.sql : null);
  } catch (error) {
    next(error);
  }
}

/**
 * Origin-Name-Fallback: exakter Match bevorzugt, sonst kürzester Teiltreffer.
 * Bei Mehrdeutigkeit gewinnt der kürzeste Name (heuristisch der spezifischste).
 */
async function lookupOriginByName(name) {
  const sql = `
    SELECT Object_UUID, Object_Type, Object_Name, File_Name
    FROM ObjectCatalog
    WHERE Object_Name = ?
       OR Object_Name ILIKE ?
    ORDER BY (Object_Name = ?) DESC, length(Object_Name) ASC
    LIMIT 1
  `;
  const db = require('../config/database');
  const r = await db.executeQuery(sql, [name, `%${name}%`, name]);
  return r.rows[0] || null;
}

module.exports = {
  get,
  getDetails,
  getCalc,
  list,
  listCategories,
  listWithFolders,
  count,
  search,
  searchCount,
  references,
  backReferences,
};
