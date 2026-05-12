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

systemctl reload arcora-relayer.service

if ! systemctl is-active --quiet arcora-relayer.service; then
  echo "[rotation] ERROR: arcora-relayer is not active after reload" >&2
  exit 2
fi

echo "[rotation] $(date -Iseconds) new secret_id rotated, relayer reloaded"
