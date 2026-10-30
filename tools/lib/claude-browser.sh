#!/usr/bin/env bash
# claude-browser.sh — $BROWSER for the Claude Code session that `tools/fmlab.sh up --claude`
# (or `agent`) opens inside the plain-Docker api container. Runs IN the container.
#
# Claude Code there has no way to reach the host browser, and its sign-in link wraps
# across terminal lines — terminals without OSC-52 clipboard support (macOS Terminal)
# cannot copy it intact. fmlab.sh sets BROWSER to this script for that session only and
# runs the host side of the open-bridge meanwhile; this script hands every URL to
# open_url.sh, which drops it into the bridge for the host to open.
#
# Sign-in URLs need one rewrite. Claude Code passes the variant whose redirect_uri is
# its local callback server (http://localhost:<random port>/callback) — a port inside
# the container the host browser cannot reach. The link Claude Code prints for manual
# sign-in is identical except for redirect_uri=https://platform.claude.com/oauth/code/
# callback: that page shows a code to paste back at the session's "Paste code here"
# prompt. This script opens that variant. A sign-in URL of any other shape is not
# forwarded (exit 1) — Claude Code still prints its manual link, as without the bridge.
#
# Silent on purpose: Claude Code shares the terminal, any output would corrupt its
# screen. Exit 0 = handed to the bridge, non-zero = not opened.

set -u

url="${1:-}"
[ -n "$url" ] || exit 2

LOCAL_CALLBACK='redirect_uri=http%3A%2F%2Flocalhost%3A[0-9]+%2Fcallback'
CODE_CALLBACK='redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback'

case "$url" in
    https://claude.com/cai/oauth/authorize\?*|https://platform.claude.com/oauth/authorize\?*)
        url="$(printf '%s' "$url" | sed -E "s#${LOCAL_CALLBACK}#${CODE_CALLBACK}#")"
        case "$url" in *"$CODE_CALLBACK"*) ;; *) exit 1 ;; esac
        ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
# open_url.sh tries $BROWSER first — unset it, or it would call this script again.
env -u BROWSER bash "$script_dir/../../.claude/skills/_shared/scripts/open_url.sh" "$url" >/dev/null 2>&1
