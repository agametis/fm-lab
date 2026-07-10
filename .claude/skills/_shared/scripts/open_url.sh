#!/usr/bin/env bash
# Shared URL opener for fm-open / fm-show.
# Opens any URL (http/https/fmp) on the user's desktop and reports the mechanism
# used on stdout. Priority chain:
#   1. $BROWSER          — VS Code dev-container helper: opens on the HOST via IPC
#                          (handles fmp:// too, auto-forwards localhost ports)
#   2. open              — macOS
#   3. xdg-open / sensible-browser — desktop Linux (skipped headless: no $DISPLAY)
#   4. start             — Windows (Git Bash / MSYS)
#   5. host open-bridge  — plain Docker: drop a request file into
#                          .fmlab/open-requests/, picked up by the host watcher
#                          (`bash tools/fmlab.sh open-bridge`, auto-started by
#                          `fmlab.sh up --claude` / `agent`). Used only while its
#                          heartbeat file is fresh (< 30 s); the URL is printed
#                          as a fallback link anyway.
#   6. none              — print the URL for manual opening, exit 3
#
# Usage: open_url.sh <url>
# Exit codes: 0 = opened/handed to bridge, 2 = usage error,
#             3 = no open mechanism (URL printed).
# Pass the URL as a single double-quoted argument; fmIDE parameters contain `$`
# and literal quoting inside this script keeps them intact.

set -u

url="${1:-}"
if [ -z "$url" ]; then
  echo "usage: open_url.sh <url>" >&2
  exit 2
fi

# 1 — VS Code dev-container helper (only mechanism available inside the container)
if [ -n "${BROWSER:-}" ] && [ -e "$BROWSER" ]; then
  if "$BROWSER" "$url" >/dev/null 2>&1; then
    echo "opened via \$BROWSER (VS Code host helper)"
    exit 0
  fi
fi

case "$(uname -s)" in
  Darwin)
    if command -v open >/dev/null 2>&1 && open "$url" >/dev/null 2>&1; then
      echo "opened via open (macOS)"
      exit 0
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    if start "" "$url" >/dev/null 2>&1; then
      echo "opened via start (Windows)"
      exit 0
    fi
    ;;
  Linux)
    # Desktop only — headless (no display) these openers would hang on a
    # text-mode browser or fail pointlessly; fall through to the bridge.
    if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
      for cmd in xdg-open sensible-browser; do
        if command -v "$cmd" >/dev/null 2>&1 && "$cmd" "$url" >/dev/null 2>&1; then
          echo "opened via $cmd (Linux)"
          exit 0
        fi
      done
    fi
    ;;
esac

# 5 — host open-bridge (plain Docker; see header). Heartbeat < 30 s = watcher live.
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
bridge_dir="${FMLAB_OPEN_BRIDGE_DIR:-$repo_root/.fmlab/open-requests}"
heartbeat="$bridge_dir/.bridge-alive"
if [ -f "$heartbeat" ]; then
  now="$(date +%s)"
  hb_mtime="$(stat -c %Y "$heartbeat" 2>/dev/null || stat -f %m "$heartbeat" 2>/dev/null || echo 0)"
  if [ $(( now - hb_mtime )) -lt 30 ]; then
    request="$bridge_dir/open-$$-$now.url"
    printf '%s\n' "$url" > "$request.tmp" && mv "$request.tmp" "$request"
    echo "sent to host open-bridge — fallback link:"
    echo "$url"
    exit 0
  fi
fi

# 6 — no mechanism: hand the URL back for manual opening
echo "no open mechanism available — open manually:"
echo "$url"
exit 3
