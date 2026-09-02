If you have trouble with the technical setup, please refer to the following known issues.

- [Permission prompts for duckdb](#too-many-permission-prompts-for-duckdb)
- [Another conversion is already running](#another-conversion-is-already-running)
- [Import re-reads everything after an extension update](#import-re-reads-everything-after-an-extension-update)
- [IMPORT ABORTED — build incomplete](#import-aborted-build-incomplete)


---
### Too many permission prompts for `duckdb`?
The bundled settings pre-approve DuckDB queries (`duckdb …`, and the standard binary locations `/usr/local/bin/duckdb` / `/opt/homebrew/bin/duckdb`). 

Two things make prompts reappear:

- **DuckDB not on `PATH`.** The allow-rule matches the command's first token, so the agent must be able to call the bare `duckdb …` form. In the container this is guaranteed; for a native setup `bash tools/init.sh` resolves the binary and writes its directory into `.claude/settings.json → env.PATH` — re-run it if the entry is missing (don't just add narrower `duckdb … -c:*` rules; they won't help).

- **Workspace not trusted.** If you see `Ignoring … permissions.allow entry … this workspace has not been trusted`, Claude Code ignores **all** allow-rules until you accept the trust dialog **once** (open the folder interactively and confirm). After that the pre-approvals take effect.

---
### Another conversion is already running

The CLI converter and the web import button share a single lock — only one conversion can run per workspace. A second caller fails fast instead of queueing: the CLI exits with code `7`, the REST API answers `409 ALREADY_RUNNING`. Wait for the running import to finish (its progress is visible in the web import log) and retry.

---
### Import re-reads everything after an extension update

After a webbed/DuckDB update the converter may switch its parser policy (DOM ↔ SAX streaming, see [Katana engine](katana-engine.md#dom-vs-sax)). The stored content hashes are policy-stamped, so the first import after such a switch re-reads the affected catalogs once instead of skipping them — expect a single longer run, not a permanent slowdown. Subsequent imports skip unchanged content as usual.

---
### IMPORT ABORTED — build incomplete

A failure in the resolve phase (Phase 2) aborts the import before anything is published: no catalogs from that run are written and the previously served database stays unchanged. The log names the cause — fix it and re-run; if the workspace state looks inconsistent, `--batch --force-rebuild` rebuilds the catalog from scratch.

