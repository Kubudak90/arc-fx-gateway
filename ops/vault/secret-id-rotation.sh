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

NEW_SECRET_ID=$(vault write -field=secret_id -f auth/approle/role/relayer/secret-id)

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

echo "[rotation] $(date -Iseconds) new secret_id rotated, relayer reloaded"
