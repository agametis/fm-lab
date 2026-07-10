#!/usr/bin/env bash
# claude-auth-preflight.sh — report Claude Code auth status at container start.
#
# The agent stack's ONLY manual step is providing credentials. This surfaces the auth
# state at startup (in the `docker compose up` / VS Code postStart log) with the exact
# next command — instead of the user only finding out at the first interactive `claude`.
#
# Detection order: CLAUDE_CODE_OAUTH_TOKEN (subscription token) → ANTHROPIC_API_KEY
# (API-key billing) → a saved interactive login in CLAUDE_CONFIG_DIR. Both env vars are
# passed through by the compose overlay only when set on the host / in a root .env.
#
# NEVER fails the boot: every check is guarded and the script always exits 0.

CONFIG_DIR="${CLAUDE_CONFIG_DIR:-/home/node/.claude}"
CREDS_FILE="$CONFIG_DIR/.credentials.json"

# Colours only on a TTY.
if [ -t 1 ]; then B='\033[1m'; G='\033[0;32m'; Y='\033[1;33m'; NC='\033[0m'; else B=''; G=''; Y=''; NC=''; fi
rule() { printf '%b\n' "────────────────────────────────────────"; }

printf '\n'
rule
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  printf '%b\n' "${G}🤖 Claude Code ready${NC} — subscription token found (CLAUDE_CODE_OAUTH_TOKEN)."
  printf '%b\n' "   Start the agent:  ${B}docker compose exec -it api claude${NC}"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  printf '%b\n' "${G}🤖 Claude Code ready${NC} — API key found (ANTHROPIC_API_KEY, API-key billing)."
  printf '%b\n' "   Start the agent:  ${B}docker compose exec -it api claude${NC}"
elif [ -s "$CREDS_FILE" ]; then
  printf '%b\n' "${G}🤖 Claude Code ready${NC} — saved login found (persisted from a previous sign-in)."
  printf '%b\n' "   Start the agent:  ${B}docker compose exec -it api claude${NC}"
else
  printf '%b\n' "${Y}🔑 Claude Code: one-time sign-in required${NC} — no credentials found yet."
  printf '%b\n' "   Run:  ${B}docker compose exec -it api claude${NC}"
  printf '%s\n' "        → choose \"Claude account with subscription\" and complete the browser sign-in."
  printf '%s\n' "   NOTE: the sign-in URL wraps across terminal lines — copy it with 'c' (OSC-52"
  printf '%s\n' "         terminals such as iTerm2) or repair the line breaks in an editor first;"
  printf '%s\n' "         a truncated URL fails with \"Invalid response_type\" / \"Unknown scope\"."
  printf '%s\n' "   No browser? Put ANTHROPIC_API_KEY=… or CLAUDE_CODE_OAUTH_TOKEN=… in a .env"
  printf '%s\n' "         next to the compose files, then restart the stack."
fi
rule
printf '\n'
exit 0
