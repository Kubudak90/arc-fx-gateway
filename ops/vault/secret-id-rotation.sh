#!/usr/bin/env bash
# Daily rotation: mint a fresh AppRole secret_id, update the relayer env
# file atomically, signal-reload the relayer service.
set -euo pipefail

: "${VAULT_ADDR:=http://127.0.0.1:8200}"
: "${VAULT_TOKEN:?VAULT_TOKEN must be set (long-lived rotation operator token)}"

ENV_FILE="/etc/arcora/relayer.env"

NEW_SECRET_ID=$(vault write -field=secret_id -f auth/approle/role/relayer/secret-id)

# Atomic env-file rewrite
TMP=$(mktemp /etc/arcora/.relayer.env.XXXXXX)
trap 'rm -f "$TMP"' EXIT
grep -v '^VAULT_SECRET_ID=' "$ENV_FILE" > "$TMP"
echo "VAULT_SECRET_ID=$NEW_SECRET_ID" >> "$TMP"
chmod 0600 "$TMP"
chown root:root "$TMP"
mv -f "$TMP" "$ENV_FILE"

systemctl reload arcora-relayer.service

echo "[rotation] $(date -Iseconds) new secret_id rotated, relayer reloaded"
