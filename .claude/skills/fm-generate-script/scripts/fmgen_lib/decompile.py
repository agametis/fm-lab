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
from .textform import (ParsedStep, fixed_slot_extras, group_child_keys,
                       group_item_defaults, group_item_keys, is_fixed_slot,
                       render_canonical, render_ref, slot_families, slot_key,
                       strip_strings)

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
        tpl_attr_names = set(tpl.attrib)
        if ref_keys and all(k in tpl_attr_names for k in act.attrib):
            # Variable collapse (see emit._collapse_variable_targets): the
            # template's reference attributes were replaced by plain text.
            # A repetition attribute may survive alongside the variable
            # (<Field repetition="3">$var</Field>, Tier-2 22.0.6).
            key = next(iter(ref_keys))
            ex.refparts.setdefault(key, {})["name"] = atext.strip()
            ex.refparts[key]["_form"] = "variable"
            if act.attrib.get("repetition"):
                ex.refparts[key]["repetition"] = act.attrib["repetition"]
        else:
            ex.issues.append(f"<{act.tag}> has unexpected text content")

    # --- children (pair by tag, in order) ---
    achildren = list(act)
    used = [False] * len(achildren)

    def _literals_match(tc: ET.Element, a: ET.Element) -> bool:
        """Same-tag siblings are disambiguated by their literal (non-
        placeholder) attributes — 220 has <Field type="Messages"> and
        <Field type="ToolCalls"> side by side (Tier-2 22.0.6)."""
        for k, tv in tc.attrib.items():
            if _PH_RE.match(tv.strip()):
                continue
            if a.attrib.get(k) not in (None, tv):
                return False
        return True

    for tc in list(tpl):
        ai = next(
            (i for i, a in enumerate(achildren)
             if not used[i] and a.tag == tc.tag and _literals_match(tc, a)),
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
            ref = {"name": parts.get("name", ""), "_form": "variable"}
            if parts.get("repetition"):
                ref["repetition"] = parts["repetition"]
            ex.options[key] = ref
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


# --------------------------------------------------- direction-bound defaults
# Dialog-only options (T4 excludes them from the plain text form) render as
# extension labels the parse side reads back (`Button2: …`, `Input1: …`);
# injected defaults are dropped so they do not surface as phantom parameters.

def _drop_default_slot_items(options: dict, ref: Reference, step_id: int,
                             tpl: ET.Element) -> None:
    """Direction-dependent default at item level (T9 fixed-slot rule): when a
    fixed-slot group carries exactly its default item in slot 1 and nothing in
    any other slot, that item is FileMaker's injected default (87: the OK
    commit button) — the canonical text omits it and the emit side re-injects
    it. Dropping it in any other constellation would lose FileMaker's commit
    button and shift every Get(LastMessageChoice) by one, so the condition is
    strict: sole slot, values equal to the default item's extraction."""
    for g in ref.repeat_groups(step_id):
        if not is_fixed_slot(g) or not g.get("default_item_template"):
            continue
        fams = slot_families(ref, step_id, g)
        if not fams:
            continue
        n_max = int(g["max_items"])
        per_slot = {
            n: {slot_key(f, n): options[slot_key(f, n)]
                for f in fams if slot_key(f, n) in options}
            for n in range(1, n_max + 1)
        }
        if not per_slot[1] or any(per_slot[n] for n in range(2, n_max + 1)):
            continue
        container_tpl = tpl.find(g["container_path"])
        if container_tpl is None:
            continue
        try:
            default_item = ET.fromstring(g["default_item_template"])
        except ET.ParseError:
            continue
        slots_tpl = [c for c in container_tpl if c.tag == default_item.tag]
        if not slots_tpl:
            continue
        ex = _Extractor()
        _match(slots_tpl[0], default_item, ex)
        default_vals = {k: v for k, v in ex.options.items()
                        if str(v) != ex.defaults.get(k, "\x00")}
        if per_slot[1] == default_vals:
            for k in per_slot[1]:
                options.pop(k, None)


def _consume_text_marker(act: ET.Element) -> None:
    """Consume the empty <Text/> marker of a variable-target-marker step
    (step_xml_map.variable_target_marker, fm_spec 1.17.0 — one knowledge
    source with emit._inject_text_marker) before template matching — the
    templates carry no Text element; the emit side re-injects it for
    variable-form targets. Consumed ONLY when a variable target is present:
    a marker next to a plain field target (not derivable from any catalog
    state) stays and surfaces as a lossy finding instead of being silently
    dropped."""
    has_var = any(
        e.tag not in ("Text", "Calculation") and (e.text or "").lstrip().startswith("$")
        for e in act.iter()
    )
    if not has_var:
        return
    for child in list(act):
        if (child.tag == "Text" and not child.attrib and len(child) == 0
                and not (child.text or "").strip()):
            act.remove(child)
            return


# ------------------------------------------------------------- repeat groups
# T9 inversion: the items of a declared group are matched one by one against
# the group's item template ({#index} compared literally per position) and
# collected into a list; the matched children are consumed so the main
# template match sees the container in its pruned single-exemplar shape.
# Anything beyond the item template stays a lossy finding — never a silent cut.

def _item_root_tag(g: dict) -> str:
    m = re.match(r"<([A-Za-z][A-Za-z0-9]*)", g["item_template"])
    return m.group(1) if m else ""


def _extract_repeat_groups(act: ET.Element, ref: Reference, step_id: int,
                           catalog: Database | None, file: str | None,
                           issues: list[str], notes: list[str]) -> dict:
    groups = ref.repeat_groups(step_id)
    if not groups:
        return {}
    by_key = {g["group_key"]: g for g in groups}
    out: dict = {}
    for g in groups:
        if g["parent_group"]:
            continue
        if is_fixed_slot(g):
            continue  # fixed-slot groups: the numbered main template extracts
                      # the slots; empty hulls dissolve via default omission
        container = act.find(g["container_path"])
        if container is None:
            continue
        items = _extract_items(g, container, by_key, ref, step_id,
                               catalog, file, issues, notes)
        if items is None or not items:
            continue
        if g["count_attr"]:
            declared = container.attrib.pop(g["count_attr"], None)
            if declared is not None and declared != str(len(items)):
                issues.append(
                    f"<{container.tag}> {g['count_attr']}='{declared}' does not "
                    f"match {len(items)} item(s)")
        if g["item_form"] == "scalar":
            vals = [item[g["group_key"]] for item in items if g["group_key"] in item]
            if not vals:
                continue
            out[g["group_key"]] = vals[0] if len(vals) == 1 else vals
        else:
            out[g["group_key"]] = items
    return out


def _extract_items(g: dict, container: ET.Element, by_key: dict, ref: Reference,
                   step_id: int, catalog: Database | None, file: str | None,
                   issues: list[str], notes: list[str]) -> list[dict] | None:
    item_tag = _item_root_tag(g)
    children = [c for c in container if c.tag == item_tag]
    if not children:
        return None
    meta = {o["option_key"]: o for o in ref.options(step_id)}
    defaults = group_item_defaults(g)
    items: list[dict] = []
    for i, child in enumerate(children):
        tpl_str = g["item_template"].replace("{#index}", str(i))
        try:
            tpl = ET.fromstring(tpl_str)
        except ET.ParseError as e:
            issues.append(f"item template of group '{g['group_key']}' not well-formed: {e}")
            return None
        item: dict = {}
        # nested slots first: extract + consume the child group's items
        for ck in group_child_keys(g):
            cg = by_key.get(ck)
            slot = next((e for e in tpl.iter()
                         if (e.text or "").strip() == "{%s[]}" % ck), None)
            if slot is None or cg is None:
                continue
            slot.text = None
            subs = _extract_items(cg, child, by_key, ref, step_id,
                                  catalog, file, issues, notes)
            if subs:
                item[ck] = subs
        ex = _Extractor()
        _match(tpl, child, ex)
        _finish_refs(ex, catalog, file)
        for msg in ex.issues:
            issues.append(f"{g['group_label']} item {i + 1}: {msg}")
        # per-item default omission (canonical form drops item defaults, T9)
        for k, v in list(ex.options.items()):
            if not isinstance(v, dict) and str(v) == defaults.get(k, "\x00"):
                del ex.options[k]
        # empty object references: identity-less refs carry no information
        for k, v in list(ex.options.items()):
            if isinstance(v, dict) and not (v.get("name") or "").strip() \
                    and v.get("_form") != "variable":
                del ex.options[k]
        # calc canonicalization per item (localized exports)
        for k, v in list(ex.options.items()):
            o = meta.get(k)
            if isinstance(v, str) and o and o.get("option_type") in ("calculation", "repetition"):
                fixed, cnotes = canonicalize_calc(v, ref)
                if cnotes:
                    ex.options[k] = fixed
                    notes.extend(cnotes)
        item.update(ex.options)
        if item:
            items.append(item)
        container_or_child_consumed = True
    for child in children:
        container.remove(child)
    return items


# ------------------------------------------------------------- known FM bugs
# The bug registry in fm_spec.step_constraints (since 1.14.4) records
# documented FileMaker serialization defects. On the decompile side they are
# epistemic warnings about the INPUT — a clipboard snippet may already have
# lost a slot before fmgen ever saw it — so they surface as notes (never
# issues: the step is valid, the risk lies with FileMaker's serializer).
# The emit side deliberately does NOT warn: fmgen's own emission writes the
# full form and pastes intact (221: the snippet carries TemplateName), so a
# warning there would point the wrong way.

def _append_known_bug_notes(ds: DecompiledStep, ref: Reference, step_id: int) -> None:
    # The kind -> lead-text mapping lives in fm_spec.constraint_kinds
    # (consumer_note, since 1.17.0); only the bug-registry kinds carry one.
    kinds = ref.constraint_kinds()
    for c in ref.constraints():
        if c["step_id"] != step_id:
            continue
        suffix = kinds.get(c["constraint_kind"])
        if suffix is None:
            continue
        detail = (c.get("detail") or "").split(". ")[0].strip()
        if len(detail) > 160:
            detail = detail[:157] + "…"
        version = c.get("verified_version") or "?"
        ds.notes.append(
            f"known FM bug ({c['constraint_kind']}, verified {version}): "
            f"{detail} — {suffix}")


def _display_order(options: dict, ref: Reference, step_id: int) -> dict:
    """Canonical display order differs from XML order (emit docstring):
    references/targets first, then unlabeled, then labeled options —
    each group in sort_order."""
    meta = {o["option_key"]: o for o in ref.options(step_id)}
    group_keys = {g["group_key"] for g in ref.repeat_groups(step_id)}
    position = {k: i for i, k in enumerate(options)}

    def rank(key: str) -> tuple:
        if key in group_keys and isinstance(options.get(key), list):
            return (3, position[key])
        o = meta.get(key, {})
        if o.get("option_type") in ("object_ref", "target"):
            group = 0
        elif not o.get("display_label_en"):
            group = 1
        else:
            group = 2
        sort_order = o.get("sort_order")
        return (group, 99 if sort_order is None else sort_order)

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

    if (xmap or {}).get("variable_target_marker"):
        _consume_text_marker(act)
    group_opts = _extract_repeat_groups(act, ref, step_id, catalog, file,
                                        ds.issues, ds.notes)
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

    # Empty object references: FileMaker emits reference elements with empty
    # identity (213 <Table id="0" name=""/> in DataTable mode with no table
    # selected) — an extracted ref without a name is no reference; the emit
    # side reconstructs the empty form from template defaults.
    for key, val in list(ex.options.items()):
        if isinstance(val, dict) and not (val.get("name") or "").strip() \
                and val.get("_form") != "variable":
            del ex.options[key]

    # Presence booleans (see emit._fix_presence_booleans): the template's
    # element-text placeholder extracts '' from the empty present element —
    # normalize to the boolean state True.
    for key, val in list(ex.options.items()):
        o = meta.get(key)
        if (o and o.get("option_type") == "boolean"
                and "/@" not in (o.get("xml_path") or "") and val == ""):
            ex.options[key] = "True"

    # Calc canonicalization (localized exports): calculation-typed options
    # rewrite localized function / Get-parameter names to canonical EN.
    for key, val in list(ex.options.items()):
        o = meta.get(key)
        if isinstance(val, str) and o and o.get("option_type") in ("calculation", "repetition"):
            fixed, notes = canonicalize_calc(val, ref)
            if notes:
                ex.options[key] = fixed
                ds.notes += notes

    ex.options.update(group_opts)

    _drop_default_slot_items(ex.options, ref, step_id, tpl)
    extras = fixed_slot_extras(ex.options, ref, step_id)
    _append_known_bug_notes(ds, ref, step_id)

    ps = ParsedStep(
        line=index, step_id=step_id, canonical_name=ds.canonical_name,
        enabled=enabled, options=_display_order(ex.options, ref, step_id),
    )
    text = render_canonical(ps, ref)
    # FileMaker keeps a multi-line comment in ONE step, but the text form has no
    # continuation for comment payloads — a comment line ends at the end of its
    # line (T1/T6), otherwise a stray bracket in the prose would swallow the
    # following steps. One comment step per line is the only rendering parse()
    # can read back; it changes the step count, so it is recorded as lossy
    # rather than shipped as text that silently fails to round-trip.
    if step_id == 89 and "\n" in str(ps.options.get("text", "")):
        payload = str(ps.options["text"]).split("\n")
        prefix = "" if enabled else "// "
        text = "\n".join(f"{prefix}# {ln}" if ln else f"{prefix}#" for ln in payload)
        ds.issues.append(
            f"multi-line comment split into {len(payload)} comment steps "
            "(the text form has no multi-line comment)")
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
            if ds.step_id == 89 and "\n" in ds.text:
                # split multi-line comment: every line is its own step and gets
                # its own block indentation
                lines.extend(indent + t for t in ds.text.split("\n"))
            else:
                lines.append(indent + ds.text)
        if name in _BLOCK_OPEN or name in _BLOCK_MID:
            depth += 1
    res.text = "\n".join(lines) + "\n"
    return res
