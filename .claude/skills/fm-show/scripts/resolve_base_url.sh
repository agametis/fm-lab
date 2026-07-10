#!/usr/bin/env bash
# Determine the FM-Lab web-frontend base URL for deep links (fm-show step 2).
#
# PROBE address and PUBLIC address are separate concerns: in the Docker Compose
# stack the agent runs in the `api` container while the Vite dev server lives in
# the `web` container — reachable in-container ONLY via compose DNS (web:5173),
# while the URL handed to the HOST browser must stay localhost (host port map).
#
# Priority:
#   1. $1                     — explicit --base-url value (used unverified)
#   2. $FMLAB_WEB_URL         — environment override (used unverified)
#   3. probe candidates (probe_url|public_url|mode):
#        http://localhost:5173 → itself          mode html  (dev container / native)
#        http://web:5173       → localhost:5173  mode any   (compose: Vite answers
#                                403 to a foreign Host header — any HTTP response
#                                proves the dev server is alive)
#        http://localhost:3003 → itself          mode html  (REST API origin; only
#        http://api:3003       → localhost:3003  mode html   once it serves the SPA
#                                                            — today it answers JSON
#                                                            and is skipped)
#
# Output: the base URL on stdout (no trailing slash).
# Exit codes: 0 = resolved, 4 = no frontend reachable.

set -u

if [ -n "${1:-}" ]; then
  echo "${1%/}"
  exit 0
fi

if [ -n "${FMLAB_WEB_URL:-}" ]; then
  echo "${FMLAB_WEB_URL%/}"
  exit 0
fi

for spec in \
  "http://localhost:5173|http://localhost:5173|html" \
  "http://web:5173|http://localhost:5173|any" \
  "http://localhost:3003|http://localhost:3003|html" \
  "http://api:3003|http://localhost:3003|html"
do
  probe_url="${spec%%|*}"
  rest="${spec#*|}"
  public_url="${rest%%|*}"
  mode="${rest#*|}"

  result="$(curl -s --max-time 1 -o /dev/null -w '%{http_code} %{content_type}' "$probe_url/" 2>/dev/null || echo 000)"
  code="${result%% *}"

  case "$mode" in
    any)
      if [ "$code" != "000" ]; then
        echo "$public_url"
        exit 0
      fi
      ;;
    html)
      case "$result" in
        "200 text/html"*)
          echo "$public_url"
          exit 0
          ;;
      esac
      ;;
  esac
done

echo "no reachable FM-Lab web frontend (probed localhost:5173, web:5173, localhost:3003, api:3003)" >&2
exit 4
