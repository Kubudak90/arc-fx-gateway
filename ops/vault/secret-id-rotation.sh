#!/usr/bin/env bash
# Daily rotation: mint a fresh AppRole secret_id, update the relayer env
# file atomically, signal-reload the relayer service.
set -euo pipefail

: "${VAULT_ADDR:=http://127.0.0.1:8200}"
: "${VAULT_TOKEN:?VAULT_TOKEN must be set (long-lived rotation operator token)}"

# Must match `EnvironmentFile=` in ops/relayer/arcora-relayer.service.
ENV_FILE="/root/arcora-ops/relayer/.env"
ENV_DIR="$(dirname "$ENV_FILE")"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[rotation] ERROR: $ENV_FILE does not exist — fix the service env layout first" >&2
  exit 1
fi

# Audit Ops-I-1 (2026-05-24): also pull the accessor for the new
# secret_id. We never log the secret_id itself (would defeat the purpose
# of rotation), but the accessor is a non-secret handle Vault writes to
# its audit log. Capturing it on rotation gives the operator a way to
# correlate the live secret_id with Vault's own audit trail without
# guessing at timestamps during an incident.
NEW_SECRET_BUNDLE=$(vault write -format=json -f auth/approle/role/relayer/secret-id)
NEW_SECRET_ID=$(echo "$NEW_SECRET_BUNDLE" | sed -n 's/.*"secret_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
NEW_ACCESSOR=$(echo "$NEW_SECRET_BUNDLE" | sed -n 's/.*"secret_id_accessor"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [[ -z "$NEW_SECRET_ID" ]]; then
  echo "[rotation] ERROR: vault returned an empty secret_id — refusing to rewrite env" >&2
  exit 3
fi

# Atomic env-file rewrite — mktemp in the same directory so the final mv stays
# on the same filesystem (rename is atomic only within a single fs).
TMP=$(mktemp "${ENV_DIR}/.relayer.env.XXXXXX")
trap 'rm -f "$TMP"' EXIT
grep -v '^VAULT_SECRET_ID=' "$ENV_FILE" > "$TMP"
echo "VAULT_SECRET_ID=$NEW_SECRET_ID" >> "$TMP"
chmod 0600 "$TMP"
chown root:root "$TMP"
mv -f "$TMP" "$ENV_FILE"

# `restart` (not `reload`): the service unit is Type=simple with no
# ExecReload, and the daemon only AppRole-logs in at boot — a hot reload
# wouldn't pick up the new VAULT_SECRET_ID anyway. Restart re-reads the
# EnvironmentFile and re-authenticates. 2026-05-13 prod incident: the
# `reload` call failed with "Job type reload is not applicable", the script
# exited under `set -e` before the is-active check, and the env was updated
# but the daemon kept crashing with the stale credentials.
systemctl restart arcora-relayer.service

# Give the daemon a few seconds to boot, login to Vault, and pull the key.
sleep 5
if ! systemctl is-active --quiet arcora-relayer.service; then
  echo "[rotation] ERROR: arcora-relayer is not active after restart" >&2
  exit 2
fi

# Audit Ops-M4 (2026-05-24): structured success line. /etc/cron.d redirects
# the script's stdout/stderr to /var/log/vault-rotation.log; this line is
# what the freshness monitor below greps for. The accessor is logged
# alongside the timestamp so an operator can cross-reference with Vault's
# audit log during an incident without having to guess.
echo "[rotation] $(date -Iseconds) ok accessor=${NEW_ACCESSOR:-unknown}"
