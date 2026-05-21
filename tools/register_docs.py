#!/usr/bin/env python3
"""
Register or update a documentation source in `.fmlab/docs.json` (v2 schema).

Called by the `install-*-docs` skills at the end of their install / update
flow. Updates an entry in the `installed[]` list of the manifest — the
maintainer-curated `catalog[]` stays untouched.

Usage (from any installer script):

    python3 tools/register_docs.py \\
        --id mbs \\
        --directory docs/mbs \\
        --version 2026-05-20 \\
        --languages en \\
        --categories 168 \\
        --functions 7298

Multiple `--languages` flags are supported (or pass a comma-separated list).
Numeric fields accept `none` to mark "not applicable" — useful for plain
markdown docs without a function index (e.g. fmIDE wiki).

The manifest is rewritten atomically. Existing entries with the same `id`
in `installed[]` are replaced (not merged) so installers stay the single
source of truth for their own runtime metadata. Other entries are left
untouched.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


CURRENT_SCHEMA_VERSION = 2


def repo_root() -> Path:
    here = Path(__file__).resolve().parent
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=here,
            stderr=subprocess.DEVNULL,
        )
        root = Path(out.decode().strip())
        if root.exists():
            return root
    except Exception:
        pass
    return here.parent


def _parse_int_or_none(s: str | None) -> int | None:
    if s is None:
        return None
    s = s.strip()
    if s == "" or s.lower() in ("none", "null"):
        return None
    try:
        return int(s)
    except ValueError:
        print(f"register_docs: ignoring non-integer value '{s}'", file=sys.stderr)
        return None


def _parse_languages(values: list[str]) -> list[str]:
    out: list[str] = []
    for v in values:
        for part in v.split(","):
            p = part.strip()
            if p and p not in out:
                out.append(p)
    return out


def _parse_bool_or_none(s: str | None) -> bool | None:
    if s is None:
        return None
    s = s.strip().lower()
    if s in ("", "none", "null"):
        return None
    if s in ("true", "yes", "1", "ok"):
        return True
    if s in ("false", "no", "0"):
        return False
    return None


def load_manifest(manifest_path: Path) -> dict:
    if not manifest_path.exists():
        return {"$schema_version": CURRENT_SCHEMA_VERSION, "catalog": [], "installed": []}
    with open(manifest_path, encoding="utf-8") as f:
        raw = json.load(f)
    if raw.get("$schema_version") != CURRENT_SCHEMA_VERSION:
        raise SystemExit(
            f"register_docs: unsupported $schema_version {raw.get('$schema_version')!r} "
            f"in {manifest_path} — expected {CURRENT_SCHEMA_VERSION}"
        )
    raw.setdefault("catalog", [])
    raw.setdefault("installed", [])
    return raw


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".docs.", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Register documentation in .fmlab/docs.json (v2)")
    parser.add_argument("--id", required=True, help="Stable identifier (e.g. 'mbs', 'claris-help').")
    parser.add_argument("--directory", required=True, help="Path relative to the repo root.")
    parser.add_argument("--version", default=None, help="Opaque version string (date / commit hash).")
    parser.add_argument(
        "--languages",
        action="append",
        default=[],
        help="Installed language code(s). Repeatable; comma-separated values also accepted.",
    )
    parser.add_argument("--categories", default=None, help="Stat: number of categories (int or 'none').")
    parser.add_argument("--functions", default=None, help="Stat: number of functions (int or 'none').")
    parser.add_argument("--index-ok", default=None, help="Stat: index health check result (true/false/none).")
    parser.add_argument(
        "--installed-at",
        default=None,
        help="ISO-8601 timestamp; defaults to the current UTC time.",
    )
    parser.add_argument(
        "--remove",
        action="store_true",
        help="Remove the entry with this --id from installed[] instead of registering it.",
    )
    # Legacy v1 flags — accepted (but ignored) so existing install-*-docs skill
    # scripts keep working without modification. Catalog metadata lives in
    # catalog[] and is maintained by the human author of .fmlab/docs.json.
    parser.add_argument("--name", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--description", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--skill", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--source-url", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    root = repo_root()
    manifest_path = root / ".fmlab" / "docs.json"
    manifest = load_manifest(manifest_path)
    installed: list[dict] = manifest["installed"]
    others = [d for d in installed if d.get("id") != args.id]

    if args.remove:
        manifest["installed"] = others
        write_atomic(manifest_path, manifest)
        print(f"register_docs: removed '{args.id}' from installed[] in {manifest_path}")
        return 0

    entry = {
        "id": args.id,
        "directory": args.directory,
        "version": args.version,
        "installed_at": args.installed_at
        or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "languages": _parse_languages(args.languages),
        "stats": {
            "categories": _parse_int_or_none(args.categories),
            "functions": _parse_int_or_none(args.functions),
            "index_ok": _parse_bool_or_none(args.index_ok),
        },
    }

    manifest["installed"] = others + [entry]
    write_atomic(manifest_path, manifest)
    print(f"register_docs: '{args.id}' written to installed[] in {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
