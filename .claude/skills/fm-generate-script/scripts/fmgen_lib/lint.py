"""P3 lint rules on the segmented/parsed draft.

Rule catalog:
  L001 unknown step name (with close-match suggestion)
  L002 block balance (If/End If, Loop/End Loop, branch/exit placement)
  L003 $$$ variables
  L004 bare ::Field reference without table occurrence
  L005 bracket group on a step that takes no options
  L006 function arity in calculations (against function_parameters; bracket
       repetition groups are checked per group, see REPEAT_GROUPS)
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
from .textform import (CALL_RE, ParsedStep, RawStep, call_name_candidates,
                       matching_paren, split_args, strip_comments, strip_strings)

IF_OPEN, IF_BRANCH, IF_CLOSE = {68}, {69, 125}, {70}
LOOP_OPEN, LOOP_EXIT, LOOP_CLOSE = {71}, {72}, {73}
TRANSACTION_FLAT = {206, 207}  # Commit/Revert Transaction: save-invalid inside If

_MERGED_HEADS = {"endif": "End If", "elseif": "Else If", "endloop": "End Loop",
                 "exitloopif": "Exit Loop If"}

# Functions whose trailing parameters repeat as bracket groups:
#   JSONSetElement ( json ; [ key ; value ; type ] ; [ … ] … )
#   Substitute     ( text ; [ search ; replace ]  ; [ … ] … )
# The value is the number of elements per group. This is deliberately a closed
# list and deliberately NOT handled inside split_args(): `While`, `Let` and
# `Evaluate` also take bracket groups, but there a group is ONE argument
# (`While ( [ i = 0 ; n = 0 ] ; … )`) — expanding groups generically would turn
# those into false alarms, and split_args() is shared with the resolver's
# custom-function arity check. Verified complete against the Claris help for
# the reference's FileMaker coverage (2025): no other built-in repeats.
REPEAT_GROUPS = {"jsonsetelement": 3, "substitute": 2}


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
    _option_coupling(parsed, ref, res)
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


# Option couplings whose absence makes the emitter prune user data: the
# whole group is context-less without its carrier options, so the generic
# template prune drops it silently (WebScript subtree, steps 214/220 and any
# future step sharing the trio). Formulated over option keys, applied only
# where the step's reference declares all keys involved — a data-driven
# option-on-option table in the reference is the designated successor.
_OPTION_REQUIRES = {
    "web_script_parameters": ("web_viewer", "function_name"),
}


def _option_coupling(parsed: list[ParsedStep], ref: Reference, res: LintResult) -> None:
    for ps in parsed:
        if not ps.step_id:
            continue
        declared = None
        for key, required in _OPTION_REQUIRES.items():
            if key not in ps.options:
                continue
            if declared is None:
                declared = {o["option_key"] for o in ref.options(ps.step_id)}
            if key not in declared or not all(r in declared for r in required):
                continue
            missing = [r for r in required if r not in ps.options]
            if missing:
                res.add("L009", "error", ps.line,
                        f"'{key}' requires {' and '.join(repr(r) for r in required)}"
                        f" — without {' and '.join(repr(r) for r in missing)} the"
                        " group would be silently dropped from the emission")


def _calc_options(ps: ParsedStep, ref: Reference) -> list[str]:
    calcs = []
    for o in ref.options(ps.step_id) if ps.step_id else []:
        if o["option_type"] in ("calculation", "repetition") and o["option_key"] in ps.options:
            v = ps.options[o["option_key"]]
            if isinstance(v, str):
                calcs.append(v)
    return calcs


def _calc_rules(parsed: list[ParsedStep], ref: Reference, res: LintResult) -> None:
    flookup = ref.function_lookup()
    arity = ref.function_arity()
    for ps in parsed:
        for calc in _calc_options(ps, ref):
            # Both passes are length-preserving, so offsets stay valid — and
            # arguments are counted on the stripped copy too: a ';' inside a
            # calc comment would otherwise be read as an argument separator,
            # and a comment in front of a repetition group would hide the '['
            # that identifies it (real code puts both there, confirmed by a
            # corpus sweep).
            stripped = strip_strings(strip_comments(calc))
            for m in CALL_RE.finditer(stripped):
                # a leading word operator is part of the match, not of the name
                # ("1 or Left (") — without the split the arity/locale checks
                # below would silently skip every such call
                token, hit = None, None
                for cand in call_name_candidates(m.group(1)):
                    hit = flookup.get(cand.casefold())
                    if hit is not None:
                        token = cand
                        break
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
                close = matching_paren(stripped, m.end() - 1)
                if close < 0:
                    continue
                args = split_args(stripped[m.end():close])
                lo, hi = fn["min_args"], fn["max_args"]
                if lo == 0 and hi == 0:
                    # The reference declares no parameters at all for this
                    # function — either it genuinely takes none (those are
                    # written without parentheses and never reach here) or the
                    # parameter data is missing. Nothing to compare against, so
                    # the check stands down instead of reporting every call as
                    # 'expects 0' (mirror of the resolver's cf_arity_usable).
                    continue
                if _repetition_arity(fn, args, ps, res):
                    continue
                if len(args) < lo or (hi is not None and len(args) > hi):
                    span = f"{lo}" if hi == lo else (f"{lo}+" if hi is None else f"{lo}-{hi}")
                    res.add("L006", "error", ps.line,
                            f"'{fn['canonical_name']}' expects {span} argument(s), "
                            f"got {len(args)}")


def _repetition_arity(fn: dict, args: list[str], ps: ParsedStep, res: LintResult) -> bool:
    """Check a call written in FileMaker's bracket-repetition syntax.

    Returns True when the call uses that syntax (and was checked here), so the
    caller skips the flat min/max comparison — the reference only carries the
    base-form arity, which every repetition beyond the base form exceeds.

    Checked instead: the leading arguments before the first group, and that
    every group has exactly the group size. `n` groups stay unbounded, which is
    what FileMaker allows.
    """
    size = REPEAT_GROUPS.get(fn["canonical_name"].casefold())
    if not size:
        return False
    groups = [a.strip() for a in args if a.strip().startswith("[") and a.strip().endswith("]")]
    if not groups:
        return False  # base form — the ordinary min/max check applies
    base = fn["min_args"] - size
    plain = len(args) - len(groups)
    if plain != base:
        res.add("L006", "error", ps.line,
                f"'{fn['canonical_name']}' expects {base} argument(s) before the "
                f"first repetition group, got {plain}")
    for i, g in enumerate(groups, start=1):
        n = len(split_args(g[1:-1]))
        if n != size:
            res.add("L006", "error", ps.line,
                    f"'{fn['canonical_name']}' repetition group {i} has {n} "
                    f"element(s), expected {size}")
    return True
