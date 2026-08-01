"""Canonical script text form: normalization (P2) and parsing to IR.

Implements fm-spec script-text-notation v0.1 (rules T1-T8):
  - step name at line start is the only structural anchor (T1), resolved via
    script_step_name_lookup in any of the 11 locales
  - one bracket group, `;`-separated params (T2/T3), quote-/paren-aware
  - named options `Label: value`, positional values map to unlabeled inline
    options in sort_order (T4, data-driven from step_options)
  - `#` comment steps, `// ` disabled prefix (T6)
  - multi-line calculations continue the previous step (T7)
  - unicode hygiene and ASCII operators (T8)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .db import Reference

# ---------------------------------------------------------------- P2 normalize

_UNICODE_OPS = {"≠": "<>", "≤": "<=", "≥": ">="}
_STRIP_CHARS = "﻿‎‏"  # BOM, LRM, RLM


def normalize_text(text: str) -> tuple[str, list[str]]:
    """Transport hygiene per T8. Returns (normalized, change notes)."""
    notes = []
    for pattern, repl, note in (
        ("\r\n", "\n", "CRLF -> LF"),
        ("\r", "\n", "CR -> LF"),
        (" ", "\n", "U+2028 -> LF"),
        (" ", "\n", "U+2029 -> LF"),
        (" ", " ", "NBSP -> space"),
    ):
        if pattern in text:
            text = text.replace(pattern, repl)
            notes.append(note)
    for ch in _STRIP_CHARS:
        if ch in text:
            text = text.replace(ch, "")
            notes.append(f"stripped U+{ord(ch):04X}")
    # Unicode operators -> ASCII, but never inside string literals.
    if any(ch in text for ch in _UNICODE_OPS):
        text = _replace_outside_strings(text, _UNICODE_OPS)
        notes.append("unicode operators -> ASCII")
    return text, notes


def _replace_outside_strings(text: str, mapping: dict[str, str]) -> str:
    out, in_str, i = [], False, 0
    while i < len(text):
        ch = text[i]
        if in_str and ch == "\\" and i + 1 < len(text):
            out.append(text[i:i + 2]); i += 2; continue
        if ch == '"':
            in_str = not in_str
        out.append(mapping.get(ch, ch) if not in_str else ch)
        i += 1
    return "".join(out)


def strip_strings(text: str) -> str:
    """Replace string-literal contents with spaces (for regex lint rules)."""
    out, in_str, i = [], False, 0
    while i < len(text):
        ch = text[i]
        if in_str and ch == "\\" and i + 1 < len(text):
            out.append("  "); i += 2; continue
        if ch == '"':
            in_str = not in_str
            out.append('"')
        else:
            out.append(" " if in_str else ch)
        i += 1
    return "".join(out)


def strip_comments(text: str) -> str:
    """Replace FileMaker calc comments ('//' to end of line, '/* … */') with
    spaces, length- and line-preserving so match offsets stay valid.

    Comment prose is not code: without this, the multi-word tolerance of CALL_RE
    glues the words in front of a call onto its name ('// liefert die Anzahl'
    followed by 'Get (' reads as the name 'liefert die Anzahl Get'). String
    literals win — a '//' inside a string is text, not a comment — so this pass
    tracks strings itself and must run before strip_strings()."""
    out, i, n, in_str = [], 0, len(text), False
    while i < n:
        ch = text[i]
        if in_str:
            if ch == "\\" and i + 1 < n:
                out.append(text[i:i + 2]); i += 2; continue
            if ch == '"':
                in_str = False
            out.append(ch); i += 1; continue
        if ch == '"':
            in_str = True; out.append(ch); i += 1; continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                out.append(" "); i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            out.append("".join(" " if c != "\n" else "\n" for c in text[i:end]))
            i = end
            continue
        out.append(ch); i += 1
    return "".join(out)


# Function-call anchor for calc scanning: an identifier (optionally a multi-word
# name) immediately before an opening paren. Shared by the lint (arity/locale
# checks) and the resolver (custom-function / unknown-function detection) so both
# agree on what counts as "a function call". Always match on a string- and
# comment-stripped copy so parens inside literals or prose never register as
# calls: strip_strings(strip_comments(calc)).
# The name class must cover every character FileMaker allows in a custom-function
# name, not just ASCII letters: a leading underscore ("_EncodeCR") or a non-ASCII
# letter ("Größe") would otherwise not start a name, and the match would begin
# mid-word ("e (") — a name that resolves against nothing. [^\W\d] is the
# unicode-aware "letter or underscore".
_NAME = r"[^\W\d][\w.]*"
CALL_RE = re.compile(rf"({_NAME}(?:\s{_NAME})*?)\s*\(")

# FileMaker's word operators are spelled with ordinary name characters, so the
# multi-word tolerance of CALL_RE (required for custom functions with spaces,
# e.g. "Check eMail") glues them — and the bare operand in front of them — onto
# the function name: "1 or Get (" reads as the name "or Get", "Kunde::Name and
# Get (" as "Name and Get", and "not ( … )" as the name "not" although the paren
# only groups. call_name_candidates() undoes that gluing.
# The German UI localizes them (Claris help, "Logische Operatoren"); every other
# mirrored language keeps the EN spelling.
WORD_OPERATORS = frozenset({"and", "or", "not", "xor",
                            "und", "oder", "nicht", "xoder"})


def call_name_candidates(token: str) -> list[str]:
    """Function-name candidates for a CALL_RE match, longest first.

    The full token comes first so a custom function whose own name starts with
    an operator word still wins over the split form; each further candidate
    drops everything up to and including one word operator. An empty list means
    the paren groups an expression instead of calling something: nothing can be
    called through an operator, so a token ending in one is not a name.

        "Check eMail"    -> ["Check eMail"]
        "or Get"         -> ["or Get", "Get"]
        "Name and Get"   -> ["Name and Get", "Get"]
        "not"            -> []
        "Summe or"       -> []

    Consumers try the candidates in order against their positive lists and fall
    back to the last (shortest) one for reporting."""
    words = token.split()
    if not words or words[-1].casefold() in WORD_OPERATORS:
        return []
    out = [" ".join(words)]
    for i, w in enumerate(words):
        if w.casefold() in WORD_OPERATORS and i + 1 < len(words):
            cand = " ".join(words[i + 1:])
            if cand not in out:
                out.append(cand)
    return out


def matching_paren(text: str, open_idx: int) -> int:
    """Index of the ')' closing the '(' at open_idx, or -1 when unbalanced.

    Quote-aware: a paren inside a string literal does not count. Together with
    split_args() this turns a CALL_RE match into an argument count — used by the
    lint for built-in arity (L006) and by the resolver for custom-function arity.
    """
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


def split_args(argstr: str) -> list[str]:
    """Split an argument list on top-level ';' (quote-, paren- and bracket-aware).

    Empty parts are dropped, so `f ( )` counts as zero arguments — which is what
    both arity checks compare against.
    """
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


# ------------------------------------------------------------------- segmenter

@dataclass
class RawStep:
    line: int                       # 1-based line number of the step start
    head: str                       # step-name token as written
    step_id: int | None             # resolved via lookup (None = unknown)
    match_source: str | None
    enabled: bool = True
    is_comment: bool = False
    params_raw: str | None = None   # inside of the bracket group, unsplit
    raw: str = ""                   # full (possibly multi-line) source text
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _scan_state(text: str, depth: int, in_str: bool,
                in_block: bool = False) -> tuple[int, bool, bool]:
    """Advance (bracket depth, inside-string, inside block comment) over text.

    The state decides what counts as a continuation line (T7), so anything that
    is prose rather than code must not move it: a lone '(' or an odd number of
    '"' inside a calc comment would otherwise glue the following line onto this
    step — silently, because a phantom continuation produces no finding.

    Callers pass the line WITHOUT a leading '// ' disable prefix (T6): that
    prefix marks a disabled step, not a comment, and its continuation lines
    carry it too.
    """
    i = 0
    while i < len(text):
        ch = text[i]
        if in_block:
            if text.startswith("*/", i):
                in_block = False; i += 2; continue
            i += 1; continue
        if in_str:
            if ch == "\\" and i + 1 < len(text):
                i += 2; continue
            if ch == '"':
                in_str = False
            i += 1; continue
        if ch == '"':
            in_str = True; i += 1; continue
        if text.startswith("//", i):
            break  # rest of the line is a calc comment
        if text.startswith("/*", i):
            in_block = True; i += 2; continue
        if ch in "[({":
            depth += 1
        elif ch in "])}":
            depth -= 1
        i += 1
    return max(depth, 0), in_str, in_block


def segment(text: str, ref: Reference) -> list[RawStep]:
    lookup = ref.step_name_lookup()
    steps: list[RawStep] = []
    depth, in_str, in_block = 0, False, False

    for lineno, line in enumerate(text.split("\n"), start=1):
        stripped = line.strip()
        # a continuation belongs to the step it continues — capture that step's
        # disabled state before this line possibly appends a new one
        continuing = depth > 0 or in_str or in_block
        prev_disabled = bool(steps) and continuing and not steps[-1].enabled
        match = None
        if stripped and not continuing:
            match = _match_head(stripped, lookup)
        if match is not None:
            head, step_id, source, is_comment = match
            steps.append(RawStep(
                line=lineno, head=head, step_id=step_id, match_source=source,
                enabled=not stripped.startswith("// "), is_comment=is_comment,
                raw=line,
            ))
        elif steps and continuing:
            # genuine continuations (multi-line calcs) always sit inside an
            # open bracket group, string or block comment (T7); at depth 0 an
            # unmatched line is an unknown step, not a continuation
            steps[-1].raw += "\n" + line
            # Structural guard: a continuation that reads like a step name is
            # almost always a swallowed step — the line above left a bracket or
            # a comment open. Silent merges produce no other finding (the gate
            # only ever sees the steps that survived), so say it here. Inside a
            # string literal the same text is just text, so that case is quiet.
            if not in_str and stripped and _match_head(stripped, lookup) is not None:
                steps[-1].warnings.append(
                    f"line {lineno}: '{_ellipsis(stripped, 40)}' reads like a step "
                    f"but continues line {steps[-1].line} — check that line for an "
                    "unclosed bracket, quote or comment")
        elif stripped:
            steps.append(RawStep(
                line=lineno, head=stripped.split("[")[0].strip(), step_id=None,
                match_source=None, raw=line,
                errors=[f"line {lineno}: no known step name at line start"],
            ))

        # A comment step ends hard at the end of its line. Its payload is
        # arbitrary prose: an unbalanced '(' would pull the next line into the
        # comment, an unbalanced '[' the whole rest of the draft — in both
        # cases silently, since a phantom continuation produces no finding.
        if match is not None and match[3]:
            continue
        # The '//' of a disabled step (T6) is a prefix, not a comment — strip it
        # so _scan_state does not read the rest of the line as commented out.
        scan = line
        if (match is not None and stripped.startswith("// ")) or \
                (match is None and prev_disabled and stripped.startswith("//")):
            cut = line.index("//")
            scan = line[:cut] + line[cut + 2:]
        depth, in_str, in_block = _scan_state(scan, depth, in_str, in_block)

    _extract_params(steps)
    return steps


def _match_head(stripped: str, lookup: dict) -> tuple[str, int | None, str | None, bool] | None:
    """Match a step name at line start. Returns (head, step_id, source, is_comment)."""
    body = stripped
    if body.startswith("// "):
        body = body[3:].lstrip()
    if body.startswith("#"):
        return ("#", 89, "comment_shorthand", True)
    head = body.split("[", 1)[0].strip()
    if not head:
        return None
    hit = lookup.get(head.casefold())
    if hit:
        return (head, hit["step_id"], hit["match_source"], hit["step_id"] == 89)
    return None


def _extract_params(steps: list[RawStep]) -> None:
    for st in steps:
        if st.is_comment and st.head == "#":
            # A comment body keeps trailing / whitespace-only content: FileMaker
            # treats "# " (<Text> </Text>) as a state distinct from the empty
            # trenner line (<Step .../>). Only leading indentation and the
            # disabled prefix are structural — lstrip those, then drop exactly
            # one delimiter space after the '#' and keep the rest verbatim.
            body = st.raw.lstrip()
            if not st.enabled and body.startswith("// "):
                body = body[3:].lstrip()
            text = body[1:]
            st.params_raw = text[1:] if text.startswith(" ") else text
            continue
        body = st.raw.strip()
        if not st.enabled and body.startswith("// "):
            body = body[3:].lstrip()
        idx = body.find("[")
        if idx < 0:
            st.params_raw = None
            continue
        if not body.rstrip().endswith("]"):
            st.errors.append(f"line {st.line}: bracket group not closed")
            st.params_raw = body[idx + 1:]
            continue
        st.params_raw = body[idx + 1: body.rstrip().rfind("]")].strip()


def split_params(content: str) -> list[str]:
    """Split a bracket group on top-level `;` (quote-, paren- and bracket-aware, T3)."""
    parts, buf, depth, in_str, i = [], [], 0, False, 0
    while i < len(content):
        ch = content[i]
        if in_str and ch == "\\" and i + 1 < len(content):
            buf.append(content[i:i + 2]); i += 2; continue
        if ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch in "[({":
                depth += 1
            elif ch in "])}":
                depth -= 1
            elif ch == ";" and depth == 0:
                parts.append("".join(buf).strip()); buf = []; i += 1; continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail or parts:
        parts.append(tail)
    return [p for p in parts if p != ""]


# ------------------------------------------------------------- option mapping

_LABEL_RE = re.compile(r"^([^\";:\[\]]{1,40}?):\s+(.*)$", re.S)
_FIELD_REF_RE = re.compile(
    r'^([\wÀ-ɏЀ-ӿ .\-]+)::([\wÀ-ɏЀ-ӿ .\-]+)'
    r'(?:\s*\[\s*(.+?)\s*\])?$', re.S)
_QUOTED_TO_RE = re.compile(r'^"(.*)"\s*\(\s*([^)]+?)\s*\)$', re.S)
_QUOTED_RE = re.compile(r'^"(.*)"$', re.S)
_NEW_RE = re.compile(r"^\{\{NEW:(\w+):(.+)\}\}$", re.S)
# The same declaration INSIDE a calculation, where it marks one token of a
# larger expression instead of the whole parameter value — used for a custom
# function that does not exist in the catalog yet ("create before paste").
# Unanchored on purpose; the resolver strips every match before emission, so a
# marker never reaches FileMaker.
NEW_IN_CALC_RE = re.compile(r"\{\{NEW:(\w+):([^{}]+)\}\}")
# A script-local variable ($x / $$x). Only ever accepted where a step writes
# its result into a target (see _coerce) — never as an object reference.
_VAR_RE = re.compile(r"^\$\$?[A-Za-z_][\w.]*$")


def parse_ref(value: str) -> dict | None:
    """Parse a T5 object reference. Returns dict or None if not reference-shaped.

    `_form` records the surface syntax: 'field' (TO::Field), 'layout'
    ("Name" (TO)), 'named' ("Name").
    """
    value = value.strip()
    m = _NEW_RE.match(value)
    if m:
        inner = parse_ref(m.group(2)) or {"name": m.group(2), "_form": "named"}
        inner["new"] = True
        inner["new_type"] = m.group(1)
        return inner
    m = _FIELD_REF_RE.match(value)
    if m:
        ref = {"table": m.group(1).strip(), "name": m.group(2).strip(), "_form": "field"}
        if m.group(3):
            ref["repetition"] = m.group(3).strip()
        return ref
    m = _QUOTED_TO_RE.match(value)
    if m:
        return {"name": m.group(1), "table": m.group(2).strip(), "_form": "layout"}
    m = _QUOTED_RE.match(value)
    if m:
        return {"name": m.group(1), "_form": "named"}
    return None


def _norm_label(s: str) -> str:
    return re.sub(r"[^0-9a-zA-Z]+", "", s).casefold()


@dataclass
class ParsedStep:
    line: int
    step_id: int
    canonical_name: str
    enabled: bool
    options: dict = field(default_factory=dict)
    raw: str = ""
    canonical_text: str = ""
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def parse_step(st: RawStep, ref: Reference) -> ParsedStep:
    canonical = ref.steps().get(st.step_id, {}).get("canonical_name", st.head)
    ps = ParsedStep(line=st.line, step_id=st.step_id, canonical_name=canonical,
                    enabled=st.enabled, raw=st.raw.strip(), errors=list(st.errors),
                    warnings=list(st.warnings))

    if st.step_id == 89:  # comment: single positional text
        # Keep the payload verbatim — a whitespace-only body is an intentional
        # FileMaker state, so it must not be stripped away here. An empty
        # params_raw stays falsy and yields the empty trenner comment.
        if st.params_raw:
            ps.options["text"] = st.params_raw
        ps.canonical_text = render_canonical(ps, ref)
        return ps

    opts = ref.options(st.step_id)
    tpl = (ref.xml_map(st.step_id) or {}).get("snippet_template", "") or ""

    def unsatisfied_required(keys_present) -> list[str]:
        """Required options are only missing when the template holds a
        defaultless placeholder for them (literals / {key|default} self-satisfy)."""
        out = []
        for o in opts:
            if o["required"] and o["option_key"] not in keys_present and re.search(
                    r"\{%s(?::[a-z_]+)?\}" % re.escape(o["option_key"]), tpl):
                out.append(o["option_key"])
        return out

    if st.params_raw is None:
        for key in unsatisfied_required(set()):
            ps.errors.append(
                f"line {st.line}: step '{canonical}' requires option '{key}' "
                "(bracket group missing)")
        ps.canonical_text = render_canonical(ps, ref)
        return ps
    if not opts:
        ps.errors.append(
            f"line {st.line}: step '{canonical}' takes no options but has a bracket group (T2)")
        ps.canonical_text = render_canonical(ps, ref)
        return ps

    params = split_params(st.params_raw)
    hint = STEP_HINTS.get(st.step_id)
    if hint:
        params = hint(ps, params, ref)

    by_label = {}
    for o in opts:
        if o["display_label_en"]:
            by_label[_norm_label(o["display_label_en"])] = o
        by_label.setdefault(_norm_label(o["option_key"]), o)
    positional = [o for o in opts
                  if o["display_location"] == "inline" and not o["display_label_en"]]
    inline_all = [o for o in opts if o["display_location"] == "inline"]

    def take_bare_boolean(param: str):
        """Flag-style booleans render as a bare keyword (Sort Records
        'Restore', Insert Text 'Select') — match against true_/false_text."""
        p = param.strip().casefold()
        for o in opts:
            if o["option_type"] != "boolean" or o["option_key"] in ps.options:
                continue
            if p and p in ((o["true_text"] or "").casefold(), (o["false_text"] or "").casefold()):
                return o
        return None

    def take_positional(param: str):
        """sort_order is XML order, not display order (e.g. Set Field renders
        target before result but serializes Calculation before Field) — so
        reference-shaped params bind to ref-typed options first."""
        free = [o for o in positional if o["option_key"] not in ps.options]
        # only unambiguous reference syntax (TO::Field, "Name" (TO)) prefers
        # ref-typed options; a bare quoted string is usually a calculation
        r = parse_ref(param) if _LABEL_RE.match(param) is None else None
        is_ref = bool(r) and r.get("_form") in ("field", "layout")
        if is_ref:
            # ref params may also fill labeled ref options (label often
            # omitted in drafts, e.g. Insert Text 'Target:')
            pool = [o for o in inline_all
                    if o["option_type"] in ("object_ref", "target")
                    and o["option_key"] not in ps.options]
            if pool:
                return pool[0]
        if not free:
            # single-free-option fallback: a bare (non-label-shaped) value maps
            # unambiguously when exactly one inline option is still unfilled,
            # even if that option carries a display label — e.g.
            # `Exit Script [ $n ]` == `Exit Script [ Text Result: $n ]`.
            # Label-shaped params stay strict so mistyped/localized labels
            # fail loudly instead of being swallowed as calculation text.
            if _LABEL_RE.match(param) is None:
                free_inline = [o for o in inline_all if o["option_key"] not in ps.options]
                if len(free_inline) == 1:
                    return free_inline[0]
            return None
        pool = [o for o in free if (o["option_type"] in ("object_ref", "target")) == is_ref]
        return (pool or free)[0]

    for param in params:
        opt = None
        value = param
        m = _LABEL_RE.match(param)
        if m and _norm_label(m.group(1)) in by_label:
            opt = by_label[_norm_label(m.group(1))]
            value = m.group(2).strip()
        else:
            opt = take_bare_boolean(param) or take_positional(param)
        if opt is None:
            ps.errors.append(
                f"line {st.line}: cannot map parameter '{_ellipsis(param)}' "
                f"to an option of '{canonical}'")
            continue
        if opt["option_key"] in ps.options:
            ps.errors.append(f"line {st.line}: option '{opt['option_key']}' given twice")
            continue
        coerced = _coerce(ps, opt, value, ref)
        if coerced is not None:
            ps.options[opt["option_key"]] = coerced

    for key in unsatisfied_required(set(ps.options)):
        ps.errors.append(
            f"line {st.line}: required option '{key}' missing for '{canonical}'")

    ps.canonical_text = render_canonical(ps, ref)
    return ps


def _coerce(ps: ParsedStep, opt: dict, value: str, ref: Reference):
    kind = opt["option_type"]
    key = opt["option_key"]
    if kind == "boolean":
        true_t = (opt["true_text"] or "On").casefold()
        false_t = (opt["false_text"] or "Off").casefold()
        v = value.strip().casefold()
        state = None
        if v == true_t:
            state = True
        elif v == false_t:
            state = False
        elif v in ("on", "true"):
            state = True
        elif v in ("off", "false"):
            state = False
        if state is None:
            ps.errors.append(f"line {ps.line}: '{value}' is not a valid state for '{key}'")
            return None
        # normative in current reference builds: true_/false_text ARE the display
        # texts that produce XML state True/False — never invert on top
        # (inverted_label is documentary only)
        return "True" if state else "False"
    if kind == "enum":
        for row in ref.option_values(ps.step_id):
            if row["option_key"] != key:
                continue
            if row["display_text_en"] and row["display_text_en"].casefold() == value.casefold():
                return row["xml_value"]
            if row["xml_value"].casefold() == value.casefold():
                return row["xml_value"]
        ps.errors.append(
            f"line {ps.line}: '{value}' is not a known value for enum '{key}' "
            f"(valid: {', '.join(sorted({r['xml_value'] for r in ref.option_values(ps.step_id) if r['option_key'] == key}))})")
        return None
    if kind in ("object_ref", "target"):
        # A target may be a field OR a script-local variable ($x/$$x); an
        # object_ref always names a catalog object and never takes a variable.
        if kind == "target" and _VAR_RE.match(value.strip()):
            return {"name": value.strip(), "_form": "variable"}
        r = parse_ref(value)
        if r is None:
            ps.errors.append(
                f"line {ps.line}: '{_ellipsis(value)}' is not a valid object reference for '{key}'")
            return None
        return r
    return value  # calculation / text / repetition: verbatim


def _ellipsis(s: str, n: int = 60) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


# ------------------------------------------------------- step-specific hints
# The canonical text form of a few very common steps cannot be mapped purely
# data-driven. Hints pre-process the param list; they may set options directly
# and return the remaining params. Extension labels (Button1:, Input1:) cover
# dialog-only options that rule T4 excludes from the plain text form.

def _hint_go_to_layout(ps: ParsedStep, params: list[str], ref: Reference) -> list[str]:
    rest = []
    for p in params:
        pl = p.strip().casefold()
        if "destination" in ps.options and parse_ref(p) is None and _LABEL_RE.match(p) is None:
            rest.append(p); continue
        if pl in ("original layout", "originallayout"):
            ps.options["destination"] = "OriginalLayout"
        elif parse_ref(p) and _QUOTED_TO_RE.match(p.strip()):
            ps.options["destination"] = "SelectedLayout"
            ps.options["layout"] = parse_ref(p)
        else:
            rest.append(p)
    return rest


def _hint_perform_script(ps: ParsedStep, params: list[str], ref: Reference) -> list[str]:
    rest, mode = [], "From list"
    for p in params:
        m = _LABEL_RE.match(p)
        if m and _norm_label(m.group(1)) == "specified":
            mode = m.group(2).strip()
            continue
        rest.append(p)
    out = []
    for p in rest:
        m = _LABEL_RE.match(p)
        if m:
            out.append(p); continue
        if mode.casefold() == "by name":
            ps.options["script_name_calc"] = p
        elif parse_ref(p):
            ps.options["script"] = parse_ref(p)
        else:
            out.append(p)
    return out


def _hint_custom_dialog(ps: ParsedStep, params: list[str], ref: Reference) -> list[str]:
    rest = []
    for p in params:
        m = _LABEL_RE.match(p)
        if m:
            label = _norm_label(m.group(1))
            bm = re.match(r"^button([123])(commit)?$", label)
            im = re.match(r"^input([1-3])(field|label|password)?$", label)
            if bm:
                suffix = "commit" if bm.group(2) else "label"
                ps.options[f"button{bm.group(1)}_{suffix}"] = m.group(2).strip()
                continue
            if im:
                kind = im.group(2) or "field"
                key = {"field": f"input{im.group(1)}_field",
                       "label": f"input{im.group(1)}_label",
                       "password": f"input{im.group(1)}_use_password"}[kind]
                val = m.group(2).strip()
                ps.options[key] = parse_ref(val) if kind == "field" else val
                continue
        rest.append(p)
    # a dialog always carries at least one button; FileMaker's default is "OK"
    if not any(k.startswith("button") and k.endswith("_label") for k in ps.options):
        ps.options["button1_label"] = '"OK"'
    return rest


def _hint_pause(ps: ParsedStep, params: list[str], ref: Reference) -> list[str]:
    # 'Duration (seconds): n' implies pause_time=ForDuration
    for p in params:
        m = _LABEL_RE.match(p)
        if m and _norm_label(m.group(1)) == "durationseconds":
            ps.options.setdefault("pause_time", "ForDuration")
    return params


STEP_HINTS = {
    6: _hint_go_to_layout,
    1: _hint_perform_script,
    87: _hint_custom_dialog,
    62: _hint_pause,
}


# ------------------------------------------------------------ canonical render

def render_ref(val: dict) -> str:
    form = val.get("_form", "named")
    if form == "variable":
        return val.get("name", "")
    if form == "field":
        rep = f' [{val["repetition"]}]' if val.get("repetition") else ""
        return f'{val["table"]}::{val["name"]}{rep}'
    if form == "layout":
        return f'"{val["name"]}" ({val["table"]})'
    return f'"{val.get("name", "")}"'


def render_canonical(ps: ParsedStep, ref: Reference | None = None) -> str:
    """Render the parsed step back to canonical text (T1-T4 spacing)."""
    prefix = "" if ps.enabled else "// "
    if ps.step_id == 89:
        text = ps.options.get("text", "")
        # empty body -> bare '#'; any (whitespace-only) body -> '# ' + body, so
        # the single delimiter space round-trips back to the same payload.
        return f"{prefix}# {text}" if text else f"{prefix}#"
    if not ps.options:
        return prefix + ps.canonical_name
    meta = {}
    if ref is not None:
        meta = {o["option_key"]: o for o in ref.options(ps.step_id)}
    parts = []
    for key, val in ps.options.items():
        o = meta.get(key, {})
        if isinstance(val, dict):
            rendered = render_ref(val)
        elif o.get("option_type") == "boolean":
            # true_/false_text map XML state -> display text directly (1.7.0 norm)
            state = val == "True"
            if o.get("true_text") and not o.get("false_text"):
                # Flag-style boolean (no off text): displayed as the bare flag
                # keyword when set, absent when not — matches FileMaker's
                # rendering and take_bare_boolean's parse direction.
                if not state:
                    continue
                parts.append(o["true_text"])
                continue
            rendered = (o.get("true_text") or "On") if state else (o.get("false_text") or "Off")
        elif o.get("option_type") == "enum":
            # enum states whose display text is another option's value (e.g.
            # Go to Layout destination=SelectedLayout) do not render separately
            display = next((r["display_text_en"] for r in (ref.option_values(ps.step_id) if ref else [])
                            if r["option_key"] == key and r["xml_value"] == val), None)
            if display and "{" in display:
                continue
            rendered = display or str(val)
        else:
            rendered = str(val)
        label = o.get("display_label_en")
        parts.append(f"{label}: {rendered}" if label else rendered)
    if not parts:
        return prefix + ps.canonical_name
    return f"{prefix}{ps.canonical_name} [ {' ; '.join(parts)} ]"
