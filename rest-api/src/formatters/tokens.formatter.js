/**
 * Tokens Formatter
 *
 * Builds the structured `format=tokens` payload for Scripts, Custom Functions
 * and Calculations. Operates on three different shapes of input rows:
 *   - Script:         rows from object_details_script_tokens.sql
 *   - CustomFunction: rows from object_details_customfunction_tokens.sql
 *   - Calculation:    rows from object_details_calculation_tokens.sql
 *
 * The caller decides which shape via options.kind.
 */

const crypto = require('crypto');
const { isContainerPlugin } = require('../services/plugin-token-registry');

// Deterministischer md5-Hash zur Erzeugung synthetischer ObjectCatalog-UUIDs
// (PRD prd_pseudo_object_types_filter.md §5). Hex-output, kleinbuchstaben —
// identisch zur DuckDB-md5() Konvention im create_universal_catalogs.sql.
function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

const CHUNK_TYPE_MAP = {
  NoRef: 'text',
  FunctionRef: 'function',
  CustomFunctionRef: 'customFunction',
  PluginFunctionRef: 'pluginFunction',
  VariableReference: 'variable',
  FieldRef: 'field',
  Comment: 'comment',
};

const CHUNK_RE = /^<Chunk[^>]*>([\s\S]*)<\/Chunk>$/;

// MBS-Style Container-Plugin: erstes Argument ist ein quoted String mit dem
// fachlichen Funktionsnamen. Pattern matcht den ersten doppelt-quoted String
// nach optionalem Whitespace und der öffnenden Klammer im Folge-NoRef-Chunk.
// Bsp:  '( "List.AddPrefix" ; '  →  'List.AddPrefix'
const FIRST_QUOTED_ARG_RE = /\(\s*"([^"]+)"/;

// FieldRef chunks contain nested XML with FieldReference + TableOccurrenceReference.
const FIELD_REF_RE = /<FieldReference[^>]*\bname="([^"]*)"[^>]*\bUUID="([^"]*)"/;
const TO_REF_RE = /<TableOccurrenceReference[^>]*\bname="([^"]*)"/;

/**
 * Strip the outer <Chunk type="…">…</Chunk> wrapper.
 */
function stripChunkWrap(s) {
  if (!s) return '';
  const m = CHUNK_RE.exec(s);
  return m ? m[1] : s;
}

/**
 * Decode the small set of XML numeric character references that appear in the
 * DDR data. The raw chunks come from the FileMaker XML export, so &#xB6; etc.
 * pass through as-is.
 */
function decodeXmlEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Build a token from a raw DDR_Calculations chunk row.
 *
 * For most chunk types the token's `content` is just the inner text of the
 * Chunk wrapper. FieldRef is special: its inner XML carries field name, table
 * occurrence name and field UUID — we surface a "TO::Field" content string
 * plus the resolved UUID.
 *
 * Optionale Parameter `idx` und `allChunks` werden für die `subFunction`-
 * Auflösung von MBS-Style Container-Plugins genutzt (PRD prd_rest_api_plugin_docs_subfunction.md).
 * Werden sie weggelassen (z.B. von Test-Aufrufern), bleibt das Verhalten für
 * pluginFunction-Tokens identisch zur v1 — kein `subFunction`-Feld.
 */
