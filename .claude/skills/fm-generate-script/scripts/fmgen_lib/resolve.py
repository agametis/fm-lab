"""P4 reference resolution against the fm-lab object catalog (fm_catalog.duckdb).

Every object reference in the IR is resolved to a real ID (+UUID where the
catalog has one) and recorded in a machine-readable resolution report:

  resolved     — real IDs found; emitted into the snippet
  unresolved   — name not in the catalog; severity 'error' stops the pipeline
  new_objects  — {{NEW:...}} placeholders; emitted name-only, to create before paste
  assumptions  — target file, FM version, fallback modes

Resolution modes come from fm_spec.ref_element_semantics:
  by-id / by-name-fallback — resolve to real IDs; name-only fallback ONLY when
  the target file is not in the catalog (concept P4, explicitly reported)
  by-id-strict — name fallback forbidden (e.g. PrivilegeSet)
  by-name / by-name-only — no catalog IDs (Window, CustomFunction, Plugin)

All catalog joins are File_Name-scoped: FileMaker numeric IDs are only unique
per file (see memory: layout-id-not-globally-unique).
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

from .db import Database, Reference, sql_quote
from .textform import ParsedStep, render_ref, strip_strings

# option xml_path leaf -> ref_element_semantics.element
_XMLPATH_ELEMENT = {
    "Field": "Field", "Layout": "Layout", "Script": "Script",
    "ValueList": "ValueList", "Table": "Table", "FileReference": "DataSource",
    "Window": "Window", "Object": "Object", "PrivilegeSet": "PrivilegeSet",
    "CustomMenuSet": "CustomMenuSet",
}


@dataclass
class Report:
    target_file: str | None = None
    resolved: list[dict] = field(default_factory=list)
    unresolved: list[dict] = field(default_factory=list)
    new_objects: list[dict] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return any(u.get("severity") == "error" for u in self.unresolved)

    def as_dict(self) -> dict:
        return {
            "target_file": self.target_file,
            "resolved": self.resolved,
            "unresolved": self.unresolved,
            "new_objects": self.new_objects,
            "assumptions": self.assumptions,
            "warnings": self.warnings,
        }


class Resolver:
    def __init__(self, catalog: Database, ref: Reference, target_file: str):
        self.cat = catalog
        self.ref = ref
        self.file = target_file
        self.report = Report(target_file=target_file)
        self.file_row = self._load_file()

    # ------------------------------------------------------------ file context

    def _load_file(self) -> dict | None:
        rows = self.cat.query(
            "SELECT File_Name, FileMaker_Version, Has_DDR_INFO FROM FilesCatalog "
            f"WHERE File_Name = {sql_quote(self.file)}")
        if rows:
            self.report.assumptions.append(
                f"target file '{rows[0]['File_Name']}' per FilesCatalog, "
                f"FM {rows[0]['FileMaker_Version']}")
            return rows[0]
        names = [r["File_Name"] for r in self.cat.query("SELECT File_Name FROM FilesCatalog")]
        close = difflib.get_close_matches(self.file, names, n=3, cutoff=0.5)
        self.report.warnings.append(
            f"target file '{self.file}' not in FilesCatalog"
            + (f" (close: {', '.join(close)})" if close else "")
            + " — all references fall back to name-only placeholders (id=1)")
        return None

    # ------------------------------------------------------------ entry point

    def resolve(self, parsed: list[ParsedStep]) -> None:
        for ps in parsed:
            for opt in self.ref.options(ps.step_id):
                key = opt["option_key"]
                if key not in ps.options:
                    continue
                if opt["option_type"] in ("object_ref", "target"):
                    element = _XMLPATH_ELEMENT.get(
                        (opt["xml_path"] or "").split("/")[0].split("[")[0])
                    if element:
                        self._resolve_ref(ps, key, element)
            self._mark_calc_repetition(ps)
            for calc in self._calcs(ps):
                self._scan_calc(ps, calc)

    def _mark_calc_repetition(self, ps: ParsedStep) -> None:
        """Byte-true calc-repetition form (native FileMaker convention): when a
        step carries a top-level Repetition/Calculation value, its top-level
        Field target must expose the marker attribute repetition="0" (the
        attribute and the <Repetition> element co-occur only for a *calculated*
        repetition). A literal repetition already carried by the field ref
        (TO::Field[2]) is left untouched — that is the attribute-only form."""
        xmap = self.ref.xml_map(ps.step_id)
        # only steps whose Field actually emits an optional repetition attribute
        # can carry the marker; skip the rest so nothing leaks into their refs
        if not xmap or 'repetition="{' not in (xmap.get("snippet_template") or ""):
            return
        opts = self.ref.options(ps.step_id)
        if not any(o["option_type"] == "repetition"
                   and o["xml_path"] == "Repetition/Calculation"
                   and o["option_key"] in ps.options for o in opts):
            return
        for o in opts:
            if o["option_type"] in ("object_ref", "target") and o["xml_path"] == "Field":
                ref_val = ps.options.get(o["option_key"])
                if (isinstance(ref_val, dict) and ref_val.get("_form") != "variable"
                        and not ref_val.get("repetition")):
                    ref_val["repetition"] = "0"
                return

    def _calcs(self, ps: ParsedStep) -> list[str]:
        out = []
        for o in self.ref.options(ps.step_id):
            if o["option_type"] in ("calculation", "repetition"):
                v = ps.options.get(o["option_key"])
                if isinstance(v, str):
                    out.append(v)
        return out

    # ------------------------------------------------------ object references

    def _resolve_ref(self, ps: ParsedStep, key: str, element: str) -> None:
        ref_val = ps.options[key]
        if not isinstance(ref_val, dict):
            return
        if ref_val.get("_form") == "variable":
            # Script-local variable: it has no catalog identity, so it is
            # neither resolved nor unresolved — leave it for the emitter to
            # write out verbatim.
            return
        semantics = self.ref.ref_element_semantics().get(element, {})
        mode = semantics.get("resolution", "by-name")

        if ref_val.get("new"):
            self.report.new_objects.append({
                "type": ref_val.get("new_type", element), "ref": render_ref(ref_val),
                "action": "create before paste", "line": ps.line,
            })
            ref_val["id"] = 1
            return
        if mode in ("by-name", "by-name-only"):
            return  # literal name, no catalog IDs (Window, Object, ...)
        if self.file_row is None:
            if mode == "by-id-strict":
                self._unresolved(ps, element, ref_val, "error",
                                 f"{element} resolves by id in FileMaker — "
                                 "name fallback is not allowed and the target file "
                                 "is not in the catalog")
            else:
                ref_val["id"] = 1
                ref_val["fallback"] = "by-name"
            return

        handler = {
            "Field": self._field, "Layout": self._layout, "Script": self._script,
            "ValueList": self._valuelist, "Table": self._table,
            "DataSource": self._datasource, "PrivilegeSet": self._privilegeset,
        }.get(element)
        if handler is None:
            return
        handler(ps, ref_val)

    def _hit(self, ps: ParsedStep, element: str, ref_val: dict, row: dict) -> None:
        entry = {"type": element, "ref": render_ref(ref_val), "line": ps.line}
        entry.update({k: v for k, v in row.items() if v is not None})
        self.report.resolved.append(entry)
        ref_val["id"] = row["id"]
        if "table" in row:
            ref_val["table"] = row["table"]
        if "name" in row:
            ref_val["name"] = row["name"]

    def _unresolved(self, ps: ParsedStep, element: str, ref_val: dict,
                    severity: str, msg: str, suggestion: str | None = None) -> None:
        self.report.unresolved.append({
            "type": element, "ref": render_ref(ref_val), "line": ps.line,
            "severity": severity, "message": msg,
            **({"suggestion": suggestion} if suggestion else {}),
        })

    def _suggest(self, name: str, candidates: list[str]) -> str | None:
        close = difflib.get_close_matches(name, candidates, n=1, cutoff=0.6)
        return close[0] if close else None

    def _field(self, ps: ParsedStep, ref_val: dict) -> None:
        to_name, f_name = ref_val.get("table"), ref_val.get("name")
        if not to_name:
            self._unresolved(ps, "Field", ref_val, "error",
                             "field reference without table occurrence")
            return
        tos = self.cat.query(
            "SELECT TO_Name, BT_Name, DS_Name FROM TableOccurrenceCatalog "
            f"WHERE TO_Name = {sql_quote(to_name)} AND File_Name = {sql_quote(self.file)}")
        if not tos:
            cands = [r["TO_Name"] for r in self.cat.query(
                f"SELECT TO_Name FROM TableOccurrenceCatalog WHERE File_Name = {sql_quote(self.file)}")]
            self._unresolved(ps, "Field", ref_val, "error",
                             f"table occurrence '{to_name}' not in '{self.file}'",
                             self._suggest(to_name, cands))
            return
        to = tos[0]
        field_file = self.file
        if to["DS_Name"]:  # external TO: base table lives in the data-source file
            field_file = to["DS_Name"]
        rows = self.cat.query(
            "SELECT Field_ID, Field_Name, Field_UUID FROM FieldsForTables "
            f"WHERE Table_Name = {sql_quote(to['BT_Name'])} "
            f"AND Field_Name = {sql_quote(f_name)} AND File_Name = {sql_quote(field_file)}")
        if not rows:
            cands = [r["Field_Name"] for r in self.cat.query(
                "SELECT Field_Name FROM FieldsForTables "
                f"WHERE Table_Name = {sql_quote(to['BT_Name'])} AND File_Name = {sql_quote(field_file)}")]
            sug = self._suggest(f_name, cands)
            self._unresolved(ps, "Field", ref_val, "error",
                             f"field '{f_name}' not in base table '{to['BT_Name']}'"
                             + (f" (file '{field_file}')" if field_file != self.file else ""),
                             f"{to_name}::{sug}" if sug else None)
            return
        self._hit(ps, "Field", ref_val, {
            "id": rows[0]["Field_ID"], "name": rows[0]["Field_Name"],
            "table": to_name, "uuid": rows[0]["Field_UUID"], "file": field_file,
        })

    def _layout(self, ps: ParsedStep, ref_val: dict) -> None:
        rows = self.cat.query(
            "SELECT L_ID, L_Name, L_UUID, L_TO_Name FROM Layouts "
            f"WHERE L_Name = {sql_quote(ref_val.get('name'))} AND File_Name = {sql_quote(self.file)}")
        if not rows:
            cands = [r["L_Name"] for r in self.cat.query(
                f"SELECT L_Name FROM Layouts WHERE File_Name = {sql_quote(self.file)}")]
            self._unresolved(ps, "Layout", ref_val, "error",
                             f"layout '{ref_val.get('name')}' not in '{self.file}'",
                             self._suggest(ref_val.get("name") or "", cands))
            return
        row = rows[0]
        if ref_val.get("table") and row["L_TO_Name"] and ref_val["table"] != row["L_TO_Name"]:
            self.report.warnings.append(
                f"line {ps.line}: layout '{row['L_Name']}' is based on TO "
                f"'{row['L_TO_Name']}', draft says '{ref_val['table']}' — using catalog value")
            ref_val["table"] = row["L_TO_Name"]
        self._hit(ps, "Layout", ref_val, {
            "id": row["L_ID"], "name": row["L_Name"], "uuid": row["L_UUID"],
            "file": self.file,
        })

    def _script(self, ps: ParsedStep, ref_val: dict) -> None:
        rows = self.cat.query(
            "SELECT Script_ID, Script_Name, Script_UUID FROM ScriptCatalog "
            f"WHERE Script_Name = {sql_quote(ref_val.get('name'))} "
            f"AND File_Name = {sql_quote(self.file)} AND NOT Is_Separator")
        if not rows:
            cands = [r["Script_Name"] for r in self.cat.query(
                f"SELECT Script_Name FROM ScriptCatalog WHERE File_Name = {sql_quote(self.file)}")]
            self._unresolved(ps, "Script", ref_val, "error",
                             f"script '{ref_val.get('name')}' not in '{self.file}'",
                             self._suggest(ref_val.get("name") or "", cands))
            return
        self._hit(ps, "Script", ref_val, {
            "id": rows[0]["Script_ID"], "name": rows[0]["Script_Name"],
            "uuid": rows[0]["Script_UUID"], "file": self.file,
        })

    def _valuelist(self, ps: ParsedStep, ref_val: dict) -> None:
        rows = self.cat.query(
            "SELECT VL_ID, VL_Name, VL_UUID FROM ValueListCatalog "
            f"WHERE VL_Name = {sql_quote(ref_val.get('name'))} AND File_Name = {sql_quote(self.file)}")
        if not rows:
            cands = [r["VL_Name"] for r in self.cat.query(
                f"SELECT VL_Name FROM ValueListCatalog WHERE File_Name = {sql_quote(self.file)}")]
            self._unresolved(ps, "ValueList", ref_val, "error",
                             f"value list '{ref_val.get('name')}' not in '{self.file}'",
                             self._suggest(ref_val.get("name") or "", cands))
            return
        self._hit(ps, "ValueList", ref_val, {
            "id": rows[0]["VL_ID"], "name": rows[0]["VL_Name"],
            "uuid": rows[0]["VL_UUID"], "file": self.file,
        })

    def _table(self, ps: ParsedStep, ref_val: dict) -> None:
        name = ref_val.get("table") or ref_val.get("name")
        rows = self.cat.query(
            "SELECT TO_ID, TO_Name, TO_UUID FROM TableOccurrenceCatalog "
            f"WHERE TO_Name = {sql_quote(name)} AND File_Name = {sql_quote(self.file)}")
        if not rows:
            self._unresolved(ps, "Table", ref_val, "error",
                             f"table occurrence '{name}' not in '{self.file}'")
            return
        self._hit(ps, "Table", ref_val, {
            "id": rows[0]["TO_ID"], "name": rows[0]["TO_Name"],
            "uuid": rows[0]["TO_UUID"], "file": self.file,
        })

    def _datasource(self, ps: ParsedStep, ref_val: dict) -> None:
        name = ref_val.get("name")
        rows = self.cat.query(
            f"SELECT File_Name FROM FilesCatalog WHERE File_Name = {sql_quote(name)}")
        if not rows:
            self.report.warnings.append(
                f"line {ps.line}: data source '{name}' not in FilesCatalog — "
                "cannot verify (external file may be intentional)")
            return
        self.report.resolved.append({"type": "DataSource", "ref": name, "line": ps.line})

    def _privilegeset(self, ps: ParsedStep, ref_val: dict) -> None:
        rows = self.cat.query(
            "SELECT PrivilegeSet_ID AS PS_ID, PrivilegeSet_Name AS PS_Name "
            "FROM PrivilegeSetsCatalog "
            f"WHERE PrivilegeSet_Name = {sql_quote(ref_val.get('name'))} "
            f"AND File_Name = {sql_quote(self.file)}")
        if not rows:
            self._unresolved(ps, "PrivilegeSet", ref_val, "error",
                             f"privilege set '{ref_val.get('name')}' not in '{self.file}' — "
                             "FileMaker resolves privilege sets by id, name fallback is invalid")
            return
        self._hit(ps, "PrivilegeSet", ref_val, {
            "id": rows[0]["PS_ID"], "name": rows[0]["PS_Name"], "file": self.file,
        })

    # ------------------------------------------------- calc content verification

    _MBS_RE = re.compile(r'MBS\s*\(\s*"([^"]+)"', re.I)
    _IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*")

    def _scan_calc(self, ps: ParsedStep, calc: str) -> None:
        if self.file_row is None:
            return
        # MBS/plugin functions: verify the registered plugin function exists
        for m in self._MBS_RE.finditer(calc):
            fn = m.group(1)
            # MBS treats function names case-insensitively; match the same way so
            # a spelling like Text.ReplaceNewline resolves against Text.ReplaceNewLine.
            rows = self.cat.query(
                "SELECT Object_Name FROM ObjectCatalog WHERE Object_Type = 'PluginFunction' "
                f"AND (lower(Object_Name) = lower({sql_quote(fn)}) "
                f"OR lower(Object_Name) LIKE lower({sql_quote('%::' + fn)})) "
                "LIMIT 1")
            if rows:
                self.report.resolved.append(
                    {"type": "PluginFunction", "ref": f"MBS(\"{fn}\")", "line": ps.line})
            else:
                self._unresolved(ps, "PluginFunction",
                                 {"name": fn, "_form": "named"}, "warning",
                                 f"MBS function '{fn}' not seen anywhere in the catalog — "
                                 "verify the name via mbs-function-reference")
        # custom functions: bare-name scan against the target file's CF catalog
        cf_rows = self.cat.query(
            f"SELECT CF_Name FROM CustomFunctionsCatalog WHERE File_Name = {sql_quote(self.file)}")
        cf_names = {r["CF_Name"] for r in cf_rows}
        if not cf_names:
            return
        flookup = self.ref.function_lookup()
        seen = set()
        for m in self._IDENT_RE.finditer(strip_strings(calc)):
            tok = m.group(0)
            if tok in seen or tok.casefold() in flookup:
                continue
            seen.add(tok)
            if tok in cf_names:
                self.report.resolved.append(
                    {"type": "CustomFunction", "ref": tok, "line": ps.line, "file": self.file})


def resolve(parsed: list[ParsedStep], catalog: Database, ref: Reference,
            target_file: str) -> Report:
    r = Resolver(catalog, ref, target_file)
    r.resolve(parsed)
    return r.report
