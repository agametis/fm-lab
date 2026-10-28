#!/usr/bin/env bash
# session_usage.sh — run metrics of the current Claude Code session for the report (B.7).
# DuckDB-only: resolves the transcript path and runs session_usage.sql with -markdown output.
#
# Usage:  bash .claude/skills/fm-deep-research/scripts/session_usage.sh --since <ISO> [--until <ISO>]
#              [--marks "R0=<ISO>,R1=<ISO>,…"] [--session <id>] [--file <transcript.jsonl>]
# Transcript: <session id>.jsonl (--session, else $CLAUDE_CODE_SESSION_ID) — first under the project
# folder derived from the cwd, then under every ~/.claude/projects/* folder (a shell standing in
# a subfolder encodes a different project name). A given session id that resolves nowhere is an
# error, never a silent switch to another file. Without any session id the newest transcript of
# the cwd project is used ONLY when it has records in the --since window, and the choice is
# printed (parallel sessions write their own transcripts — the newest may be a foreign one).
# Timestamps UTC ISO-8601 (`date -u +%FT%TZ`).
# Exit: 0 ok · 2 usage · 3 no duckdb · 4 transcript not found / not attributable
# bash-3.2 compatible.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SINCE=""; UNTIL=""; MARKS=""; SESSION=""; FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --since) shift; SINCE="${1:-}" ;;      --since=*) SINCE="${1#--since=}" ;;
    --until) shift; UNTIL="${1:-}" ;;      --until=*) UNTIL="${1#--until=}" ;;
    --marks) shift; MARKS="${1:-}" ;;      --marks=*) MARKS="${1#--marks=}" ;;
    --session) shift; SESSION="${1:-}" ;;  --session=*) SESSION="${1#--session=}" ;;
    --file) shift; FILE="${1:-}" ;;        --file=*) FILE="${1#--file=}" ;;
    *) echo "ERROR: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$SINCE" ] || { echo "usage: session_usage.sh --since <ISO> [--until <ISO>] [--marks …] [--session <id>] [--file <jsonl>]" >&2; exit 2; }
DUCKDB="$(bash "$SCRIPT_DIR/../../_shared/scripts/resolve_duckdb_bin.sh")"
[ -z "$DUCKDB" ] && { echo "ERROR: duckdb binary not found." >&2; exit 3; }
if [ -z "$FILE" ]; then
  ENCODED="$(pwd | sed 's/[^A-Za-z0-9]/-/g')"
  BASE="$HOME/.claude/projects/$ENCODED"
  SID="${SESSION:-${CLAUDE_CODE_SESSION_ID:-}}"
  if [ -n "$SID" ]; then
    if [ -f "$BASE/$SID.jsonl" ]; then
      FILE="$BASE/$SID.jsonl"
    else
      FILE="$(ls -t "$HOME"/.claude/projects/*/"$SID.jsonl" 2>/dev/null | head -n1)"
    fi
    [ -n "$FILE" ] || { echo "ERROR: no transcript for session $SID under ~/.claude/projects/ — pass --file <transcript.jsonl>." >&2; exit 4; }
  else
    FILE="$(ls -t "$BASE"/*.jsonl 2>/dev/null | head -n1)"
    [ -n "$FILE" ] || { echo "ERROR: no session id (CLAUDE_CODE_SESSION_ID / --session) and no transcript under $BASE — pass --file <transcript.jsonl>." >&2; exit 4; }
    N_IN_WINDOW="$("$DUCKDB" -noheader -list -c "SELECT count(*) FROM read_ndjson_objects('$FILE', ignore_errors = true) WHERE (json->>'timestamp')::TIMESTAMPTZ >= '$SINCE'::TIMESTAMPTZ;" 2>/dev/null)"
    case "$N_IN_WINDOW" in ''|*[!0-9]*) N_IN_WINDOW=0 ;; esac
    if [ "$N_IN_WINDOW" -eq 0 ]; then
      echo "ERROR: no session id, and the newest transcript ($(basename "$FILE")) has no records since $SINCE — it belongs to another session. Pass --session <id> or --file <transcript.jsonl>." >&2
      exit 4
    fi
    echo "NOTE: no session id — using the newest transcript $(basename "$FILE") ($N_IN_WINDOW records in the window); with parallel sessions this may be a foreign one." >&2
  fi
fi
[ -f "$FILE" ] || { echo "ERROR: transcript not found: $FILE" >&2; exit 4; }
UNTIL_SQL="NULL"; [ -n "$UNTIL" ] && UNTIL_SQL="'$UNTIL'"
"$DUCKDB" -markdown \
  -c "SET VARIABLE transcript = '$FILE'; SET VARIABLE since = '$SINCE'; SET VARIABLE until = $UNTIL_SQL; SET VARIABLE marks = '$MARKS';" \
  -c ".read $SCRIPT_DIR/session_usage.sql"
