const templateService = require('../services/template.service');
const db = require('../config/database');
const { sendFormatted } = require('../utils/response-builder');
const { createError } = require('../middleware/error-handler');

/**
 * Relationship Graph Controller
 *
 * Liefert TOs (mit Geometrie + Farbe), Felder pro BaseTable, und Beziehungen
 * pro JoinPredicate als aggregiertes JSON für eine FileMaker-Datei.
 */

/**
 * Operator-Symbol-Mapping für JoinPredicates.
 * Wird sowohl im Backend als auch im Frontend benötigt — hier serverseitig
 * eingespielt, damit der Client das Symbol direkt anzeigen kann.
 */
const OPERATOR_SYMBOLS = {
  Equal: '=',
  NotEqual: '≠',
  Less: '<',
  LessOrEqual: '≤',
  Greater: '>',
  GreaterOrEqual: '≥',
  Cartesian: '×',
};

async function fileExists(ctx, fileName) {
  const result = await db.executeQuery(
    ctx,
    `SELECT COUNT(*) as cnt FROM FilesCatalog WHERE File_Name = '${fileName.replace(/'/g, "''")}'`
  );
  const row = result.rows[0];
  const cnt = typeof row.cnt === 'bigint' ? Number(row.cnt) : row.cnt;
  return cnt > 0;
}

function buildViewport(tos) {
  if (tos.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tos) {
    if (t.bounds.left == null) continue;
    if (t.bounds.left < minX) minX = t.bounds.left;
    if (t.bounds.right > maxX) maxX = t.bounds.right;
    if (t.bounds.top < minY) minY = t.bounds.top;
    if (t.bounds.bottom > maxY) maxY = t.bounds.bottom;
  }

  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

/**
 * GET /api/relationship-graph/:fileName
 * Aggregiert TOs + Relationships + Fields zu einer kompletten Diagramm-Sicht.
 */
async function getGraph(req, res, next) {
  try {
    const { fileName } = req.params;
    const { format = 'json', meta, debug } = req.query;

    if (!(await fileExists(req.solutionContext, fileName))) {
      throw createError(
        'OBJECT_NOT_FOUND',
        `File '${fileName}' not found in FilesCatalog`,
        { fileName }
      );
    }

    const [tosResult, relsResult, fieldsResult] = await Promise.all([
      templateService.executeTemplate(req.solutionContext, 'relationship_graph_tos', { file_name: fileName }, 'report'),
      templateService.executeTemplate(req.solutionContext, 'relationship_graph_relationships', { file_name: fileName }, 'report'),
      templateService.executeTemplate(req.solutionContext, 'relationship_graph_fields', { file_name: fileName }, 'report'),
    ]);

    const fieldsByTableUuid = new Map();
    const fieldByUuid = new Map();
    for (const f of fieldsResult.data) {
      const list = fieldsByTableUuid.get(f.Table_UUID) || [];
      list.push(f);
      fieldsByTableUuid.set(f.Table_UUID, list);
      fieldByUuid.set(f.Field_UUID, f);
    }

    // Welche Felder werden in einer Beziehung dieses TOs genutzt?
    // → Map: TO_UUID → Set<Field_UUID>
    const fieldsInRelationByTo = new Map();
    for (const r of relsResult.data) {
      if (r.Left_TO_UUID && r.Left_Field_UUID) {
        const set = fieldsInRelationByTo.get(r.Left_TO_UUID) || new Set();
        set.add(r.Left_Field_UUID);
        fieldsInRelationByTo.set(r.Left_TO_UUID, set);
      }
      if (r.Right_TO_UUID && r.Right_Field_UUID) {
        const set = fieldsInRelationByTo.get(r.Right_TO_UUID) || new Set();
        set.add(r.Right_Field_UUID);
        fieldsInRelationByTo.set(r.Right_TO_UUID, set);
      }
    }

    const tableOccurrences = tosResult.data.map(to => {
      const view = to.View_State || 'Full';
      const allFields = fieldsByTableUuid.get(to.BT_UUID) || [];
      const usedFields = fieldsInRelationByTo.get(to.TO_UUID) || new Set();

      // Vereinfachte Anzeige-Strategie: Full und Related zeigen beide nur die
      // an Beziehungen beteiligten Felder. Collapse zeigt keine Felder.
      // Damit bleiben die Boxen kompakt — nahe am FileMaker-Original.
      let fields;
      if (view === 'Collapse') {
        fields = [];
      } else {
        fields = allFields.filter(f => usedFields.has(f.Field_UUID));
      }

      return {
        uuid: to.TO_UUID,
        id: to.TO_ID,
        name: to.TO_Name,
        type: to.TO_Type,
        baseTable: to.BT_UUID ? { name: to.BT_Name, uuid: to.BT_UUID } : null,
        dataSource: to.DS_UUID ? { name: to.DS_Name, uuid: to.DS_UUID } : null,
        view,
        bounds: {
          top: to.Coord_Top,
          left: to.Coord_Left,
          bottom: to.Coord_Bottom,
          right: to.Coord_Right,
        },
        height: to.Box_Height,
        color:
          to.Color_R == null
            ? null
            : {
                r: to.Color_R,
                g: to.Color_G,
                b: to.Color_B,
                a: to.Color_Alpha,
              },
        fields: fields.map(f => ({
          uuid: f.Field_UUID,
          id: f.Field_ID,
          name: f.Field_Name,
          type: f.Field_Type,
          dataType: f.Data_Type,
          isUsedInRelation: usedFields.has(f.Field_UUID),
        })),
      };
    });

    // RelationshipCatalog enthält eine Zeile pro JoinPredicate.
    // Wir gruppieren nach Rel_ID, um eine Beziehung mit n Predicates wieder zu vereinen.
    const relsById = new Map();
    for (const r of relsResult.data) {
      const key = r.Rel_ID;
      if (!relsById.has(key)) {
        relsById.set(key, {
          id: r.Rel_ID,
          left: {
            toUuid: r.Left_TO_UUID,
            toName: r.Left_TO_Name,
            cascadeCreate: r.Left_Create === true,
            cascadeDelete: r.Left_Delete === true,
          },
          right: {
            toUuid: r.Right_TO_UUID,
            toName: r.Right_TO_Name,
            cascadeCreate: r.Right_Create === true,
            cascadeDelete: r.Right_Delete === true,
          },
          predicates: [],
        });
      }
      relsById.get(key).predicates.push({
        operator: r.Operator,
        symbol: OPERATOR_SYMBOLS[r.Operator] || r.Operator,
        leftFieldUuid: r.Left_Field_UUID,
        leftFieldName: r.Left_Field_Name,
        rightFieldUuid: r.Right_Field_UUID,
        rightFieldName: r.Right_Field_Name,
      });
    }
    const relationships = Array.from(relsById.values());

    const payload = {
      file: fileName,
      viewport: buildViewport(tableOccurrences),
      tableOccurrences,
      relationships,
    };

    const metaInfo = meta
      ? {
          file: fileName,
          to_count: tableOccurrences.length,
          relationship_count: relationships.length,
          predicate_count: relsResult.data.length,
        }
      : null;

    const debugSql = debug
      ? `${tosResult.sql}\n\n-- relationships:\n${relsResult.sql}\n\n-- fields:\n${fieldsResult.sql}`
      : null;

    return sendFormatted(res, payload, format, metaInfo, debugSql);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getGraph,
};
