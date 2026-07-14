"""ActionScript emitter — fmIDE action layer (P4 alternative target).

Translates a parsed step IR into an fmIDE Action Script, or wraps an
fmxmlsnippet into a clipboard-delivery Action Script. Two renderings of the
same action array:

  - JSON      — the interpreter's native input (`$fmide_actions=[…]`)
  - fmJAML    — the authoring notation (array forms `[+]`/`[:]` only; object
                path inheritance is not used — it is the notation's unfinished
                part per its own spec)

Data source is the action layer of fm_spec.duckdb (schema >= 1.8.0):
`step_action_map` decides WHICH steps have an action translation and how
options map onto action parameters; `action_catalog` is the validation gate
for every emitted action (unknown action, registry-only, support = No -> hard
error). Capability requirements (MBS plugin, hiatus/continuation, disabled
dispatch branch, pre-stable dev states) surface as runtime warnings: they are
preconditions of the EXECUTING fmIDE instance, not of the emission.

Value semantics: the fmIDE interpreter evaluates parameter values as FileMaker
calculations, so IR option values (already calc expressions in the canonical
textform) pass through verbatim. Exception: the `fmxmlsnippet` parameter is
consumed raw by fmIDE; in fmJAML it is emitted as a heredoc (`===`) so the
compiler quotes it into a JSON string literal without escaping.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache


def action_key(name: str) -> str:
    """fmIDE's `_fmIDE_ActionNameCamelCase` fold: Proper() + strip `-_/ `."""
    s = re.sub(r"[-_/ ]", " ", name)
    folded = "".join(w.capitalize() for w in re.split(r"\s+", s) if w)
    return (folded or name).lower()


class ActionLayer:
    """Cached read access to action_catalog / step_action_map."""

    def __init__(self, ref):
        self.ref = ref
        if not (ref.db.has_table("action_catalog") and ref.db.has_table("step_action_map")):
            raise LookupError(
                "reference DB has no action layer (needs fm_spec schema >= 1.8.0)")

    @lru_cache(maxsize=1)
    def catalog(self) -> dict[str, dict]:
        rows = self.ref.db.query(
            "SELECT action_name, action_key, classification, step_id, alias_of, "
            "support, dev_state, param_keys_observed, requires_mbs, requires_hiatus, "
            "is_disabled FROM action_catalog")
        return {r["action_key"]: r for r in rows}

    @lru_cache(maxsize=1)
    def step_map(self) -> dict[int, dict]:
        rows = self.ref.db.query(
            "SELECT step_id, action_name, action_aliases, param_map, support, "
            "dev_state, semantics_note FROM step_action_map")
        return {r["step_id"]: r for r in rows}


@dataclass
class ActionScriptResult:
    actions: list = field(default_factory=list)      # [{name: {param: expr}}]
    findings: list = field(default_factory=list)     # dicts: severity/step/message
    capability_notes: list = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return any(f["severity"] == "error" for f in self.findings)

    def finding(self, severity: str, message: str, line: int | None = None):
        self.findings.append({"severity": severity, "line": line, "message": message})


def _gate_action(layer: ActionLayer, name: str, result: ActionScriptResult,
                 line: int | None = None) -> dict | None:
    cat = layer.catalog().get(action_key(name))
    if cat is None:
        result.finding("error", f"action '{name}' not in action_catalog (G-A01)", line)
        return None
    if cat["classification"] == "registry_only":
        result.finding("error",
                       f"action '{name}' exists only in the fmIDE registry, not in the "
                       f"dispatcher — not executable (G-A02)", line)
        return None
    if (cat.get("support") or "") == "No":
        result.finding("error", f"action '{name}' has support=No (G-A03)", line)
        return None
    for flag, note in (("requires_mbs", "requires the MBS plugin"),
                       ("requires_hiatus", "uses a hiatus/continuation (GUI idle moment)"),
                       ("is_disabled", "dispatch branch is DISABLED in fmIDE 0.60")):
        if cat.get(flag):
            sev = "warning" if flag == "is_disabled" else "info"
            result.finding(sev, f"action '{name}' {note}", line)
            result.capability_notes.append(f"{name}: {note}")
    dev = (cat.get("dev_state") or "").strip()
    if dev and dev not in ("ok", "beta"):
        result.finding("warning", f"action '{name}' has dev_state='{dev}'", line)
    return cat


