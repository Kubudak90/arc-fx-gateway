# Vault setup for Arcora relayer

The Arcora V10 relayer signs every transaction through HashiCorp Vault's
transit engine. The secp256k1 private key never leaves Vault — the relayer
authenticates via AppRole, calls `transit/sign/relayer-v10`, and uses the
returned signature.

## One-time setup (run on the VPS as root)

```
sudo bash ops/vault/install.sh
```

Then, interactively in an SSH session:

```
export VAULT_ADDR=http://127.0.0.1:8200

# 1. Init — save the 3 unseal keys offline (1Password + paper backup, distributed across holders)
vault operator init -key-shares=3 -key-threshold=2

# 2. Unseal — twice, with two of the three keys
vault operator unseal <key1>
vault operator unseal <key2>

# 3. Authenticate as root (one-time; we'll mint a long-lived ops token next)
vault login <root-token>

# 4. Install the secp256k1 plugin
#    Plugin source: vetted at implementation phase; install per its README.
#    Typical sequence:
SHA256=$(shasum -a 256 /etc/vault.d/plugins/vault-plugin-secrets-secp256k1 | cut -d' ' -f1)
vault plugin register -sha256=$SHA256 secrets vault-plugin-secrets-secp256k1
vault secrets enable -path=transit -plugin-name=vault-plugin-secrets-secp256k1 plugin

# 5. Generate the relayer key (cannot be exported)
vault write -f transit/keys/relayer-v10 type=secp256k1 exportable=false

# 6. Read the public key → derive the Ethereum address
vault read transit/keys/relayer-v10  # copy the public_key field; convert with viem helpers locally

# 7. AppRole auth + policy
vault policy write relayer /etc/vault.d/policy-relayer.hcl
vault auth enable approle
vault write auth/approle/role/relayer \
  secret_id_ttl=24h \
  token_ttl=2h \
  token_max_ttl=2h \
  policies=relayer

# 8. Mint role_id (long-lived) + first secret_id
ROLE_ID=$(vault read -field=role_id auth/approle/role/relayer/role-id)
SECRET_ID=$(vault write -field=secret_id -f auth/approle/role/relayer/secret-id)

# 9. Mint a long-lived ops token for the rotation cron (separate from root)
vault token create -policy=approle-rotator -ttl=8760h -orphan
# Save token to /root/.vault-rotation-token (mode 0600)

# 10. Wire the rotation cron
echo "0 4 * * * VAULT_TOKEN=$(cat /root/.vault-rotation-token) /opt/arcora/ops/vault/secret-id-rotation.sh" >> /etc/cron.d/vault-rotation
```

## Disaster recovery

See `docs/runbooks/vault-recovery.md`.

## What goes in `/etc/arcora/relayer.env`

```
VAULT_URL=http://127.0.0.1:8200
VAULT_ROLE_ID=<step 8 ROLE_ID>
VAULT_SECRET_ID=<step 8 SECRET_ID — rotated daily>
VAULT_KEY_NAME=relayer-v10
GATEWAY_ADDRESS_V10=<from forge deploy>
ARC_RPC=https://rpc.testnet.arc.network
DATABASE_URL=postgres://…
```
