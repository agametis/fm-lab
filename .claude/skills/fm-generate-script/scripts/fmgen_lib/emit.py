"""P5 table-driven emission: parsed IR -> fmxmlsnippet.

The XML per step comes exclusively from fm_spec.step_xml_map
(snippet_template with {placeholder} markers), never from prompt knowledge.

Placeholder grammar in templates:
  {key}          option value (calculation/text/enum/boolean state)
  {key|default}  default applied when the option is absent
  {key:sub}      subfield of an object_ref (id / name / table / repetition)
  {key:sub?}     optional attribute: when the value is absent the whole
                 attribute is dropped from the element (used for the field
                 repetition attribute — native FileMaker omits it entirely at
                 the default, emits it only for an explicit/calculated rep)

Pruning rule (derived from paste semantics): after substitution an element is
dropped when its subtree contains only unfilled defaultless placeholders and
no actual values; mixing filled and unfilled placeholders in one element is an
error (incomplete option group). Optional ('?') attributes never keep an
element alive on their own and never force a prune — they are simply omitted
when absent. Calculation element text is emitted as CDATA.
Serialization follows the roundtrip-verified canonical form: 2-space indent,
element order exactly as in the template.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .db import Reference
from .textform import ParsedStep

_PLACEHOLDER_RE = re.compile(r"\{([a-z0-9_]+)(?::([a-z_]+))?(?:\|([^{}]*))?(\?)?\}")

# An attribute value that is exactly one optional ('?') placeholder — the whole
# attribute is dropped when the value resolves to absent (see module docstring).
_OPTIONAL_ATTR_RE = re.compile(r"^\{([a-z0-9_]+)(?::([a-z_]+))?\?\}$")

# An attribute value that is exactly one placeholder for an option (any subfield):
# used to detect a reference element whose identity is carried by attributes.
_ATTR_PLACEHOLDER_RE = re.compile(r"^\{([a-z0-9_]+)(?::[a-z_]+)?\??\}$")

_MISSING = object()


@dataclass
class EmitResult:
    xml: str | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    unsupported: list[dict] = field(default_factory=list)


def template_placeholders(template: str) -> set[str]:
    return {m.group(1) for m in _PLACEHOLDER_RE.finditer(template)}


def _lookup_value(ps: ParsedStep, key: str, sub: str | None, default: str | None):
    val = ps.options.get(key, _MISSING)
    if val is _MISSING or val is None:
        return default if default is not None else _MISSING
    if isinstance(val, dict):
        if sub is None:
            return val.get("name", _MISSING)
        v = val.get(sub, _MISSING)
        if v is _MISSING and sub == "repetition":
            return default if default is not None else _MISSING
        if v is _MISSING and sub == "id":
            return default if default is not None else _MISSING
        return v
    if sub is not None:
        return _MISSING
    return str(val)


class _Sub:
    """Substitution pass over one template; tracks fill state per element."""

    def __init__(self, ps: ParsedStep):
        self.ps = ps
        self.filled = 0
        self.errors: list[str] = []

    def sub_text(self, text: str) -> tuple[str, int, int]:
        """Returns (result, n_filled_actual, n_missing)."""
        filled = missing = 0

        def repl(m: re.Match) -> str:
            nonlocal filled, missing
            v = _lookup_value(self.ps, m.group(1), m.group(2), m.group(3))
            if v is _MISSING:
                missing += 1
                return ""
            if self.ps.options.get(m.group(1)) is not None:
                filled += 1
            return str(v)

        return _PLACEHOLDER_RE.sub(repl, text), filled, missing


def _process(elem: ET.Element, sub: _Sub) -> tuple[int, int, int]:
    """Substitute placeholders depth-first. Returns (actuals, missing, lost)
    for the subtree.

    A child is pruned when its subtree carries no actual value but has missing
    defaultless placeholders OR lost its own children to pruning — default-only
    skeletons (empty Button/InputField/Repetition groups) must not survive.
    The root Step element is never pruned (handled by the caller).
    """
    actuals = missing = lost = 0
    for child in list(elem):
        ca, cm, cl = _process(child, sub)
        if (cm > 0 or cl > 0) and ca == 0:
            elem.remove(child)
            lost += 1
        else:
            if cm > 0 and ca > 0:
                sub.errors.append(
                    f"line {sub.ps.line}: incomplete option group in <{child.tag}> "
                    f"for '{sub.ps.canonical_name}' — some values set, others missing")
            actuals += ca
            missing += 0 if ca else cm
    if elem.text and elem.text.strip():
        t, f, m = sub.sub_text(elem.text)
        elem.text = t
        actuals += f
        missing += m
    for k, v in list(elem.attrib.items()):
        opt = _OPTIONAL_ATTR_RE.match(v)
        if opt is not None:
            # Optional attribute: emit only when a value is present, otherwise
            # drop it. Absence never counts as 'missing' (so it neither prunes
            # the element nor keeps an otherwise-empty one alive).
            val = _lookup_value(sub.ps, opt.group(1), opt.group(2), None)
            if val is _MISSING:
                del elem.attrib[k]
            else:
                elem.attrib[k] = str(val)
                if sub.ps.options.get(opt.group(1)) is not None:
                    actuals += 1
            continue
        t, f, m = sub.sub_text(v)
        elem.attrib[k] = t
        actuals += f
        missing += m
    return actuals, missing, lost


def _collapse_variable_targets(elem: ET.Element, ps: ParsedStep) -> None:
    """Render a variable target as element text, not as id/name/table attributes.

    A reference element in a template carries the field form
    (``<Field table id name/>``); a field's identity lives in those attributes.
    A script-local variable has no such identity — FileMaker writes it as the
    plain text content of the same element (``<Field>$var</Field>``). Templates
    only encode the field form, so when a target resolves to a variable we
    rewrite the element to the text form here. This lets one template serve both
    cases and keeps a variable target from being pruned away with its (unfilled)
    attribute placeholders.
    """
    for child in list(elem):
        _collapse_variable_targets(child, ps)
    var_keys = set()
    for v in elem.attrib.values():
        m = _ATTR_PLACEHOLDER_RE.match(v.strip())
        if m:
            val = ps.options.get(m.group(1))
            if isinstance(val, dict) and val.get("_form") == "variable":
                var_keys.add(m.group(1))
    if not var_keys:
        return
    for k in list(elem.attrib):
        m = _ATTR_PLACEHOLDER_RE.match(elem.attrib[k].strip())
        if m and m.group(1) in var_keys:
            del elem.attrib[k]
    key = next(iter(var_keys))
    elem.text = ps.options[key]["name"]


def _has_unfilled(elem: ET.Element) -> list[str]:
    left = []
    for e in elem.iter():
        for source in [e.text or ""] + list(e.attrib.values()):
            left += [m.group(0) for m in _PLACEHOLDER_RE.finditer(source)]
    return left


def emit_step(ps: ParsedStep, ref: Reference) -> tuple[ET.Element | None, list[str], list[str]]:
    """Returns (element, errors, warnings) for one step."""
    xmap = ref.xml_map(ps.step_id)
    if xmap is None or not xmap.get("snippet_template"):
        return None, [f"line {ps.line}: no snippet template for step "
                      f"{ps.step_id} ('{ps.canonical_name}') in the reference"], []
    template = xmap["snippet_template"]
    known = template_placeholders(template)
    warnings, errors = [], []
    for key, val in ps.options.items():
        base_hit = key in known or any(k.startswith(key) for k in known)
        if not base_hit:
            errors.append(
                f"line {ps.line}: option '{key}' of '{ps.canonical_name}' has no "
                "placeholder in the reference template — not supported by the "
                "table-driven emitter; author this step manually against "
                "step_xml_map and validate with the gate")
    if errors:
        return None, errors, warnings

    try:
        elem = ET.fromstring(template)
    except ET.ParseError as e:
        return None, [f"step {ps.step_id}: reference template is not well-formed: {e}"], []

    _collapse_variable_targets(elem, ps)
    sub = _Sub(ps)
    _process(elem, sub)
    errors += sub.errors
    leftover = _has_unfilled(elem)
    if leftover:
        errors.append(
            f"line {ps.line}: unfilled placeholders {sorted(set(leftover))} in "
            f"'{ps.canonical_name}' after substitution")
    if not ps.enabled:
        elem.set("enable", "False")
    if errors:
        return None, errors, warnings
    return elem, [], warnings


# ------------------------------------------------------------- serialization

_XML_ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}
_ATTR_ESC = {**_XML_ESC, '"': "&quot;"}


def _esc(s: str, table: dict) -> str:
    return "".join(table.get(c, c) for c in s)


def _serialize(elem: ET.Element, indent: int, out: list[str]) -> None:
    pad = "  " * indent
    attrs = "".join(f' {k}="{_esc(v, _ATTR_ESC)}"' for k, v in elem.attrib.items())
    children = list(elem)
    text = (elem.text or "").strip("\n")
    if elem.tag == "Calculation":
        # CDATA, verbatim content (already plain text in the IR)
        body = text.strip()
        body = body.replace("]]>", "]]]]><![CDATA[>")
        out.append(f"{pad}<{elem.tag}{attrs}><![CDATA[{body}]]></{elem.tag}>")
        return
    if not children and not text.strip():
        out.append(f"{pad}<{elem.tag}{attrs}/>")
        return
    if not children:
        out.append(f"{pad}<{elem.tag}{attrs}>{_esc(text.strip(), _XML_ESC)}</{elem.tag}>")
        return
    out.append(f"{pad}<{elem.tag}{attrs}>")
    for child in children:
        _serialize(child, indent + 1, out)
    out.append(f"{pad}</{elem.tag}>")


def emit(parsed: list[ParsedStep], ref: Reference, xml_decl: bool = False) -> EmitResult:
    res = EmitResult()
    elems: list[ET.Element] = []
    for ps in parsed:
        elem, errors, warnings = emit_step(ps, ref)
        res.errors += errors
        res.warnings += warnings
        if elem is not None:
            elems.append(elem)
    if res.errors:
        return res
    lines = []
    if xml_decl:
        lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append('<fmxmlsnippet type="FMObjectList">')
    for elem in elems:
        _serialize(elem, 1, lines)
    lines.append("</fmxmlsnippet>")
    res.xml = "\n".join(lines) + "\n"
    return res