function tokenFromChunk(chunk, idx, allChunks) {
  const dbType = chunk.chunk_type;
  const apiType = CHUNK_TYPE_MAP[dbType] || 'text';
  const inner = stripChunkWrap(chunk.chunk_content);

  if (apiType === 'field') {
    const fieldMatch = FIELD_REF_RE.exec(inner);
    const toMatch = TO_REF_RE.exec(inner);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const fieldUuid = fieldMatch[2];
      const toName = toMatch ? toMatch[1] : null;
      const content = toName ? `${toName}::${fieldName}` : fieldName;
      const tok = { type: 'field', content };
      if (fieldUuid) tok.uuid = fieldUuid;
      return tok;
    }
    // Defensive fallback: malformed FieldRef — pass through as text.
    return { type: 'text', content: decodeXmlEntities(inner) };
  }

  const content = decodeXmlEntities(inner);
  const tok = { type: apiType, content };

  if (apiType === 'variable') {
    tok.scope = content.startsWith('$$') ? 'global' : 'local';
  }

  // Container-Plugin (MBS): den fachlichen Funktionsnamen aus dem Folge-NoRef-
  // Chunk extrahieren. Achtung — die DDR-Chunk-Reihenfolge ist nicht streng
  // linear (siehe Beobachtungen in convert_xml.sql / MBS_SubnameMap), deshalb
  // versuchen wir zuerst den direkten Nachbarn (idx+1) und fallen auf den
  // direkten Vorgänger (idx-1) zurück. Bei Multi-MBS-Calcs ist das nicht 100%
  // robust — der zuverlässige Pfad läuft über `lines[].refs.subFunction`, das
  // server-seitig per ROW_NUMBER-Mapping aufgelöst wird (siehe SQL-Pipeline).
  if (apiType === 'pluginFunction' && isContainerPlugin(content) && Array.isArray(allChunks)) {
    const sub = extractSubFunctionFromNeighbors(idx, allChunks);
    if (sub) tok.subFunction = sub;
  }

  // Synthetische ObjectCatalog-UUIDs für Cross-Navigation
  // (PRD prd_pseudo_object_types_filter.md §5).
  // BuiltinFunction: deterministisch via md5('BuiltinFunction::' + name).
  //                  Boolean-Operatoren (and/or/not/xor) haben keinen Catalog-
  //                  Eintrag — wir setzen die UUID trotzdem; das Frontend filtert
  //                  Tot-Links per Link-Validierung gegen das ObjectCatalog
  //                  (Routing zur Detail-Seite würde sonst 404 liefern).
  //                  Pragmatisch: bei diesen vier bleiben wir uuidlos.
  if (apiType === 'function' && !['and', 'or', 'not', 'xor'].includes(content)) {
    tok.uuid = md5(`BuiltinFunction::${content}`);
  }
  if (apiType === 'pluginFunction') {
    tok.uuid = md5(`PluginFunction::${content}::${tok.subFunction || ''}`);
  }

  return tok;
}

/**
 * Versöhnt eine Token-Liste mit dem Plain-Text-Counterpart. FileMaker lässt im
 * DDR-XML-Export gelegentlich NoRef-Chunks weg (insbesondere zwischen einer
 * VariableReference und einem nachfolgenden PluginFunctionRef, z.B. `c = MBS(…)`),
 * sodass die Tokens beim reinen Konkatenieren Operator/Whitespace verlieren.
 *
 * Strategie: sequenzielles Vorwärts-Matching. Jedes Token wird ab der letzten
 * End-Position im Plain-Text gesucht; liegt es weiter rechts als erwartet, füllt
 * ein synthetisches `text`-Token die Lücke. Wird ein Token nicht gefunden
 * (mehrdeutiger Match, FieldRef ohne TO-Präfix im CDATA o.ä.), wird die
 * ursprüngliche Liste unverändert zurückgegeben — kein Regressionsrisiko.
 *
 * Normalisierung: CRLF/CR → LF auf beiden Seiten, weil DDR-Chunks per
 * `decodeXmlEntities` CR enthalten, das CDATA-Plain-Text aber LF.
 */
function reconcileTokensWithPlainText(tokens, plainText) {
  if (!plainText || !Array.isArray(tokens) || tokens.length === 0) return tokens;

  const norm = (s) => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n') : '');
  const normPlain = norm(plainText);

  const positioned = [];
  let cursor = 0;

  for (const tok of tokens) {
    const needle = norm(tok.content);
    if (!needle) {
      positioned.push({ tok, start: cursor, end: cursor });
      continue;
    }
    const pos = normPlain.indexOf(needle, cursor);
    if (pos === -1) {
      // Token nicht im Plain-Text auffindbar — Reconcile abbrechen.
      return tokens;
    }
    positioned.push({ tok, start: pos, end: pos + needle.length });
    cursor = pos + needle.length;
  }

  const out = [];
  let prevEnd = 0;
  for (const { tok, start, end } of positioned) {
    if (start > prevEnd) {
      out.push({ type: 'text', content: normPlain.slice(prevEnd, start) });
    }
    out.push(tok);
    prevEnd = end;
  }
  if (prevEnd < normPlain.length) {
    out.push({ type: 'text', content: normPlain.slice(prevEnd) });
  }
  return out;
}

/**
 * Sucht den fachlichen MBS-Funktionsnamen in den Nachbar-NoRef-Chunks. Die
 * Calc-Engine schreibt den Aufruf-Token (`MBS`) und den ersten Argument-NoRef
 * `( "Foo.Bar"; ` direkt nebeneinander, allerdings nicht immer in derselben
 * Richtung. Wir versuchen idx+1 zuerst (häufigster Fall: prefix), dann idx-1
 * (postfix-ähnliche Notation).
 */
