'use strict';

const db = require('../config/database');
const { parseCfFormat } = require('../utils/cf-css');

/**
 * Conditional-formatting rules of a layout object, rule-exact from
 * `LayoutObjectConditions` (self-anchored extraction — no nested child rules,
 * purely value-based conditions included). Serves both the standalone
 * `GET /api/conditional-formatting` endpoint and the conditions block of the
 * LayoutObject get-details payload; the field names of the previous inline
 * implementation are kept (frontend contract), `format` is additive.
 */

const asBool = (v) => v === true || v === 'True';

/**
 * All rules of one object, ordered by Rule_Index.
 *
 * @param {object} ctx  solution context (req.solutionContext)
 * @param {string} uuid resolved Object_UUID (caller disambiguates clones)
 * @param {string} fileName resolved File_Name
 * @returns {{ rules: Array<object>, unavailable?: boolean }}
 *   `unavailable` marks a catalog imported before schema 1.25.0 (table
 *   missing) — callers degrade gracefully instead of erroring.
 */
async function getRulesForObject(ctx, uuid, fileName) {
  let rows;
  try {
    const res = await db.executeQuery(
      ctx,
      `SELECT loc.Rule_Index, loc.Condition_Type, loc.Condition_Kind,
              loc.Options_Raw, loc.Calc_Text, loc.Range_Start, loc.Range_End,
              loc.Calc_Hash, loc.Calculation_UUID, loc.Local_CSS,
              (cc.DDR_Calc_UUID IS NOT NULL) AS Has_Tokens
       FROM LayoutObjectConditions loc
       LEFT JOIN CalculationsCatalog cc
         ON loc.Calculation_UUID = cc.Calculation_UUID AND loc.File_Name = cc.File_Name
       WHERE loc.Object_UUID = ? AND loc.File_Name = ?
       ORDER BY loc.Rule_Index`,
      [uuid, fileName]
    );
    rows = res.rows;
  } catch (e) {
    // Catalog before schema 1.25.0 has no LayoutObjectConditions table.
    return { rules: [], unavailable: true };
  }

  const rules = rows.map((r) => {
    const options = Number(r.Options_Raw ?? 0);
    return {
      ruleIndex: Number(r.Rule_Index),
      conditionType: Number(r.Condition_Type),
      conditionKind: r.Condition_Kind ?? null,
      // Options bit 0 = per-rule enable flag (fixture-verified).
      enabled: (options & 1) === 1,
      optionsRaw: options,
      calcText: r.Calc_Text ?? null,
      rangeStart: r.Range_Start ?? null,
      rangeEnd: r.Range_End ?? null,
      calcHash: r.Calc_Hash ?? null,
      calcUuid: r.Calculation_UUID ? String(r.Calculation_UUID) : null,
      hasTokens: asBool(r.Has_Tokens),
      format: parseCfFormat(r.Local_CSS, options),
    };
  });

  return { rules };
}

module.exports = { getRulesForObject };
