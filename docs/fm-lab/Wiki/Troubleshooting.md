If you have trouble with the technical setup, please refer to the following known issues.

- [Permission prompts for duckdb](#too-many-permission-prompts-for-duckdb)


---
### Too many permission prompts for `duckdb`?
The bundled settings pre-approve DuckDB queries (`duckdb …`, and the standard binary locations `/usr/local/bin/duckdb` / `/opt/homebrew/bin/duckdb`). 

Two things make prompts reappear:

- **DuckDB not on `PATH`.** The allow-rule matches the command's first token, so the agent must be able to call the bare `duckdb …` form. In the container this is guaranteed; for a native setup `bash tools/init.sh` resolves the binary and writes its directory into `.claude/settings.json → env.PATH` — re-run it if the entry is missing (don't just add narrower `duckdb … -c:*` rules; they won't help).

- **Workspace not trusted.** If you see `Ignoring … permissions.allow entry … this workspace has not been trusted`, Claude Code ignores **all** allow-rules until you accept the trust dialog **once** (open the folder interactively and confirm). After that the pre-approvals take effect.

