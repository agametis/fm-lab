---
name: install-duckdb-docs
version: 0.9.0
description: Download and install DuckDB documentation from duckdb.org. Automatically checks for newer versions and prompts before replacing existing docs. Triggers (English): "install DuckDB docs", "update DuckDB documentation". Triggers (German): "installiere die DuckDB-Doku", "DuckDB-Dokumentation aktualisieren".
---

# DuckDB Documentation Installation Skill

## Relationship to the `duckdb-skills` plugin

The Docker image already ships the **`duckdb-skills` plugin**, whose `duckdb-docs`
skill provides *on-demand* full-text search over the DuckDB/DuckLake docs (a
self-refreshing local index at `~/.duckdb/docs/`). CLAUDE.md §7 already routes
agent SQL-syntax lookups there. **When the plugin is present, this skill's local
~15 MB Markdown mirror is redundant for agent lookups** — its only remaining
purpose is feeding the web frontend's *Docs card* (via `.fmlab/docs.json`).

The install script therefore detects the plugin (by probing the plugin tree for
the `duckdb-docs` SKILL.md — not by parsing `installed_plugins.json`, whose paths
are host-side and don't resolve in the container) and:
- `--check` reports an extra field `plugin_present` (bool).
- On install it prints a **warning** that the plugin already covers doc lookups;
  a fresh install then asks for confirmation, an update goes through the normal
  "Replace existing docs?" prompt. `--force` skips the gate entirely.

The install is **not** auto-skipped when the plugin is present — the Docs-card use
case still justifies the mirror if the user wants it.

## When to Use This Skill

Use this skill when you need to:
- Perform initial setup of DuckDB documentation
- Update to the latest DuckDB documentation
- Reinstall documentation after corruption or accidental deletion

The skill automates:
- Downloading the DuckDB documentation markdown file from duckdb.org
- Version checking to avoid unnecessary downloads
- Installation to the correct location
- User confirmation when replacing existing documentation

## Parameters

The skill accepts **optional parameters**:
- `--force` - Skip version check and user prompts, force reinstallation

Without parameters, the skill will:
- Check for existing documentation
- Compare versions and prompt if update is available
- Install directly if no existing documentation found

## Workflow

When invoked, the skill performs these steps:

1. **Check Existing Docs** - Verify if documentation already exists
2. **Version Check** - Compare local version with remote (via HTTP Last-Modified timestamp)
3. **User Prompt** - Ask for confirmation if newer version is available
4. **Download** - Fetch `duckdb-docs.md` from duckdb.org to `docs/duckdb/Documents/`
5. **Version Marker** - Store version information in `docs/duckdb/.version` for future comparisons
6. **Report** - Provide clear success or error message

## Available Tools

This skill uses a bundled script that handles all operations:
- **Installation Script**: `scripts/install_duckdb_docs.sh`
  - Downloads and installs DuckDB documentation
  - Usage: Execute with optional `--force` flag

## Working Process

### Step 1: Accept User Request
When the user asks to install or update DuckDB documentation, determine if force installation is needed.

### Step 2: Execute Installation Script
Run the automation script:
```bash
bash .claude/skills/install-duckdb-docs/scripts/install_duckdb_docs.sh
```

Or with force flag:
```bash
bash .claude/skills/install-duckdb-docs/scripts/install_duckdb_docs.sh --force
```

### Step 3: Handle User Prompts
If the script finds a newer version, it will prompt:
```
Newer version available.
Current: Sun, 12 Jan 2026 16:47:42 GMT
Remote:  Mon, 20 Jan 2026 10:15:30 GMT
Replace existing docs? (y/n):
```

Inform the user and let them decide.

### Step 4: Report Results
The script will output one of:
- `SUCCESS: DuckDB documentation installed successfully`
- `Docs are up to date (version: [timestamp])`
- `Installation cancelled by user`
- `ERROR: Download failed`
- `ERROR: Copy operation failed`

Report the result to the user with appropriate context.

## Error Handling

### Network Failures
If curl fails to download the file:
- Check internet connection
- Verify duckdb.org is accessible
- Try again later if server is temporarily unavailable

### Copy Operation Failed
If creating the target directory or writing the file fails:
- Check file permissions on `docs/` directory
- Verify available disk space
- Ensure no other process is using the documentation files

## Output Format

Provide concise feedback:

**Success (Fresh Installation):**
```
No existing docs found. Installing DuckDB documentation...
Downloading from https://blobs.duckdb.org/docs/duckdb-docs.md...
Download complete (15.2 MB)

SUCCESS: DuckDB documentation installed successfully
Version: Mon, 13 Jan 2026 10:15:30 GMT
Location: docs/duckdb/Documents/
Files: (15.2 MB, 120000 lines)
```

**Success (Already Up to Date):**
```
Checking for updates...
Docs are up to date (version: Mon, 13 Jan 2026 10:15:30 GMT)
No action needed.
```

**Success (Update):**
```
Checking for updates...
Newer version available.
Current: Sun, 12 Jan 2026 16:47:42 GMT
Remote:  Mon, 13 Jan 2026 10:15:30 GMT
Replace existing docs? (y/n): y
Downloading from https://blobs.duckdb.org/docs/duckdb-docs.md...
...
SUCCESS: DuckDB documentation updated successfully
```

**Failure:**
```
ERROR: [specific error message]
[suggestion for resolution]
```

## Notes

- No temporary files needed - downloads directly to target directory
- Original documentation is only replaced by successful download (curl overwrites atomically)
- The version marker file (`docs/duckdb/.version`) stores HTTP Last-Modified timestamp
- Multiple installations will overwrite the existing documentation
- The script is safe to run multiple times
- Documentation is a single Markdown file (~15 MB) containing the complete DuckDB docs
- After a successful install/update the script registers this source in `.fmlab/docs.json` via `tools/register_docs.py`, so the web home dashboard's Docs card can list it.
