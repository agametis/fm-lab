#!/bin/bash
# refresh-doc-domains.sh — re-pin current CDN IPs for doc-source domains into the
# egress firewall's `allowed-domains` ipset. Runs as root via a narrow NOPASSWD
# sudoers entry, invoked by the doc-installer skills right before they hit the
# network (tools/install_modes.sh::refresh_firewall_allowlist).
#
# WHY: help.claris.com (Akamai) and duckdb.org (Cloudflare) are CDN-fronted with
# rotating IPs. init-firewall.sh pins them at container start; by the time a doc
# install runs the CDN may have rotated to different IPs, blocking the crawl even
# though the domain is on the allowlist. This refreshes them just-in-time.
#
# SECURITY: the domain list is HARDCODED and this script takes NO arguments — a
# node-shell user cannot use the NOPASSWD entry to whitelist an arbitrary host
# (which would defeat the egress firewall). Keep this list in sync with the
# doc-source entries in init-firewall.sh.
#
# BEST-EFFORT: no-ops silently when the firewall isn't active (no NET_ADMIN / no
# ipset / firewall not applied); never exits non-zero.

set -u
IFS=$'\n\t'

# CDN-fronted doc sources whose pinned IPs may go stale between container start
# and a (much later) doc install. www.monkeybreadsoftware.com is a single stable
# host but is included for completeness/robustness — refreshing it is harmless.
DOC_DOMAINS=(
    "help.claris.com"
    "www.monkeybreadsoftware.com"
    "duckdb.org"
    "blobs.duckdb.org"
)

# Guard 1: ipset tooling present at all (absent on bare-metal hosts).
command -v ipset >/dev/null 2>&1 || exit 0
# Guard 2: the firewall is actually applied — the ipset only exists once
# init-firewall.sh has run. Absent → permission-prompt-mode container → no-op.
ipset list allowed-domains >/dev/null 2>&1 || exit 0

for domain in "${DOC_DOMAINS[@]}"; do
    ips=$(dig +noall +answer A "$domain" 2>/dev/null | awk '$4 == "A" {print $5}') || continue
    [ -n "$ips" ] || continue
    while read -r ip; do
        # Validate dotted-quad before touching the ipset — mirrors init-firewall.sh.
        [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || continue
        ipset add allowed-domains "$ip" -exist 2>/dev/null || true
    done <<< "$ips"
done

exit 0
