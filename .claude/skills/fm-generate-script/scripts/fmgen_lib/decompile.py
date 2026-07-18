"""Reverse direction: fmxmlsnippet XML -> IR -> canonical text.

Table-driven inversion of emit.py: the same snippet templates from
fm_spec.step_xml_map are matched AGAINST actual step XML, extracting the
placeholder values back into ParsedStep options; render_canonical() then
produces the text form. One knowledge source, both directions.

Lossiness contract: anything the template cannot account for (unknown step
ids, missing templates, literal mismatches, extra elements/attributes) marks
the step as lossy and emits a `# fmgen:unsupported …` comment line above the
best-effort text (or instead of it when nothing renders). Nothing is dropped
silently.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .db import Database, Reference
from .textform import ParsedStep, render_canonical, render_ref, strip_strings

# One placeholder as the complete attribute value / element text:
# {key}, {key|default}, {key:sub}, {key:sub?}
_PH_RE = re.compile(r"^\{([a-z0-9_]+)(?::([a-z_]+))?(?:\|([^{}]*))?(\?)?\}$")

# Presentational block indentation (T7) — incomplete on purpose, cosmetic only.
_BLOCK_OPEN = {"If", "Loop"}
_BLOCK_CLOSE = {"End If", "End Loop"}
_BLOCK_MID = {"Else", "Else If"}


@dataclass
class DecompiledStep:
    index: int
    step_id: int | None
    canonical_name: str | None
    enabled: bool = True
    text: str | None = None
    issues: list[str] = field(default_factory=list)
    """Lossy findings — anything here means information was NOT carried over."""
    notes: list[str] = field(default_factory=list)
    """Non-lossy transformations (e.g. calc canonicalization DE → EN)."""

    @property
    def lossy(self) -> bool:
        return bool(self.issues)


@dataclass
class DecompileResult:
    text: str = ""
    steps: list[DecompiledStep] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def lossy_count(self) -> int:
        return len([s for s in self.steps if s.lossy])


class _Extractor:
    """Collects option values / reference parts while matching one step."""

    def __init__(self) -> None:
        self.options: dict = {}
        self.refparts: dict[str, dict] = {}
        self.defaults: dict[str, str] = {}
        self.issues: list[str] = []

    def set_scalar(self, key: str, value: str, default: str | None) -> None:
        self.options[key] = value
        if default is not None:
            self.defaults[key] = default

    def set_refpart(self, key: str, sub: str, value: str) -> None:
        self.refparts.setdefault(key, {})[sub] = value


def _ref_placeholder_keys(elem: ET.Element) -> set[str]:
    keys = set()
    for v in elem.attrib.values():
        m = _PH_RE.match(v.strip())
        if m and m.group(2):
            keys.add(m.group(1))
    return keys


def _match(tpl: ET.Element, act: ET.Element, ex: _Extractor) -> None:
    # --- attributes ---
    for k, tv in tpl.attrib.items():
        m = _PH_RE.match(tv.strip())
        av = act.attrib.get(k)
        if m:
            key, sub, default, _opt = m.groups()
            if av is None:
                continue  # pruned / optional attribute
            if sub:
                ex.set_refpart(key, sub, av)
            else:
                ex.set_scalar(key, av, default)
        else:
            # `name` on the Step root is display data (localized in non-EN
            # exports) — the id attribute is authoritative.
            if av is None:
                ex.issues.append(f"<{act.tag}> misses attribute '{k}'")
            elif av != tv and not (act.tag == "Step" and k in ("enable", "name")):
                ex.issues.append(
                    f"<{act.tag}> attribute '{k}': expected '{tv}', found '{av}'")
    for k in act.attrib:
        if k not in tpl.attrib and not (act.tag == "Step" and k == "enable"):
            ex.issues.append(f"<{act.tag}> has unexpected attribute '{k}'")

    # --- element text ---
    ttext = (tpl.text or "").strip()
    raw = act.text or ""
    atext = raw.strip() if "\n" in raw else raw  # mirror of the serializer rule
    m = _PH_RE.match(ttext) if ttext else None
    ref_keys = _ref_placeholder_keys(tpl)
    if m:
        key, sub, default, _opt = m.groups()
        if sub:
            ex.set_refpart(key, sub, atext)
        else:
            ex.set_scalar(key, atext, default)
    elif ttext:
        if atext != ttext:
            ex.issues.append(
                f"<{act.tag}> text: expected '{ttext}', found '{atext.strip()}'")
    elif atext.strip():
        if ref_keys and not act.attrib:
            # Variable collapse (see emit._collapse_variable_targets): the
            # template's reference attributes were replaced by plain text.
            key = next(iter(ref_keys))
            ex.refparts.setdefault(key, {})["name"] = atext.strip()
            ex.refparts[key]["_form"] = "variable"
        else:
            ex.issues.append(f"<{act.tag}> has unexpected text content")

    # --- children (pair by tag, in order) ---
    achildren = list(act)
    used = [False] * len(achildren)
    for tc in list(tpl):
        ai = next(
            (i for i, a in enumerate(achildren) if not used[i] and a.tag == tc.tag),
            None,
        )
        if ai is None:
            continue  # pruned in the actual XML — option absent
        used[ai] = True
        _match(tc, achildren[ai], ex)
    for i, a in enumerate(achildren):
        if not used[i]:
            ex.issues.append(f"<{act.tag}> has unexpected element <{a.tag}>")


def _finish_refs(ex: _Extractor, catalog: Database | None, file: str | None) -> None:
    for key, parts in ex.refparts.items():
        form = parts.pop("_form", None)
        if form == "variable":
            ex.options[key] = {"name": parts.get("name", ""), "_form": "variable"}
            continue
        ref: dict = {"name": parts.get("name", ""), "_form": "named"}
        if parts.get("table"):
            ref["table"] = parts["table"]
            ref["_form"] = "field"
        if parts.get("repetition"):
            ref["repetition"] = parts["repetition"]
        if parts.get("id"):
            ref["id"] = parts["id"]
        if ref["_form"] == "named" and key == "layout":
            table = _layout_to(catalog, file, ref.get("name", ""))
            if table:
                ref["table"] = table
                ref["_form"] = "layout"
            else:
                ex.issues.append(
                    f"layout '{ref.get('name', '')}': table occurrence unknown "
                    "(no catalog match) — reference rendered name-only")
        ex.options[key] = ref


def _layout_to(catalog: Database | None, file: str | None, name: str) -> str | None:
    if catalog is None or not name:
        return None
    esc = name.replace("'", "''")
    clause = f" AND File_Name = '{file.replace(chr(39), chr(39) * 2)}'" if file else ""
    try:
        rows = catalog.query(
            f"SELECT L_TO_Name FROM Layouts WHERE L_Name = '{esc}'{clause} LIMIT 2")
    except Exception:
        return None
    if len(rows) == 1 and rows[0].get("L_TO_Name"):
        return rows[0]["L_TO_Name"]
    return None


# -------------------------------------------------- calc canonicalization
# Localized exports carry localized calc function names in the XML
# (`SQLAusführen`, `Hole ( LetzteFehlerNr )`). fmgen requires canonical EN
# calcs, so decompilation rewrites function-call tokens and Get-parameters
# via the reference lookups — deterministic, string-literal-safe.

_GET_PARAM_RE = re.compile(r"\bGet\s*\(\s*([^\W\d][\w]*)\s*\)")

# Unicode-aware variant of textform.CALL_RE — localized function names carry
# umlauts/accents (`SQLAusführen`), which the ASCII identifier class misses.
_CALL_TOKEN_RE = re.compile(r"([^\W\d][\w.]*(?:[ ][^\W\d][\w.]*)*?)\s*\(")


def canonicalize_calc(text: str, ref: Reference) -> tuple[str, list[str]]:
    notes: list[str] = []
    lookup = ref.function_lookup()
    arity = ref.function_arity()

    stripped = strip_strings(text)
    repls: list[tuple[int, int, str]] = []
    for m in _CALL_TOKEN_RE.finditer(stripped):
        token = m.group(1)
        hit = lookup.get(token.casefold())
        if not hit:
            continue
        canonical = (arity.get(hit["function_id"]) or {}).get("canonical_name")
        if canonical and canonical != token:
            repls.append((m.start(1), m.end(1), canonical))
            notes.append(f"{token} → {canonical}")
    for start, end, repl in reversed(repls):
        text = text[:start] + repl + text[end:]

    getparams = ref.get_parameter_lookup()
    stripped = strip_strings(text)
    repls = []
    for m in _GET_PARAM_RE.finditer(stripped):
        token = m.group(1)
        canonical = getparams.get(token.casefold())
        if canonical and canonical != token:
            repls.append((m.start(1), m.end(1), canonical))
            notes.append(f"Get ( {token} ) → Get ( {canonical} )")
    for start, end, repl in reversed(repls):
        text = text[:start] + repl + text[end:]

    return text, notes


# ------------------------------------------------------------- reverse hints
# Mirror of textform.STEP_HINTS: dialog-only options (T4 excludes them from
# the plain text form) render as extension labels the forward hints parse
# back (`Button2: …`, `Input1: …`). Hint-injected defaults are dropped so
# they do not surface as phantom parameters.

def _reverse_hint_custom_dialog(options: dict) -> list[str]:
    extras: list[str] = []
    if options.get("button1_label") == '"OK"' and options.get("button1_commit") in (None, "True"):
        options.pop("button1_label", None)
        options.pop("button1_commit", None)
    for n in (1, 2, 3):
        label = options.pop(f"button{n}_label", None)
        if label is not None:
            extras.append(f"Button{n}: {label}")
        commit = options.pop(f"button{n}_commit", None)
        if commit is not None:
            extras.append(f"Button{n}Commit: {commit}")
    for n in (1, 2, 3):
        fld = options.pop(f"input{n}_field", None)
        if fld is not None:
            extras.append(f"Input{n}: {render_ref(fld) if isinstance(fld, dict) else fld}")
        label = options.pop(f"input{n}_label", None)
        if label is not None:
            extras.append(f"Input{n}Label: {label}")
        pw = options.pop(f"input{n}_use_password", None)
        if pw is not None:
            extras.append(f"Input{n}Password: {pw}")
    return extras


REVERSE_HINTS = {
    87: _reverse_hint_custom_dialog,
}


def _display_order(options: dict, ref: Reference, step_id: int) -> dict:
    """Canonical display order differs from XML order (emit docstring):
    references/targets first, then unlabeled, then labeled options —
    each group in sort_order."""
    meta = {o["option_key"]: o for o in ref.options(step_id)}

    def rank(key: str) -> tuple:
        o = meta.get(key, {})
        if o.get("option_type") in ("object_ref", "target"):
            group = 0
        elif not o.get("display_label_en"):
            group = 1
        else:
            group = 2
        return (group, o.get("sort_order", 99))

    return {k: options[k] for k in sorted(options, key=rank)}


def decompile_step(
    act: ET.Element,
    index: int,
    ref: Reference,
    catalog: Database | None,
    file: str | None,
) -> DecompiledStep:
    raw_id = act.attrib.get("id")
    name_attr = act.attrib.get("name", "?")
    enabled = act.attrib.get("enable", "True") != "False"
    try:
        step_id = int(raw_id) if raw_id is not None else None
    except ValueError:
        step_id = None

    ds = DecompiledStep(index=index, step_id=step_id, canonical_name=None, enabled=enabled)
    if step_id is None or step_id not in ref.steps():
        ds.issues.append(f"unknown step id '{raw_id}' (name '{name_attr}')")
        return ds
    ds.canonical_name = ref.steps()[step_id]["canonical_name"]

    xmap = ref.xml_map(step_id)
    template = (xmap or {}).get("snippet_template")
    if not template:
        ds.issues.append("no snippet template in the reference (not table-driven)")
        return ds
    try:
        tpl = ET.fromstring(template)
    except ET.ParseError as e:
        ds.issues.append(f"reference template not well-formed: {e}")
        return ds

    ex = _Extractor()
    _match(tpl, act, ex)
    _finish_refs(ex, catalog, file)
    ds.issues += ex.issues

    # Default omission — only for options the display does not show inline
    # (repetitions, dialog-only states): their default value carries no
    # information. Inline options keep their value even at the default —
    # FileMaker always displays them (`Set Error Capture [ On ]`).
    meta = {o["option_key"]: o for o in ref.options(step_id)}
    for key, default in ex.defaults.items():
        o = meta.get(key)
        if (
            key in ex.options
            and ex.options[key] == default
            and (o is None or o.get("display_location") != "inline")
        ):
            del ex.options[key]

    # Calc canonicalization (localized exports): calculation-typed options
    # rewrite localized function / Get-parameter names to canonical EN.
    for key, val in list(ex.options.items()):
        o = meta.get(key)
        if isinstance(val, str) and o and o.get("option_type") in ("calculation", "repetition"):
            fixed, notes = canonicalize_calc(val, ref)
            if notes:
                ex.options[key] = fixed
                ds.notes += notes

    reverse_hint = REVERSE_HINTS.get(step_id)
    extras = reverse_hint(ex.options) if reverse_hint else []

    ps = ParsedStep(
        line=index, step_id=step_id, canonical_name=ds.canonical_name,
        enabled=enabled, options=_display_order(ex.options, ref, step_id),
    )
    text = render_canonical(ps, ref)
    if extras:
        joined = " ; ".join(extras)
        if text.endswith(" ]"):
            text = f"{text[:-2]} ; {joined} ]"
        else:
            text = f"{text} [ {joined} ]"
    ds.text = text
    return ds


def decompile(
    xml_text: str,
    ref: Reference,
    catalog: Database | None = None,
    file: str | None = None,
) -> DecompileResult:
    res = DecompileResult()
    try:
        root = ET.fromstring(xml_text.strip())
    except ET.ParseError as e:
        res.errors.append(f"input is not well-formed XML: {e}")
        return res

    if root.tag == "Step":
        step_elems = [root]
    else:
        step_elems = [e for e in root.iter("Step") if e is not root]
    if not step_elems:
        res.errors.append("no <Step> elements found in input")
        return res

    for i, elem in enumerate(step_elems, start=1):
        res.steps.append(decompile_step(elem, i, ref, catalog, file))

    lines: list[str] = []
    depth = 0
    for ds in res.steps:
        name = ds.canonical_name or ""
        if name in _BLOCK_CLOSE or name in _BLOCK_MID:
            depth = max(0, depth - 1)
        indent = "  " * depth
        for issue in ds.issues:
            marker = f"# fmgen:unsupported step {ds.step_id or '?'}"
            if ds.canonical_name:
                marker += f" ({ds.canonical_name})"
            lines.append(f"{indent}{marker}: {issue}")
        if ds.text is not None:
            lines.append(indent + ds.text)
        if name in _BLOCK_OPEN or name in _BLOCK_MID:
            depth += 1
    res.text = "\n".join(lines) + "\n"
    return res