function extractSubFunctionFromNeighbors(idx, allChunks) {
  if (typeof idx !== 'number' || !allChunks) return null;
  for (const offset of [1, -1]) {
    const cand = allChunks[idx + offset];
    if (!cand || cand.chunk_type !== 'NoRef') continue;
    const inner = stripChunkWrap(cand.chunk_content);
    const m = FIRST_QUOTED_ARG_RE.exec(inner);
    if (m) return m[1];
  }
  return null;
}

function formatScript(rows, { object, refs }) {
  // Dedup pro Zeile (PRD prd_rest_api_token_extended_infos.md §5.5):
  //   - Variables:       (type, name, scope, usage) — Set/Read sind unterschiedliche Refs
  //   - Fields:          (type, name, table) — gleiches Feld via unterschiedlicher TO = unterschiedliche Refs
  //   - PluginFunctions: (type, name, subFunction) — zwei MBS-Aufrufe mit unter-
  //                      schiedlicher subFunction in derselben Step-Calc bleiben
  //                      eigenständige Refs (PRD prd_rest_api_plugin_docs_subfunction.md §6).
  //   - Andere:          (type, name)
  // Step-Refs (source_priority=0) kommen vor Calc-Refs durch ORDER BY im Template
  // — first-wins-Semantik sorgt dafür, dass Step-XML-Refs gewinnen.
  const refsByLine = {};
  const seenByLine = {};
  if (Array.isArray(refs)) {
    for (const r of refs) {
      const slot = (refsByLine[r.line_index] ??= []);
      const seen = (seenByLine[r.line_index] ??= new Set());

      let dedupKey;
      if (r.type === 'variable') {
        dedupKey = `${r.type}|${r.name}|${r.variable_scope ?? ''}|${r.variable_usage ?? ''}`;
      } else if (r.type === 'pluginFunction') {
        dedupKey = `${r.type}|${r.name}|${r.sub_function ?? ''}`;
      } else if (r.to_name) {
        dedupKey = `${r.type}|${r.name}|${r.to_name}`;
      } else {
        dedupKey = `${r.type}|${r.name}`;
      }
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const entry = { type: r.type, name: r.name };
      if (r.uuid)            entry.uuid      = r.uuid;
      if (r.field_file)      entry.file      = r.field_file;
      if (r.to_name)         entry.table     = r.to_name;
      if (r.field_basetable) entry.baseTable = r.field_basetable;
      // crossFile/dataSource für Field-, Script- und tableOccurrence-Refs.
      // tableOccurrence kommt aus GTRR (PRD prd_rest_api_token_gtrr.md §4.4):
      // ein Sprung zu einer TO mit Cross-File-DataSource ist semantisch ein
      // dateiübergreifender Navigations-Sprung. Variables/PluginFunctions haben
      // kein Cross-File-Konzept.
      if ((r.type === 'field' || r.type === 'script' || r.type === 'tableOccurrence') && r.cross_file) {
        entry.crossFile = true;
        if (r.data_source) entry.dataSource = r.data_source;
      }
      if (r.variable_scope) entry.scope = r.variable_scope;
      if (r.variable_usage) entry.usage = r.variable_usage;
      // subFunction (PRD prd_rest_api_plugin_docs_subfunction.md §2.2):
      // fachlicher Funktionsname für Container-Plugins (heute: MBS).
      if (r.type === 'pluginFunction' && r.sub_function) {
        entry.subFunction = r.sub_function;
      }
      slot.push(entry);
    }
  }

  const lines = rows.map(row => {
    const base = {
      line: row.line_index + 1,
      indent: row.indent,
      kind: row.kind,
      enabled: row.enabled !== false,
    };

    if (row.kind === 'empty') {
      return base;
    }

    if (row.kind === 'comment') {
      const stepText = row.step_text || '';
      // Strip the leading '#' (and any whitespace after it) — the kind already
      // marks this as a comment, the text should be the comment content alone.
      const text = stepText.replace(/^#\s?/, '');
      return { ...base, text };
    }

    const lineRefs = refsByLine[row.line_index];
    return {
      ...base,
      stepId: row.step_id,
      stepName: row.step_name,
      stepUuid: row.step_uuid,
      stepTypeUuid: row.step_type_uuid,
      text: row.step_text || row.step_name,
      ...(lineRefs && lineRefs.length ? { refs: lineRefs } : {}),
    };
  });

  const plainText = lines.map(line => {
    if (line.kind === 'empty') return '';
    const pad = '  '.repeat(line.indent || 0);
    if (line.kind === 'comment') return `${pad}# ${line.text}`;
    return pad + (line.text || '');
  }).join('\n');

  return {
    kind: 'script',
    object,
    lines,
    plainText,
  };
}

function formatCustomFunction(rows, { object }) {
  if (!rows || rows.length === 0) {
    return {
      kind: 'customfunction',
      object,
      parameters: [],
      tokens: [],
      plainText: '',
    };
  }

  const head = rows[0];
  const enrichedObject = {
    ...object,
    uuid: head.object_uuid || object.uuid,
    name: head.object_name || object.name,
    file: head.object_file || object.file,
  };

  const chunkRows = rows
    .filter(r => r.chunk_index !== null && r.chunk_index !== undefined)
    .map(r => ({ chunk_type: r.chunk_type, chunk_content: r.chunk_content }));
  const rawTokens = chunkRows.map((c, i, arr) => tokenFromChunk(c, i, arr));

  const tokens = head.plain_text != null
    ? reconcileTokensWithPlainText(rawTokens, head.plain_text)
    : rawTokens;

  const plainText = head.plain_text != null
    ? head.plain_text
    : tokens.map(t => t.content).join('');

  return {
    kind: 'customfunction',
    object: enrichedObject,
    parameters: head.parameters || [],
    tokens,
    plainText,
  };
}

function formatField(rows, { object }) {
  if (!rows || rows.length === 0) {
    return {
      kind: 'field',
      object,
      field: null,
      tokens: [],
      plainText: '',
    };
  }

  const head = rows[0];
  const enrichedObject = {
    ...object,
    uuid: head.object_uuid || object.uuid,
    name: head.object_name || object.name,
    file: head.object_file || object.file,
  };

  const fieldMeta = {
    table:           head.table_name ?? null,
    fieldType:       head.field_type ?? null,
    dataType:        head.data_type ?? null,
    isGlobal:        head.is_global === true || head.is_global === 'True',
    maxRepetitions:  head.max_repetitions != null ? Number(head.max_repetitions) : 1,
    comment:         head.field_comment ?? null,
    autoEnterType:   head.auto_enter_type ?? null,
  };

  const chunkRows = rows
    .filter(r => r.chunk_index !== null && r.chunk_index !== undefined)
    .map(r => ({ chunk_type: r.chunk_type, chunk_content: r.chunk_content }));
  const rawTokens = chunkRows.map((c, i, arr) => tokenFromChunk(c, i, arr));

  const tokens = head.plain_text != null
    ? reconcileTokensWithPlainText(rawTokens, head.plain_text)
    : rawTokens;

  const plainText = head.plain_text != null
    ? head.plain_text
    : tokens.map(t => t.content).join('');

  return {
    kind: 'field',
    object: enrichedObject,
    field: fieldMeta,
    tokens,
    plainText,
  };
}

function formatCalculation(rows, { object }) {
  const chunkRows = (rows || []).map(r => ({
    chunk_type: r.chunk_type,
    chunk_content: r.chunk_content,
  }));
  const tokens = chunkRows.map((c, i, arr) => tokenFromChunk(c, i, arr));

  return {
    kind: 'calculation',
    object,
    tokens,
    plainText: tokens.map(t => t.content).join(''),
  };
}

/**
 * Public entry point.
 *
 * @param {Array} data - Rows from the appropriate SQL template
 * @param {Object} options - { kind, object, refs? }
 *   - kind:   'script' | 'customfunction' | 'calculation'
 *   - object: { uuid, name, file } or { hash } for calculations
 *   - refs:   optional array of script reference rows (only for kind=script)
 * @returns {Object} Token-format payload
 */
function format(data, options = {}) {
  const { kind, object = {}, refs } = options;

  switch (kind) {
    case 'script':
      return formatScript(data || [], { object, refs });
    case 'customfunction':
      return formatCustomFunction(data || [], { object });
    case 'field':
      return formatField(data || [], { object });
    case 'calculation':
      return formatCalculation(data || [], { object });
    default:
      throw new Error(`tokens formatter: unknown kind '${kind}'`);
  }
}

module.exports = {
  format,
  // Exported for testing
  tokenFromChunk,
  stripChunkWrap,
  decodeXmlEntities,
  reconcileTokensWithPlainText,
  CHUNK_TYPE_MAP,
};
