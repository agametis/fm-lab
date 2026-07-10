# Codegen Registry — FileMaker Artifact Types → Preferred Skills

> Referenced from CLAUDE.md §6a and `codegen-workflows.md` A3. **Axis A only** —
> this registry governs FileMaker-code generation (artifacts that run in the target
> solution). fm-lab extensions (dashboards, queries, skills) are project-owned and
> need no registry.
>
> Semantics: a row here is an **explicit project decision** and beats heuristic
> skill discovery. No row for an artifact type = discover per protocol
> (`codegen-workflows.md` A2). Users and skills may edit this file; the curated
> fm-lab collection (phase 3) will announce itself by shipping rows here.
> When the user resolves a skill ambiguity in conversation, offer to persist the
> decision as a row.

## Skill mapping

| Artifact type | Preferred skill | Level | Notes |
|---|---|---|---|
| Custom function | — | — | No skill → fallback path (A4) |
| Schema (table/field) | — | — | No skill → fallback path (A4) |
| Layout / layout objects | — | — | Deliberately no skill (generation too unreliable without live feedback) → fallback path with explicit caveat |
| Value list | — | — | No skill → fallback path (A4) |

**Script (fmxmlsnippet) is intentionally not pinned here.** A script-generation
skill is *not* part of the public repo (not in `publish-manifest.json`
`include_skills`), so a hard row would dangle in every published setup. Left to the
discovery protocol instead (A2 Step 1): where a script-generating skill *is*
installed — a local/third-party skill, or the future curated collection — its
description (`…generates FileMaker scripts / fmxmlsnippet…`) is matched
automatically; where none is installed, the fallback path (A4) applies. Add an
explicit row only for a skill that also ships in `include_skills`.

## Target-solution conventions (artifact-internals language layer)

Consulted by every codegen path (skill or fallback) — see language policy
(`codegen-workflows.md` §L). Fill in what is known; anything left as `auto` is
derived from the catalog (existing script names, step texts, field comments) at
generation time.

| Convention | Value | Source |
|---|---|---|
| FM calc function-name locale | `de` (German function names) | existing convention of the current solution |
| Script/object naming language | `auto` | derive from ScriptCatalog naming |
| Comment language in generated scripts | `auto` | derive from existing script comments |
| MBS plugin in use | yes | PluginFunctionUsages non-empty |

## Maintenance

- One row per artifact type; keep notes to one line.
- Remove a row when its skill is uninstalled (a dangling row falls back to
  discovery with a warning, it does not fail).
- Maintenance checks should lint this file: referenced skills exist, no duplicate
  artifact types.
