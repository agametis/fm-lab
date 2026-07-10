# Tooling — Commands, Servers, Documentation Install

> Referenced from CLAUDE.md §9. Environment helpers: DuckDB binary resolution,
> server lifecycle, documentation mirrors and auxiliary installs.

## DuckDB binary — locating the executable

In the standard setup (the Docker container, or a native install with DuckDB on `PATH`),
just call DuckDB as a plain `duckdb …` command. `which duckdb` succeeds there, so no
path probing is needed.

**Keep every DuckDB call a single, plain command.** Do **not** wrap it in a subshell
`( … )`, chain it with `&&`/`||` to probe for the binary, or assign the path to a variable
and call `$DB …`. The project's permission allow-list matches the command **prefix**
(`duckdb …` / `/usr/local/bin/duckdb …`), so any such indirection defeats the match and
makes Claude Code prompt for approval on every single query.

Only if `which duckdb` actually fails (some native setups do not inherit the user's shell
PATH) resolve the path **once** by checking these well-known locations in order:

```bash
which duckdb                              # 1. PATH (the standard case)
~/.duckdb/cli/latest/duckdb --version    # 2. Bash installer
/opt/homebrew/bin/duckdb --version       # 3. Homebrew (Apple Silicon)
/usr/local/bin/duckdb --version          # 4. Homebrew (Intel Mac)
```

Then call that absolute path **directly** as a plain command — still no subshell, no `$DB`
variable — e.g. `~/.duckdb/cli/latest/duckdb db/fm_catalog.duckdb -c "..."`.

**Important:** never try to install DuckDB yourself. If it cannot be found in any of the
locations above, point the user to the installation instructions.

## Servers (REST API & web frontend)

| Skill | Effect |
|---|---|
| `rest-api-start` | Starts the REST API server in the background on port 3003 |
| `rest-api-stop` | Stops the API server (and the frontend dev server if running) |
| `rest-frontend-start` | Starts the Vite frontend dev server on port 5173 |
| `rest-frontend-stop` | Stops the frontend dev server |

The API server reads its own DB copy (`rest-api/db/fm_catalog.duckdb`, READ_ONLY) —
it never blocks the master DB.

## Documentation mirrors (install/update skills)

| Skill | Installs |
|---|---|
| `install-claris-docs` | Claris FileMaker online help mirror → `docs/claris-help/` (11 languages, EN always included) + reference index `fm_reference.duckdb` |
| `install-mbs-docs` | MBS plugin documentation |
| `install-duckdb-docs` | DuckDB documentation (used by `duckdb-skills:duckdb-docs`) |
| `install-fmide-docs` | fmIDE documentation (GitHub wiki) |

All installers check versions and prompt before replacing existing sets.

## Test data & auxiliary tools

| Skill | Purpose |
|---|---|
| `install-ooe-fm` | "One Of Everything" FileMaker reference repo (XML test cases) |
| `install-fm-xml-export-exploder` | Tool for splitting XML exports into components |
| `test-convert-xml` | Conversion test run: `xml-test/` → `db/fm_test.duckdb` (production DB untouched; auto-provisions ooe-fm data) |

## Misc

- `fm-open` — open the currently discussed object in FileMaker via fmIDE fmp:// URL
- `fm-show` — open the currently discussed object in the FM-Lab web frontend (detail / references / graph)
- ⚠️ Dev-container filesystem is **case-insensitive**: `CLAUDE.md` and `claude.md` are the same file — modify only via Edit/Write tools, never via `cp`/`rm` between case variants.
