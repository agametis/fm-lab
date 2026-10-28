#!/bin/bash
# firewall-refresh-loop.sh — keeps the egress firewall's CDN pins fresh for the whole
# container lifetime, without any user interaction. postStartCommand starts it
# detached (`setsid -f`) right after init-firewall.sh; it runs as `node` and calls the
# root helper refresh-doc-domains.sh through that helper's existing NOPASSWD sudoers
# entry every REFRESH_INTERVAL seconds.
#
# WHY: CDN-fronted allowlist hosts (Akamai: help.claris.com, *.gallerycdn.vsassets.io;
# Cloudflare: duckdb.org) rotate IPs within minutes. init-firewall.sh pins only what
# resolves at start, so e.g. a VS Code extension update hours later stalls on a
# connect timeout. The helper only ever adds IPs, so the ipset gradually covers the
# CDN's rotation pool.
#
# Needs no privileges of its own and no sudoers entry: it can only trigger the
# argument-less helper, whose domain list is hardcoded. One instance per container
# (flock); the helper no-ops when the firewall is not applied.

set -u

REFRESH_INTERVAL=300
HELPER=/usr/local/bin/refresh-doc-domains.sh
LOCK=/tmp/fmlab-firewall-refresh.lock

[ -x "$HELPER" ] || exit 0

exec 9>"$LOCK"
flock -n 9 || exit 0

while :; do
    sleep "$REFRESH_INTERVAL"
    sudo -n "$HELPER" >/dev/null 2>&1 || true
done
