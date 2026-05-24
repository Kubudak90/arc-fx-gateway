#!/usr/bin/env bash
# Audit Ops-M4 (2026-05-24): freshness check for the daily Vault secret_id
# rotation. The rotation cron writes a structured "ok" line to
# /var/log/vault-rotation.log on success; if that line stops appearing
# (token expired, vault down, script renamed, anyone), the existing
# secret_id ages out and the relayer eventually starts rejecting login
# with 400/invalid — the same root cause as the 2026-05-12 5-day outage.
#
# This script runs hourly. If the newest "ok" line is older than 25h
# (one cron tick of slack), it exits 1 — the cron's MAILTO surfaces that
# to operators. If the log doesn't exist at all (post-deploy, log
# rotated) it ALSO exits 1, so a missing log can't silently mask a
# missing rotation.
#
# Install (mirror the rotation cron pattern):
#   cp ops/vault/vault-rotation-health.sh /root/arcora-ops/vault/
#   cat > /etc/cron.d/vault-rotation-health <<EOF
#   SHELL=/bin/bash
#   MAILTO=root
#   15 * * * * root /root/arcora-ops/vault/vault-rotation-health.sh
#   EOF
set -euo pipefail

LOG="${VAULT_ROTATION_LOG:-/var/log/vault-rotation.log}"
MAX_AGE_SECONDS="${VAULT_ROTATION_MAX_AGE_SECONDS:-90000}"  # 25h

if [[ ! -f "$LOG" ]]; then
  echo "[health] CRITICAL: $LOG does not exist — rotation has never run" >&2
  exit 1
fi

# Last success line. The new (audit-2026-05-24) rotation script writes
# "[rotation] <iso-ts> ok accessor=…"; the previous version wrote
# "[rotation] <iso-ts> new secret_id rotated, relayer reloaded". We
# accept both so this check can roll out without backfilling the log.
LAST_OK_LINE=$(grep -E '^\[rotation\] [^ ]+ (ok|new secret_id rotated)' "$LOG" | tail -n 1 || true)
if [[ -z "$LAST_OK_LINE" ]]; then
  echo "[health] CRITICAL: no successful rotation lines in $LOG" >&2
  exit 1
fi

# Field 2 is the ISO-8601 timestamp written by `date -Iseconds`.
LAST_OK_TS=$(echo "$LAST_OK_LINE" | awk '{print $2}')
if [[ -z "$LAST_OK_TS" ]]; then
  echo "[health] CRITICAL: latest 'ok' line is malformed: $LAST_OK_LINE" >&2
  exit 1
fi

LAST_OK_EPOCH=$(date -d "$LAST_OK_TS" +%s 2>/dev/null || echo "0")
if [[ "$LAST_OK_EPOCH" == "0" ]]; then
  echo "[health] CRITICAL: could not parse timestamp '$LAST_OK_TS'" >&2
  exit 1
fi

NOW_EPOCH=$(date +%s)
AGE=$(( NOW_EPOCH - LAST_OK_EPOCH ))

if (( AGE > MAX_AGE_SECONDS )); then
  echo "[health] CRITICAL: last successful rotation was ${AGE}s ago (>${MAX_AGE_SECONDS}s). Last line: $LAST_OK_LINE" >&2
  exit 1
fi

# Healthy — stay quiet so cron MAILTO doesn't spam the operator.
exit 0
