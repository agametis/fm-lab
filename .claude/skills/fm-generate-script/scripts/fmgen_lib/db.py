"""DuckDB access layer for fmgen.

Queries go through the DuckDB CLI binary (no Python duckdb module required
in the fm-lab container). All access is read-only.

Database resolution order:
  1. explicit CLI flag (--reference-db / --catalog-db)
  2. environment (FMGEN_REFERENCE_DB / FMGEN_CATALOG_DB)
  3. repo-root defaults: reference/fm_spec.duckdb and
     db/fm_catalog.duckdb (repo root = nearest ancestor with CLAUDE.md)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path


class DbError(RuntimeError):
    pass


def find_repo_root(start: Path | None = None) -> Path:
    p = (start or Path(__file__)).resolve()
    for parent in [p] + list(p.parents):
        if (parent / "CLAUDE.md").exists() or (parent / ".git").exists():
            return parent
    raise DbError("repo root not found (no CLAUDE.md/.git in ancestors)")


def duckdb_binary() -> str:
    exe = os.environ.get("FMGEN_DUCKDB", shutil.which("duckdb"))
    if not exe:
        raise DbError("duckdb binary not found on PATH (see docs/agents/tooling.md)")
    return exe


def sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        if not self.path.exists():
            raise DbError(f"database not found: {self.path}")

    def query(self, sql: str) -> list[dict]:
        proc = subprocess.run(
            [duckdb_binary(), "-readonly", "-json", "-c", sql, str(self.path)],
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            raise DbError(f"duckdb query failed on {self.path.name}: {proc.stderr.strip()}\nSQL: {sql}")
        out = proc.stdout.strip()
        if not out:
            return []
        return json.loads(out)

    def has_table(self, name: str) -> bool:
        rows = self.query(
            "SELECT 1 AS x FROM information_schema.tables "
            f"WHERE table_name = {sql_quote(name)} LIMIT 1"
        )
        return bool(rows)


def _default(env: str, rel: str, override: str | None) -> Path:
    if override:
        return Path(override)
    if os.environ.get(env):
        return Path(os.environ[env])
    return find_repo_root() / rel


def reference_db(override: str | None = None) -> Database:
    return Database(_default("FMGEN_REFERENCE_DB", "reference/fm_spec.duckdb", override))


def catalog_db(override: str | None = None) -> Database:
    return Database(_default("FMGEN_CATALOG_DB", "db/fm_catalog.duckdb", override))


class Reference:
    """Cached read access to fm_spec.duckdb (grammar + lookups)."""

    def __init__(self, db: Database):
        self.db = db

    @lru_cache(maxsize=1)
    def meta(self) -> dict:
        return {r["key"]: r["value"] for r in self.db.query("SELECT key, value FROM reference_meta")}

    @lru_cache(maxsize=1)
    def grammar_available(self) -> bool:
        return all(self.db.has_table(t) for t in ("step_options", "step_xml_map", "step_constraints"))

    @lru_cache(maxsize=1)
    def step_name_lookup(self) -> dict[str, dict]:
        """lookup_name (casefolded) -> {step_id, match_source} (primary matches win)."""
        rows = self.db.query(
            "SELECT lookup_name, step_id, match_source, is_primary "
            "FROM script_step_name_lookup ORDER BY is_primary"
        )
        table: dict[str, dict] = {}
        for r in rows:  # is_primary=1 rows come last and overwrite
            table[r["lookup_name"].casefold()] = {
                "step_id": r["step_id"], "match_source": r["match_source"],
            }
        return table

    @lru_cache(maxsize=1)
    def steps(self) -> dict[int, dict]:
        return {
            r["step_id"]: r
            for r in self.db.query(
                "SELECT step_id, canonical_name, url_slug, origin_version FROM script_steps"
            )
        }

    @lru_cache(maxsize=1)
    def legacy_step_ids(self) -> dict[int, dict]:
        if not self.db.has_table("script_step_legacy_ids"):
            return {}
        return {r["step_id"]: r for r in self.db.query("SELECT * FROM script_step_legacy_ids")}

    @lru_cache(maxsize=None)
    def options(self, step_id: int) -> list[dict]:
        return self.db.query(
            "SELECT option_key, option_type, required, display_location, display_label_en, "
            "true_text, false_text, omit_when_false, inverted_label, xml_path, sort_order "
            f"FROM step_options WHERE step_id = {int(step_id)} "
            "ORDER BY COALESCE(sort_order, 999), option_key"
        )

    @lru_cache(maxsize=1)
    def _option_values_have_evidence(self) -> bool:
        # per-value evidence exists only in newer reference builds
        rows = self.db.query(
            "SELECT 1 AS x FROM information_schema.columns "
            "WHERE table_name = 'step_option_values' AND column_name = 'evidence' LIMIT 1"
        )
        return bool(rows)

    @lru_cache(maxsize=None)
    def option_values(self, step_id: int) -> list[dict]:
        evidence = "evidence" if self._option_values_have_evidence() else "NULL AS evidence"
        return self.db.query(
            f"SELECT option_key, xml_value, display_text_en, {evidence} "
            f"FROM step_option_values WHERE step_id = {int(step_id)}"
        )

    @lru_cache(maxsize=None)
    def xml_map(self, step_id: int) -> dict | None:
        rows = self.db.query(
            "SELECT step_id, snippet_template, element_order, evidence, verified_version "
            f"FROM step_xml_map WHERE step_id = {int(step_id)}"
        )
        return rows[0] if rows else None

    @lru_cache(maxsize=1)
    def constraints(self) -> list[dict]:
        return self.db.query(
            "SELECT step_id, constraint_kind, detail, evidence FROM step_constraints"
        )

    @lru_cache(maxsize=1)
    def step_compat(self) -> dict[int, dict]:
        return {r["step_id"]: r for r in self.db.query("SELECT * FROM step_compat")}

    @lru_cache(maxsize=1)
    def ref_element_semantics(self) -> dict[str, dict]:
        return {
            r["element"]: r
            for r in self.db.query("SELECT element, resolution, catalog_table FROM ref_element_semantics")
        }

    @lru_cache(maxsize=1)
    def function_lookup(self) -> dict[str, dict]:
        """function token (casefolded) -> {function_id, match_source, chunk_role}."""
        rows = self.db.query(
            "SELECT lookup_name, function_id, match_source, chunk_role, is_primary "
            "FROM function_name_lookup WHERE chunk_role IN ('function','getfunction') "
            "ORDER BY is_primary"
        )
        return {
            r["lookup_name"].casefold(): {
                "function_id": r["function_id"], "match_source": r["match_source"],
                "chunk_role": r["chunk_role"],
            }
            for r in rows
        }

    @lru_cache(maxsize=1)
    def get_parameter_lookup(self) -> dict[str, str]:
        """localized Get-parameter token (casefolded) -> canonical EN name."""
        rows = self.db.query(
            "SELECT l.lookup_name, f.canonical_name FROM function_name_lookup l "
            "JOIN functions f USING (function_id) WHERE l.chunk_role = 'getparameter'"
        )
        return {r["lookup_name"].casefold(): r["canonical_name"] for r in rows}

    @lru_cache(maxsize=1)
    def function_arity(self) -> dict[int, dict]:
        """function_id -> {canonical_name, min_args, max_args (None = variadic)}."""
        rows = self.db.query(
            "SELECT f.function_id, f.canonical_name, "
            "COALESCE(SUM(CASE WHEN p.is_optional=0 AND p.is_variadic=0 THEN 1 ELSE 0 END),0) AS min_args, "
            "COUNT(p.position) AS n_params, "
            "COALESCE(MAX(p.is_variadic),0) AS variadic "
            "FROM functions f LEFT JOIN function_parameters p USING (function_id) "
            "GROUP BY f.function_id, f.canonical_name"
        )
        out = {}
        for r in rows:
            out[r["function_id"]] = {
                "canonical_name": r["canonical_name"],
                "min_args": int(r["min_args"]),
                "max_args": None if int(r["variadic"]) else int(r["n_params"]),
            }
        return out
