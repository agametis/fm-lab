#!/usr/bin/env python3
"""fmgen — deterministic pipeline tooling for the fm-generate-script skill.

Subcommands (pipeline phases P2-P6 of the codegen method):

  parse    DRAFT.fmscript            normalize + segment + parse + lint -> IR JSON
  resolve  IR.json --file NAME       resolve object refs against fm_catalog -> report
  emit     RESOLVED.json             table-driven emission -> fmxmlsnippet
  gate     SNIPPET.xml               3-layer validation gate -> protocol JSON
  run      DRAFT.fmscript --file NAME   all phases; artifacts into --out-dir

Exit codes: 0 ok · 2 findings with severity error (pipeline must not continue)
· 3 environment/database problem.

JSON goes to stdout (or --out-dir files); human-readable summary to stderr.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
from pathlib import Path

from fmgen_lib import actionscript, db, decompile, emit, gate, lint, resolve, textform


def _fail_env(msg: str) -> int:
    print(f"fmgen: {msg}", file=sys.stderr)
    return 3


def _ir_to_json(parsed, raw_notes, lint_result) -> dict:
    return {
        "normalization": raw_notes,
        "steps": [
            {
                "line": ps.line, "step_id": ps.step_id,
                "canonical_name": ps.canonical_name, "enabled": ps.enabled,
                "options": ps.options, "canonical_text": ps.canonical_text,
            }
            for ps in parsed
        ],
        "lint": [f.as_dict() for f in lint_result.findings],
    }


def _ir_from_json(data: dict) -> list[textform.ParsedStep]:
    return [
        textform.ParsedStep(
            line=s["line"], step_id=s["step_id"],
            canonical_name=s["canonical_name"], enabled=s["enabled"],
            options=s["options"], canonical_text=s.get("canonical_text", ""),
        )
        for s in data["steps"]
    ]


def do_parse(args, ref) -> tuple[int, dict]:
    text = Path(args.input).read_text(encoding="utf-8")
    normalized, notes = textform.normalize_text(text)
    raw_steps = textform.segment(normalized, ref)
    parsed = [textform.parse_step(st, ref) for st in raw_steps if st.step_id is not None]
    result = lint.lint(raw_steps, parsed, ref)
    payload = _ir_to_json(parsed, notes, result)
    n_err = len(result.errors)
    print(f"fmgen parse: {len(parsed)} step(s), {n_err} error(s), "
          f"{len(result.findings) - n_err} warning(s)/info", file=sys.stderr)
    return (2 if n_err else 0), payload


def do_resolve(args, ref) -> tuple[int, dict]:
    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    parsed = _ir_from_json(data)
    catalog = db.catalog_db(args.catalog_db)
    report = resolve.resolve(parsed, catalog, ref, args.file)
    data["steps"] = _ir_to_json(parsed, data.get("normalization", []), lint.LintResult())["steps"]
    data["resolution"] = report.as_dict()
    n_err = len([u for u in report.unresolved if u["severity"] == "error"])
    f_err = len([f for f in report.findings if f["severity"] == "error"])
    print(f"fmgen resolve: {len(report.resolved)} resolved, "
          f"{len(report.unresolved)} unresolved ({n_err} error), "
          f"{len(report.new_objects)} new, "
          f"{len(report.findings)} finding(s) ({f_err} error)", file=sys.stderr)
    return (2 if report.has_errors else 0), data


def do_emit(args, ref) -> tuple[int, dict | str]:
    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    parsed = _ir_from_json(data)
    result = emit.emit(parsed, ref, xml_decl=args.xml_decl)
    if result.errors:
        for e in result.errors:
            print(f"fmgen emit: ERROR {e}", file=sys.stderr)
        return 2, {"errors": result.errors, "warnings": result.warnings}
    print(f"fmgen emit: {len(parsed)} step(s) emitted", file=sys.stderr)
    return 0, result.xml  # type: ignore[return-value]


def _flag(args, name: str, env: str) -> bool:
    """CLI flag with an environment fallback — the env channel is what survives
    into child processes (the agent reads the convention from the registry and
    exports it once, see SKILL.md P0)."""
    if getattr(args, name, False):
        return True
    return os.environ.get(env, "").strip().lower() in ("1", "true", "on", "yes")


def do_gate(args, ref) -> tuple[int, dict]:
    xml_text = Path(args.input).read_text(encoding="utf-8")
    resolution, ir_steps = None, None
    target_version = args.target_version
    if args.resolved:
        data = json.loads(Path(args.resolved).read_text(encoding="utf-8"))
        resolution = data.get("resolution")
        ir_steps = data.get("steps")
        if not target_version and resolution:
            for a in resolution.get("assumptions", []):
                if ", FM " in a:
                    target_version = a.rsplit(", FM ", 1)[1]
    result = gate.run_gate(xml_text, ref, resolution, target_version, ir_steps,
                           _flag(args, "check_var_init", "FMGEN_CHECK_VAR_INIT"))
    n_fail = len([c for c in result.checks if c.status == "fail"])
    n_warn = len([c for c in result.checks if c.status == "warning"])
    n_skip = len([c for c in result.checks if c.status == "skipped"])
    print(f"fmgen gate: {'PASS' if result.passed else 'FAIL'} "
          f"({len(result.checks)} checks, {n_fail} failed, {n_warn} warning, "
          f"{n_skip} skipped)", file=sys.stderr)
    return (0 if result.passed else 2), result.as_dict()


def do_actionscript(args, ref) -> tuple[int, dict]:
    try:
        layer = actionscript.ActionLayer(ref)
    except LookupError as e:
        raise db.DbError(str(e))
    if args.wrap_snippet:
        xml_text = Path(args.wrap_snippet).read_text(encoding="utf-8")
        result = actionscript.wrap_snippet(xml_text, layer, args.script_name)
    else:
        if not args.input:
            raise db.DbError("actionscript needs an IR/RESOLVED json input or --wrap-snippet")
        data = json.loads(Path(args.input).read_text(encoding="utf-8"))
        result = actionscript.from_ir(_ir_from_json(data), layer)
    payload = {
        "actions": result.actions,
        "fmjaml": actionscript.to_fmjaml(result),
        "findings": result.findings,
        "capability_notes": sorted(set(result.capability_notes)),
    }
    n_err = len([f for f in result.findings if f["severity"] == "error"])
    print(f"fmgen actionscript: {len(result.actions)} action(s), {n_err} error(s), "
          f"{len(result.findings) - n_err} warning(s)/info", file=sys.stderr)
    return (2 if result.has_errors else 0), payload


def do_decompile(args, ref) -> tuple[int, dict | str]:
    xml_text = Path(args.input).read_text(encoding="utf-8")
    catalog = None
    try:
        catalog = db.catalog_db(args.catalog_db)
    except db.DbError:
        catalog = None  # optional: only enriches layout TO names
    result = decompile.decompile(xml_text, ref, catalog, args.file)
    if result.errors:
        for e in result.errors:
            print(f"fmgen decompile: ERROR {e}", file=sys.stderr)
        return 2, {"errors": result.errors}
    print(f"fmgen decompile: {len(result.steps)} step(s), "
          f"{result.lossy_count} lossy", file=sys.stderr)
    if args.json:
        payload = {
            "text": result.text,
            "steps": [
                {
                    "index": s.index, "step_id": s.step_id,
                    "canonical_name": s.canonical_name, "enabled": s.enabled,
                    "text": s.text, "issues": s.issues, "notes": s.notes,
                }
                for s in result.steps
            ],
            "lossy": result.lossy_count,
        }
        return (2 if result.lossy_count else 0), payload
    return (2 if result.lossy_count else 0), result.text


def do_run(args, ref) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(args.input).stem

    code, ir = do_parse(args, ref)
    (out_dir / f"{stem}.ir.json").write_text(_dumps(ir), encoding="utf-8")
    if code:
        print(f"fmgen run: stopped after parse/lint — see {out_dir / (stem + '.ir.json')}",
              file=sys.stderr)
        return code

    args.input = str(out_dir / f"{stem}.ir.json")
    code, resolved = do_resolve(args, ref)
    (out_dir / f"{stem}.resolved.json").write_text(_dumps(resolved), encoding="utf-8")
    if code:
        print("fmgen run: stopped after resolve — resolution errors", file=sys.stderr)
        return code

    args.input = str(out_dir / f"{stem}.resolved.json")
    code, xml_or_err = do_emit(args, ref)
    if code:
        (out_dir / f"{stem}.emit-errors.json").write_text(_dumps(xml_or_err), encoding="utf-8")
        return code
    xml_path = out_dir / f"{stem}.xml"
    xml_path.write_text(xml_or_err, encoding="utf-8")  # type: ignore[arg-type]

    args.input = str(xml_path)
    args.resolved = str(out_dir / f"{stem}.resolved.json")
    code, protocol = do_gate(args, ref)
    (out_dir / f"{stem}.gate.json").write_text(_dumps(protocol), encoding="utf-8")
    print(f"fmgen run: artifacts in {out_dir}/ ({stem}.xml, .ir.json, "
          f".resolved.json, .gate.json)", file=sys.stderr)
    return code


def _dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(prog="fmgen", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reference-db", help="path to fm_spec.duckdb")
    ap.add_argument("--catalog-db", help="path to fm_catalog.duckdb")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("parse");  p.add_argument("input")
    p = sub.add_parser("resolve"); p.add_argument("input"); p.add_argument("--file", required=True)
    p = sub.add_parser("emit");   p.add_argument("input"); p.add_argument("--xml-decl", action="store_true")
    p = sub.add_parser("gate")
    p.add_argument("input"); p.add_argument("--resolved"); p.add_argument("--target-version")
    p.add_argument("--check-var-init", action="store_true",
                   help="check the convention that a variable used as a step target "
                        "was initialised by a preceding Set Variable (G305); "
                        "env fallback FMGEN_CHECK_VAR_INIT")
    p = sub.add_parser("actionscript")
    p.add_argument("input", nargs="?")
    p.add_argument("--wrap-snippet", help="fmxmlsnippet file for a clipboard-delivery script")
    p.add_argument("--script-name", help="target script for the delivery navigation")
    p = sub.add_parser("decompile")
    p.add_argument("input")
    p.add_argument("--file", help="FM file context for layout TO enrichment")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("run")
    p.add_argument("input"); p.add_argument("--file", required=True)
    p.add_argument("--out-dir", default="output/codegen")
    p.add_argument("--xml-decl", action="store_true")
    p.add_argument("--check-var-init", action="store_true",
                   help="see 'gate --check-var-init'")
    p.add_argument("--resolved", help=argparse.SUPPRESS)
    p.add_argument("--target-version", help=argparse.SUPPRESS)

    args = ap.parse_args()
    try:
        ref = db.Reference(db.reference_db(args.reference_db))
    except db.DbError as e:
        return _fail_env(str(e))

    try:
        if args.cmd == "run":
            return do_run(args, ref)
        fn = {"parse": do_parse, "resolve": do_resolve, "emit": do_emit, "gate": do_gate,
              "actionscript": do_actionscript, "decompile": do_decompile}[args.cmd]
        code, payload = fn(args, ref)
        sys.stdout.write(payload if isinstance(payload, str) else _dumps(payload))
        return code
    except db.DbError as e:
        return _fail_env(str(e))
    except FileNotFoundError as e:
        return _fail_env(str(e))


if __name__ == "__main__":
    sys.exit(main())