def from_ir(parsed_steps, layer: ActionLayer) -> ActionScriptResult:
    """Translate parsed canonical-textform steps into an action array."""
    result = ActionScriptResult()
    smap = layer.step_map()
    for ps in parsed_steps:
        if not ps.enabled:
            result.finding("warning", f"disabled step '{ps.canonical_name}' skipped "
                                      f"(disable-flag emission not curated)", ps.line)
            continue
        row = smap.get(ps.step_id)
        if row is None:
            result.finding("error",
                           f"step '{ps.canonical_name}' ({ps.step_id}) has no action "
                           f"mapping (step_action_map) — no action translation (G-A04)",
                           ps.line)
            continue
        if row.get("param_map") is None:
            result.finding("error",
                           f"step '{ps.canonical_name}' ({ps.step_id}): action "
                           f"'{row['action_name']}' exists but its param_map is not "
                           f"curated yet — generation not enabled (G-A05)", ps.line)
            continue
        if _gate_action(layer, row["action_name"], result, ps.line) is None:
            continue
        pmap = json.loads(row["param_map"])
        params: dict[str, str] = {}
        for opt_key, value in ps.options.items():
            if opt_key in pmap:
                params[pmap[opt_key]] = value
            else:
                result.finding("warning",
                               f"step '{ps.canonical_name}': option '{opt_key}' has no "
                               f"action parameter — dropped", ps.line)
        result.actions.append({row["action_name"]: params or None})
        if row.get("semantics_note"):
            result.finding("info", f"{row['action_name']}: {row['semantics_note']}", ps.line)
    return result


def fm_quote(literal: str) -> str:
    """Render a literal string as an FM calc expression (interpreter values
    are evaluated; the fmxmlsnippet parameter is the raw-consumed exception)."""
    return '"' + literal.replace("\\", "\\\\").replace('"', '\\"') + '"'


def wrap_snippet(xml_text: str, layer: ActionLayer,
                 script_name: str | None = None) -> ActionScriptResult:
    """Clipboard-delivery Action Script: put an fmxmlsnippet on the clipboard,
    optionally navigate to a target script, then paste (hiatus)."""
    result = ActionScriptResult()
    chain: list[tuple[str, dict | None]] = [("Set Clipboard Objects",
                                             {"fmxmlsnippet": xml_text.strip()})]
    if script_name:
        chain.append(("Go to Script", {"script_name": fm_quote(script_name)}))
    chain.append(("Paste", None))
    for name, params in chain:
        if _gate_action(layer, name, result) is None:
            continue
        result.actions.append({name: params})
    return result


# ---------------------------------------------------------------------------
# renderings
# ---------------------------------------------------------------------------

def to_json(result: ActionScriptResult) -> str:
    return json.dumps(result.actions, ensure_ascii=False, indent=2) + "\n"


_HEREDOC_PARAMS = {"fmxmlsnippet"}   # consumed raw by fmIDE; heredoc avoids escaping


def _heredoc_marker(body: str) -> str:
    marker = "==="
    while marker in body:
        marker += "="
    return marker


def to_fmjaml(result: ActionScriptResult) -> str:
    """Array forms only (`[+]` new element, `[:]` same element); values are
    calc expressions and pass through raw, except heredoc parameters."""
    lines: list[str] = ["# fmIDE Action Script (generated by fmgen)"]
    for action in result.actions:
        (name, params), = action.items()
        if not params:
            lines.append(f"[+].{name} =")
            continue
        prefix = "[+]"
        for pname, value in params.items():
            path = f"{prefix}.{name}.{pname}"
            if pname in _HEREDOC_PARAMS and isinstance(value, str):
                m = _heredoc_marker(value)
                lines.append(f"{path} = {m}")
                lines.append(value.rstrip("\n"))
                lines.append(m)
            else:
                lines.append(f"{path} = {value}")
            prefix = "[:]"
    return "\n".join(lines) + "\n"
