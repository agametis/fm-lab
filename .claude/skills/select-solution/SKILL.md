---
name: select-solution
version: 0.9.0
description: >
  Switches the active fm-lab solution (the workspace default: pointer file +
  db/ symlinks + running API) via tools/solution.sh. Use when the user wants to
  change, switch or activate a solution — with an id given, a near-miss typo to
  confirm, or no argument at all (then list and pick). Not for session-only pins
  (FMLAB_SOLUTION) nor for creating solutions (solution.sh create). Triggers
  (English): "/select-solution", "switch solution", "activate solution X",
  "change the active solution", "which solution should be active". Triggers
  (German): "/select-solution", "wechsle die Lösung", "aktiviere Lösung X",
  "Lösung umschalten", "welche Lösung soll aktiv sein". Triggers (Spanish):
  "cambia la solución", "activa la solución X", "cambiar la solución activa".
  Triggers (French): "change de solution", "active la solution X", "changer la
  solution active". Triggers (Italian): "cambia la soluzione", "attiva la
  soluzione X", "cambiare la soluzione attiva". Triggers (Dutch): "wissel de
  oplossing", "activeer oplossing X", "verander de actieve oplossing". Triggers
  (Portuguese): "trocar a solução", "ativar a solução X", "mudar a solução
  ativa". Triggers (Swedish): "byt lösning", "aktivera lösning X", "ändra aktiv
  lösning". Triggers (Japanese): "ソリューションを切り替えて",
  "ソリューションXを有効化", "アクティブなソリューションを変更". Triggers
  (Korean): "솔루션 전환", "솔루션 X 활성화", "활성 솔루션 변경". Triggers
  (Chinese): "切换解决方案", "激活解决方案 X", "更改活动解决方案".
---

# select-solution — Switch the active fm-lab solution

## Purpose

Switch the **workspace-default** solution with `tools/solution.sh use <id>`. The
argument is optional: resolve an exact id directly, confirm a near-miss typo, or —
with no usable argument — list all solutions and let the user pick. For a
session-only switch use the `FMLAB_SOLUTION` env pin instead (see Output); to
create a new empty solution use `solution.sh create`, not this skill.

Respond in the user's language; keep solution ids verbatim.

## Prerequisites

- `tools/solution.sh` (always present in the workspace). It resolves the repo root
  and the solutions bundles itself — no extra setup.
- A running REST API is **not** required: `use` fires `/api/admin/reload` best-effort
  and reports whether a server picked the switch up.

## Arguments & Modes

| Argument          | Effect                            | Default                 |
| ----------------- | --------------------------------- | ----------------------- |
| `<id>` (optional) | Candidate solution id to activate | none → interactive list |

## Flow

1. **List the solutions first** — the authoritative set of valid ids. The active
   one is marked with `*`:

   ```bash
   tools/solution.sh list
   ```

2. **Branch on the argument:**
   - **Exact match** — the argument equals an id in the list:
     - Already active (`*`) → say so and stop; no switch needed.
     - Otherwise → activate it (step 3).
   - **Near match** — no exact id, but one id/name is clearly similar (typo, case,
     substring; e.g. `acmestore` → `acme`, `ACME` → `acme`): ask the user to confirm
     — _"Did you mean `<id>`? Activate it?"_ — and only then do step 3. If several
     ids are similarly close, list just those candidates and let the user pick.
   - **No / unrecognisable argument** — present a **numbered** list of the solutions
     (number · id · name · last import) and ask which to activate. Accept either the
     id or the row number as the answer, then do step 3.

3. **Activate** the chosen id:

   ```bash
   tools/solution.sh use <id>
   ```

   Relay the script's confirmation verbatim.

## Output

- On success `use` prints `Active solution: <id> (...)` with the API-reload status,
  the scope line (workspace-wide default), and the `export FMLAB_SOLUTION=<id>` hint
  for a session-only pin. Surface that hint when the user wanted only a temporary,
  session-local switch rather than moving the shared default.
- When the current shell is session-pinned (`FMLAB_SOLUTION`/`FMLAB_CONTEXT`), the
  script adds a note that the pin — not this switch — still governs that session;
  pass it on.

## Errors

| Symptom                              | Cause                 | Reaction                                                        |
| ------------------------------------ | --------------------- | --------------------------------------------------------------- |
| `ERROR: invalid solution id '<x>'`   | Malformed id passed   | Never invent ids; only pass one from the list. Re-run the flow. |
| `ERROR: unknown solution '<x>'`      | No such bundle        | Fall back to the near-match / list branch and ask the user.     |
| Argument is empty or matches nothing | No usable id          | List branch: numbered list + ask (step 2, case 3).              |
| Argument already active              | Chosen id carries `*` | Report "already active", do not switch.                         |
