"""P6 validation gate v2 — three layers, every check reported individually.

Layer 1 (paste validity): real XML parse; Step ids exist in the reference
  (legacy/reserved ids rejected); children/order per step_xml_map; name
  attribute matches canonical name or a known xml_emission alias; Set Variable
  Name element present; Calculation content in CDATA.
Layer 2 (save validity): step_constraints catalog — save_invalid_bare,
  save_invalid_nesting (flat transactions), requires_pair balance on the XML.
Layer 3 (runtime validity): resolution report free of errors; version gate
  (origin_version of every step <= target file version, from step_compat data).

Checks that cannot run (missing grammar tables, no resolution report, file not
in catalog) are reported as 'skipped' with a reason — never as passed.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .db import Reference

IF_OPEN, IF_CLOSE, LOOP_OPEN, LOOP_CLOSE = 68, 70, 71, 73


@dataclass
class Check:
    check_id: str
    layer: int
    status: str  # 'pass' | 'fail' | 'skipped'
    message: str

    def as_dict(self) -> dict:
        return self.__dict__


@dataclass
class GateResult:
    checks: list[Check] = field(default_factory=list)

    def add(self, check_id: str, layer: int, status: str, message: str) -> None:
        self.checks.append(Check(check_id, layer, status, message))

    @property
    def passed(self) -> bool:
        return not any(c.status == "fail" for c in self.checks)

    def as_dict(self) -> dict:
        return {"passed": self.passed, "checks": [c.as_dict() for c in self.checks]}


def _version_num(v: str | None) -> float | None:
    if not v:
        return None
    if "earlier" in v or "früher" in v:
        return 0.0
    m = re.match(r"(\d+(?:\.\d+)?)", v.strip())
    return float(m.group(1)) if m else None


def run_gate(xml_text: str, ref: Reference, resolution: dict | None = None,
             target_version: str | None = None) -> GateResult:
    res = GateResult()

    # ---- Layer 1: paste validity -------------------------------------------
    try:
        root = ET.fromstring(xml_text)
        res.add("G101-wellformed", 1, "pass", "XML parses with a real parser")
    except ET.ParseError as e:
        res.add("G101-wellformed", 1, "fail", f"XML not well-formed: {e}")
        return res

    if root.tag != "fmxmlsnippet" or root.get("type") != "FMObjectList":
        res.add("G102-wrapper", 1, "fail",
                'wrapper must be <fmxmlsnippet type="FMObjectList">')
    else:
        res.add("G102-wrapper", 1, "pass", "fmxmlsnippet wrapper correct")

    steps = root.findall("Step")
    if not steps:
        res.add("G103-steps", 1, "fail", "no Step elements in snippet")
        return res
    res.add("G103-steps", 1, "pass", f"{len(steps)} Step element(s)")

    known = ref.steps()
    legacy = ref.legacy_step_ids()
    lookup = ref.step_name_lookup()
    bad_ids, bad_names = [], []
    for st in steps:
        sid = int(st.get("id", "-1"))
        name = st.get("name", "")
        if sid in legacy:
            bad_ids.append(f"id={sid} is a legacy/reserved id "
                           f"({legacy[sid].get('doc_status', 'legacy')})")
        elif sid not in known:
            bad_ids.append(f"id={sid} not in fm_spec.script_steps")
        else:
            hit = lookup.get(name.casefold())
            if not hit or hit["step_id"] != sid:
                bad_names.append(
                    f"id={sid}: name attribute '{name}' does not match any known "
                    f"name/alias of '{known[sid]['canonical_name']}'")
    res.add("G104-step-ids", 1, "fail" if bad_ids else "pass",
            "; ".join(bad_ids) or "all Step ids exist in the reference")
    res.add("G105-step-names", 1, "fail" if bad_names else "pass",
            "; ".join(bad_names) or "all Step name attributes match the reference")

    if not ref.grammar_available():
        res.add("G106-structure", 1, "skipped",
                "grammar tables not installed — structure not checked")
    else:
        problems = []
        for st in steps:
            sid = int(st.get("id", "-1"))
            xmap = ref.xml_map(sid)
            if not xmap:
                problems.append(f"id={sid}: no template in step_xml_map")
                continue
            order = [e.strip() for e in (xmap.get("element_order") or "").split(",") if e.strip()]
            children = [c.tag for c in st]
            unknown = [c for c in children if order and c not in order]
            if unknown:
                problems.append(f"id={sid}: unexpected child element(s) {unknown}")
            if order:
                # greedy subsequence match: element_order may repeat an element
                # name (mixed-content quirk — e.g. step 202 emits Field before AND
                # after ConfigureCoreML), so consume the NEXT free slot per child
                # rather than mapping every child to the first occurrence.
                j = 0
                for c in children:
                    if c not in order:
                        continue
                    while j < len(order) and order[j] != c:
                        j += 1
                    if j >= len(order):
                        problems.append(
                            f"id={sid}: child order {children} violates reference "
                            f"order {order} (element order is paste-relevant)")
                        break
                    j += 1
        res.add("G106-structure", 1, "fail" if problems else "pass",
                "; ".join(problems) or "children and order match step_xml_map")

    name_missing = [st.get("id") for st in steps
                    if st.get("id") == "141" and st.find("Name") is None]
    res.add("G107-setvar-name", 1, "fail" if name_missing else "pass",
            "Set Variable without Name element (silently dropped on paste)"
            if name_missing else "Set Variable Name elements present")

    n_calcs = len(root.findall(".//Calculation"))
    n_cdata = xml_text.count("<![CDATA[")
    res.add("G108-cdata", 1, "pass" if n_cdata >= n_calcs else "fail",
            f"{n_calcs} Calculation element(s), {n_cdata} CDATA section(s)"
            + ("" if n_cdata >= n_calcs else " — calculations must be CDATA-wrapped"))

    # G109: enum values whose reference evidence is 'claris-doc' are doc-only
    # (never roundtrip-verified) — report as a fail-free warning, never fail.
    if not ref.grammar_available():
        res.add("G109-doc-only", 1, "skipped",
                "grammar tables not installed — doc-only evidence not checked")
    else:
        doc_only = []
        for st in steps:
            sid = int(st.get("id", "-1"))
            flagged = [v for v in ref.option_values(sid)
                       if v.get("evidence") == "claris-doc"]
            if not flagged:
                continue
            paths = {o["option_key"]: o.get("xml_path") for o in ref.options(sid)}
            for v in flagged:
                actual = _value_at_path(st, paths.get(v["option_key"]))
                if actual is not None and actual == v["xml_value"]:
                    doc_only.append(
                        f"id={sid}: {v['option_key']}='{v['xml_value']}'")
        res.add("G109-doc-only", 1, "warning" if doc_only else "pass",
                ("doc-only enum value(s) used — documented by Claris but not "
                 "roundtrip-verified, verify behaviour after paste: "
                 + "; ".join(doc_only)) if doc_only
                else "no doc-only enum values used")

    # ---- Layer 2: save validity --------------------------------------------
    constraints = ref.constraints() if ref.grammar_available() else []
    if_depth, problems2 = 0, []
    for st in steps:
        sid = int(st.get("id", "-1"))
        if sid == IF_OPEN:
            if_depth += 1
        elif sid == IF_CLOSE:
            if_depth = max(0, if_depth - 1)
        for c in constraints:
            if c["step_id"] != sid:
                continue
            if c["constraint_kind"] == "save_invalid_nesting" and if_depth > 0:
                problems2.append(f"id={sid} inside If block: {c['detail']}")
            if c["constraint_kind"] == "save_invalid_bare" and sid == 141:
                calc = st.find("Value/Calculation")
                if calc is not None and (calc.text or "").strip() == "Self":
                    problems2.append(f"id=141: {c['detail']}")
    balance = _pair_balance(steps)
    if balance:
        problems2 += balance
    if constraints:
        res.add("G201-save-constraints", 2, "fail" if problems2 else "pass",
                "; ".join(problems2) or "no save-invalid pattern matched")
    else:
        res.add("G201-save-constraints", 2, "skipped", "step_constraints not installed")

    # ---- Layer 3: runtime validity -----------------------------------------
    if resolution is None:
        res.add("G301-resolution", 3, "skipped", "no resolution report supplied")
    else:
        errs = [u for u in resolution.get("unresolved", [])
                if u.get("severity") == "error"]
        res.add("G301-resolution", 3, "fail" if errs else "pass",
                f"{len(errs)} unresolved reference(s) with severity=error"
                if errs else f"{len(resolution.get('resolved', []))} reference(s) resolved, "
                             f"{len(resolution.get('new_objects', []))} declared new")
        if resolution.get("new_objects"):
            res.add("G302-new-objects", 3, "pass",
                    "create before paste: " + "; ".join(
                        n["ref"] for n in resolution["new_objects"]))

    tv = _version_num(target_version)
    if tv is None:
        res.add("G303-version-gate", 3, "skipped",
                "target file version unknown — origin_version not checked")
    else:
        too_new = []
        for st in steps:
            sid = int(st.get("id", "-1"))
            ov = _version_num(known.get(sid, {}).get("origin_version"))
            if ov is not None and ov > tv:
                too_new.append(f"id={sid} ('{known[sid]['canonical_name']}') needs "
                               f"FM {known[sid]['origin_version']}, target is {target_version}")
        res.add("G303-version-gate", 3, "fail" if too_new else "pass",
                "; ".join(too_new) or f"all steps available in FM {target_version}")

    return res


def _value_at_path(st: ET.Element, xml_path: str | None) -> str | None:
    """Value at a step_options.xml_path ('Elem/Sub/@attr' or 'Elem/Sub') below <Step>."""
    if not xml_path:
        return None
    if "@" in xml_path:
        elem_path, _, attr = xml_path.rpartition("/@")
        node = st.find(elem_path) if elem_path else st
        return node.get(attr) if node is not None else None
    node = st.find(xml_path)
    if node is None:
        return None
    return (node.text or "").strip()


def _pair_balance(steps: list[ET.Element]) -> list[str]:
    stack, problems = [], []
    for st in steps:
        sid = int(st.get("id", "-1"))
        if sid in (IF_OPEN, LOOP_OPEN):
            stack.append(sid)
        elif sid == IF_CLOSE:
            if not stack or stack.pop() != IF_OPEN:
                problems.append("End If without matching If")
        elif sid == LOOP_CLOSE:
            if not stack or stack.pop() != LOOP_OPEN:
                problems.append("End Loop without matching Loop")
    for sid in stack:
        problems.append(("If" if sid == IF_OPEN else "Loop") + " never closed")
    return problems
