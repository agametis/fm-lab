#!/bin/bash
# refresh-doc-domains.sh — re-pin current CDN IPs for CDN-fronted allowlist domains
# into the egress firewall's `allowed-domains` ipset. Runs as root via a narrow
# NOPASSWD sudoers entry. Two callers:
#   - firewall-refresh-loop.sh, started detached by postStartCommand — refreshes
#     every few minutes for the whole container lifetime, no user action involved;
#   - the doc-installer skills right before they hit the network
#     (tools/install_modes.sh::refresh_firewall_allowlist) — just-in-time top-up.
#
# WHY: help.claris.com and <publisher>.gallerycdn.vsassets.io (Akamai) and
# duckdb.org (Cloudflare) are CDN-fronted with rotating IPs. init-firewall.sh pins
# them at container start; by the time a doc install or a VS Code extension update
# runs, the CDN may have rotated to different IPs, blocking the request even though
# the domain is on the allowlist. `ipset add -exist` only ever adds, so repeated
# refreshes accumulate the CDN's rotation pool.
#
# SECURITY: the domain list is HARDCODED and this script takes NO arguments — a
# node-shell user cannot use the NOPASSWD entry to whitelist an arbitrary host
# (which would defeat the egress firewall). Every entry must also be in this
# variant's init-firewall.sh; this file is therefore NOT identical to the public
# variant's copy (the gallery hosts follow each variant's extension set).
#
# BEST-EFFORT: no-ops silently when the firewall isn't active (no NET_ADMIN / no
# ipset / firewall not applied); never exits non-zero.

set -u
IFS=$'\n\t'

# CDN-fronted domains whose pinned IPs may go stale after container start.
# www.monkeybreadsoftware.com is a single stable host but is included for
# completeness/robustness — refreshing it is harmless. The *.gallery.vsassets.io
# hosts sit on Microsoft's edge network (more stable than gallerycdn, but still a CDN).
CDN_DOMAINS=(
    "help.claris.com"
    "www.monkeybreadsoftware.com"
    "duckdb.org"
    "blobs.duckdb.org"
    "anthropic.gallery.vsassets.io"
    "anthropic.gallerycdn.vsassets.io"
    "dbaeumer.gallery.vsassets.io"
    "dbaeumer.gallerycdn.vsassets.io"
    "esbenp.gallery.vsassets.io"
    "esbenp.gallerycdn.vsassets.io"
)

# Guard 1: ipset tooling present at all (absent on bare-metal hosts).
command -v ipset >/dev/null 2>&1 || exit 0
# Guard 2: the firewall is actually applied — the ipset only exists once
# init-firewall.sh has run. Absent → permission-prompt-mode container → no-op.
ipset list allowed-domains >/dev/null 2>&1 || exit 0

for domain in "${CDN_DOMAINS[@]}"; do
    ips=$(dig +noall +answer A "$domain" 2>/dev/null | awk '$4 == "A" {print $5}') || continue
    [ -n "$ips" ] || continue
    while read -r ip; do
        # Validate dotted-quad before touching the ipset — mirrors init-firewall.sh.
        [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || continue
        ipset add allowed-domains "$ip" -exist 2>/dev/null || true
    done <<< "$ips"
done

exit 0
