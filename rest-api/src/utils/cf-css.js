'use strict';

/**
 * Conditional-formatting LocalCSS parser.
 *
 * FileMaker serialises the applied format of every conditional-formatting rule
 * as a small CSS fragment (`LayoutObjectConditions.Local_CSS`) with exactly two
 * selectors: `self:normal .self` (text/object format) and `self:normal .icon`
 * (icon colour). The fragment always carries baseline noise — dialog state that
 * was never actively chosen — so raw property presence is NOT the same as "the
 * user picked this". Two authority models apply (fixture-verified):
 *
 *   - Bit-authoritative (Options bitmask): text colour (bit 1), fill colour
 *     (bit 2), font family (bit 3), font size (bit 4), icon colour (bit 7).
 *     The property only counts when its bit is set — the "Textformat" sub-
 *     dialog serialises font-family + font-size (typically 12pt) even when
 *     their checkboxes are unchecked, and `background-color`/`color` appear in
 *     every rule regardless of choice.
 *   - Presence-authoritative: the bit-less style toggles (bold, italic,
 *     underline variants, strikethrough, small caps, condense/extend,
 *     super-/subscript, highlight, case transform) materialise only as CSS
 *     properties and set no Options bit.
 *
 * Bit 0 is the per-rule enable flag (owned by the caller, not this parser).
 * `box-shadow` is serialisation noise and is never mapped. Unknown properties
 * and values are ignored — callers ship the raw CSS alongside, so nothing is
 * lost for display purposes.
 */

/** Options bitmask (LayoutObjectConditions.Options_Raw). */
const CF_OPTION_BITS = {
  ENABLED: 1,
  TEXT_COLOR: 2,
  FILL_COLOR: 4,
  FONT_FAMILY: 8,
  FONT_SIZE: 16,
  ICON_COLOR: 128,
};

/**
 * Split a LocalCSS fragment into its `.self` / `.icon` declaration maps.
 * Later duplicates of a property win (CSS semantics). Selectors other than
 * the two known ones are ignored.
 */
function parseBlocks(css) {
  const self = new Map();
  const icon = new Map();
  if (!css) return { self, icon };

  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css)) !== null) {
    const selector = m[1].trim();
    const target = selector.includes('.icon') ? icon
      : selector.includes('.self') ? self
      : null;
    if (!target) continue;

    for (const decl of m[2].split(';')) {
      const idx = decl.indexOf(':');
      if (idx < 1) continue;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).trim();
      if (prop && value) target.set(prop, value);
    }
  }
  return { self, icon };
}

/**
 * Normalise FileMaker's percent-channel colours to hex.
 * `rgba(85.098%,4.31373%,0%,1)` → `#d90b00`; alpha < 1 → `#rrggbbaa`.
 * Unparseable values are returned as-is (tolerant parser).
 */
function normalizeColor(value) {
  if (!value) return null;
  const m = /^rgba?\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i
    .exec(value.trim());
  if (!m) return value.trim();

  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  let hex = `#${hex2(Number(m[1]) * 2.55)}${hex2(Number(m[2]) * 2.55)}${hex2(Number(m[3]) * 2.55)}`;
  if (alpha < 1) hex += hex2(alpha * 255);
  return hex;
}

/** `-fm-font-family(Helvetica Neue,HelveticaNeue)` → `Helvetica Neue`. */
function parseFontFamily(value) {
  if (!value) return null;
  const m = /-fm-font-family\(\s*([^,)]+)/i.exec(value);
  return m ? m[1].trim() : value.trim();
}

/**
 * Derive ready-to-use web CSS (React style-object keys) for the format
 * preview sample. Only actively chosen aspects are emitted. Approximations:
 * `word-underline` has no native equivalent and renders as plain underline
 * (the semantic `underline` field still says `word-underline`); the icon
 * colour and highlight are semantic-only (the preview renders the highlight
 * as an inline text background, distinct from the fill colour). Super-/
 * subscript emits `verticalAlign` only — the FileMaker-faithful glyph shrink
 * (~60%) cannot live here because a single style object has one font-size
 * slot, already owned by the chosen size; renderers apply the shrink on an
 * inner span from the semantic `glyphVariant` field instead.
 */
function toPreviewCss(fmt) {
  const css = {};
  if (fmt.textColor) css.color = fmt.textColor;
  if (fmt.fillColor) css.backgroundColor = fmt.fillColor;
  if (fmt.fontFamily) css.fontFamily = fmt.fontFamily;
  if (fmt.fontSize) css.fontSize = fmt.fontSize;
  if (fmt.bold) css.fontWeight = 'bold';
  if (fmt.italic) css.fontStyle = 'italic';

  const deco = [];
  if (fmt.underline) deco.push('underline');
  if (fmt.strikethrough) deco.push('line-through');
  if (deco.length > 0) css.textDecorationLine = deco.join(' ');
  if (fmt.underline === 'double-underline') css.textDecorationStyle = 'double';

  if (fmt.smallCaps) css.fontVariant = 'small-caps';
  if (fmt.stretch) css.fontStretch = fmt.stretch;
  if (fmt.textTransform) css.textTransform = fmt.textTransform;
  if (fmt.glyphVariant === 'superscript') css.verticalAlign = 'super';
  if (fmt.glyphVariant === 'subscript') css.verticalAlign = 'sub';
  return css;
}

/**
 * Parse one rule's LocalCSS + Options bitmask into the structured format
 * object served by the conditional-formatting API. The per-rule enable flag
 * (bit 0) is rule-level state and deliberately NOT part of the format.
 */
function parseCfFormat(localCss, optionsRaw) {
  const options = Number(optionsRaw) || 0;
  const has = (bit) => (options & bit) === bit;
  const { self, icon } = parseBlocks(localCss);

  const fmt = {
    // Bit-authoritative choices — property only counts with its bit set.
    textColor: has(CF_OPTION_BITS.TEXT_COLOR) ? normalizeColor(self.get('color')) : null,
    fillColor: has(CF_OPTION_BITS.FILL_COLOR) ? normalizeColor(self.get('background-color')) : null,
    fontFamily: has(CF_OPTION_BITS.FONT_FAMILY) ? parseFontFamily(self.get('font-family')) : null,
    fontSize: has(CF_OPTION_BITS.FONT_SIZE) ? (self.get('font-size') ?? null) : null,
    iconColor: has(CF_OPTION_BITS.ICON_COLOR) ? normalizeColor(icon.get('-fm-icon-color')) : null,

    // Presence-authoritative style toggles (no Options bit exists for these).
    bold: self.get('font-weight') === 'bold',
    italic: self.get('font-style') === 'italic',
    underline: self.get('-fm-underline') ?? null,
    strikethrough: self.has('-fm-strikethrough'),
    smallCaps: self.get('font-variant') === 'small-caps',
    stretch: self.get('font-stretch') ?? null,
    glyphVariant: self.get('-fm-glyph-variant') ?? null,
    textTransform: self.get('text-transform') ?? null,
    highlightColor: normalizeColor(self.get('-fm-highlight-color')),
  };

  fmt.css = toPreviewCss(fmt);
  fmt.raw = localCss ?? null;
  return fmt;
}

module.exports = { parseCfFormat, normalizeColor, CF_OPTION_BITS };
