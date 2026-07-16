"""P3 lint rules on the segmented/parsed draft.

Rule catalog:
  L001 unknown step name (with close-match suggestion)
  L002 block balance (If/End If, Loop/End Loop, branch/exit placement)
  L003 $$$ variables
  L004 bare ::Field reference without table occurrence
  L005 bracket group on a step that takes no options
  L006 function arity in calculations (against function_parameters)
  L007 localized function names in calculations (canonical EN policy)
  L008 flat-transaction constraint (Commit/Revert Transaction inside If)

Block-step IDs (68/69/70/125, 71/72/73) are universal, locale-independent
FileMaker constants; the reference DB's step_constraints carries the same
semantics as prose and is used for messages.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

from .db import Reference
from .textform import CALL_RE, ParsedStep, RawStep, strip_strings

IF_OPEN, IF_BRANCH, IF_CLOSE = {68}, {69, 125}, {70}
LOOP_OPEN, LOOP_EXIT, LOOP_CLOSE = {71}, {72}, {73}
TRANSACTION_FLAT = {206, 207}  # Commit/Revert Transaction: save-invalid inside If

_MERGED_HEADS = {"endif": "End If", "elseif": "Else If", "endloop": "End Loop",
                 "exitloopif": "Exit Loop If"}


@dataclass
class Finding:
    rule: str
    severity: str  # 'error' | 'warning' | 'info'
    line: int
    message: str

    def as_dict(self) -> dict:
        return self.__dict__


@dataclass
class LintResult:
    findings: list[Finding] = field(default_factory=list)

    def add(self, rule: str, severity: str, line: int, message: str) -> None:
        self.findings.append(Finding(rule, severity, line, message))

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]


def lint(raw_steps: list[RawStep], parsed: list[ParsedStep], ref: Reference) -> LintResult:
    res = LintResult()
    _unknown_steps(raw_steps, ref, res)
    _block_balance(parsed, res)
    _text_rules(parsed, res)
    _calc_rules(parsed, ref, res)
    for ps in parsed:
        for e in ps.errors:
            res.add("PARSE", "error", ps.line, e)
        for w in ps.warnings:
            res.add("PARSE", "warning", ps.line, w)
    return res


def _unknown_steps(raw_steps: list[RawStep], ref: Reference, res: LintResult) -> None:
    names = list(ref.step_name_lookup().keys())
    for st in raw_steps:
        if st.step_id is not None:
            continue
        head = st.head
        merged = _MERGED_HEADS.get(re.sub(r"\s+", "", head).casefold())
        if merged:
            res.add("L001", "error", st.line,
                    f"'{head}' is not a step name — write '{merged}' (two words)")
            continue
        close = difflib.get_close_matches(head.casefold(), names, n=1, cutoff=0.75)
        hint = f" — did you mean '{close[0]}'?" if close else ""
        res.add("L001", "error", st.line, f"unknown step name '{head}'{hint}")


def _block_balance(parsed: list[ParsedStep], res: LintResult) -> None:
    stack: list[tuple[str, int]] = []  # (kind, line)
    for ps in parsed:
        if not ps.enabled:
            continue
        sid = ps.step_id
        if sid in IF_OPEN:
            stack.append(("if", ps.line))
        elif sid in LOOP_OPEN:
            stack.append(("loop", ps.line))
        elif sid in IF_BRANCH:
            if not any(k == "if" for k, _ in stack) or stack[-1][0] != "if":
                res.add("L002", "error", ps.line,
                        f"'{ps.canonical_name}' outside an open If block")
        elif sid in LOOP_EXIT:
            if not any(k == "loop" for k, _ in stack):
                res.add("L002", "error", ps.line, "'Exit Loop If' outside a Loop block")
        elif sid in IF_CLOSE:
            if stack and stack[-1][0] == "if":
                stack.pop()
            else:
                res.add("L002", "error", ps.line, "'End If' without matching 'If'")
        elif sid in LOOP_CLOSE:
            if stack and stack[-1][0] == "loop":
                stack.pop()
            else:
                res.add("L002", "error", ps.line, "'End Loop' without matching 'Loop'")
        elif sid in TRANSACTION_FLAT:
            if any(k == "if" for k, _ in stack):
                res.add("L008", "error", ps.line,
                        f"'{ps.canonical_name}' inside an If block — pastes cleanly but the "
                        "file fails to save (step_constraints: save_invalid_nesting); "
                        "branch to a flat commit instead")
    for kind, line in stack:
        opener = "If" if kind == "if" else "Loop"
        res.add("L002", "error", line, f"'{opener}' opened here is never closed")


def _text_rules(parsed: list[ParsedStep], res: LintResult) -> None:
    for ps in parsed:
        code = strip_strings(ps.raw)
        if "$$$" in code:
            res.add("L003", "error", ps.line,
                    "'$$$' is not a valid variable prefix ($ local, $$ global)")
        for m in re.finditer(r"(?<![\w.\"])::\s*[\w]", code):
            res.add("L004", "error", ps.line,
                    "bare '::Field' reference — always qualify with a table occurrence (T5)")


def _calc_options(ps: ParsedStep, ref: Reference) -> list[str]:
    calcs = []
    for o in ref.options(ps.step_id) if ps.step_id else []:
        if o["option_type"] in ("calculation", "repetition") and o["option_key"] in ps.options:
            v = ps.options[o["option_key"]]
            if isinstance(v, str):
                calcs.append(v)
    return calcs


def _split_args(argstr: str) -> list[str]:
    parts, buf, depth, in_str, i = [], [], 0, False, 0
    while i < len(argstr):
        ch = argstr[i]
        if in_str and ch == "\\" and i + 1 < len(argstr):
            buf.append(argstr[i:i + 2]); i += 2; continue
        if ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
            elif ch == ";" and depth == 0:
                parts.append("".join(buf)); buf = []; i += 1; continue
        buf.append(ch)
        i += 1
    if buf:
        parts.append("".join(buf))
    return [p for p in parts if p.strip()]


def _matching_paren(text: str, open_idx: int) -> int:
    depth, in_str, i = 0, False, open_idx
    while i < len(text):
        ch = text[i]
        if in_str and ch == "\\" and i + 1 < len(text):
            i += 2; continue
        if ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1


def _calc_rules(parsed: list[ParsedStep], ref: Reference, res: LintResult) -> None:
    flookup = ref.function_lookup()
    arity = ref.function_arity()
    for ps in parsed:
        for calc in _calc_options(ps, ref):
            code = calc  # keep original for arg extraction; match on string-stripped copy
            stripped = strip_strings(code)
            for m in CALL_RE.finditer(stripped):
                token = m.group(1).strip()
                hit = flookup.get(token.casefold())
                if hit is None:
                    continue  # custom/plugin functions are the resolver's job
                fn = arity.get(hit["function_id"])
                if fn is None:
                    continue
                if hit["match_source"].startswith("display_") and hit["match_source"] != "display_en" \
                        and token.casefold() != fn["canonical_name"].casefold():
                    res.add("L007", "warning", ps.line,
                            f"localized function name '{token}' — use canonical EN "
                            f"'{fn['canonical_name']}' in generated calcs "
                            "(registry convention: FM calc function-name locale)")
                close = _matching_paren(stripped, m.end() - 1)
                if close < 0:
                    continue
                args = _split_args(code[m.end():close])
                lo, hi = fn["min_args"], fn["max_args"]
                if len(args) < lo or (hi is not None and len(args) > hi):
                    span = f"{lo}" if hi == lo else (f"{lo}+" if hi is None else f"{lo}-{hi}")
                    res.add("L006", "error", ps.line,
                            f"'{fn['canonical_name']}' expects {span} argument(s), "
                            f"got {len(args)}")
