# Vault recovery runbook

> **2026-06-13 rebuild.** Vault was reinitialised WITH TLS on this date. The
> original install's unseal keys were never reliably saved (the "1Password +
> paper" custody below was aspirational, not real), and the install root token
> was found still live in `/root/.vault-token` — both are now fixed. A fresh
> 3-key set was generated, the operator saved it, the init file was shredded,
> and the temporary root token was revoked for real. Everything below reflects
> the post-rebuild reality.

## Quick reference

- Vault data lives at `/var/lib/vault/data/` on the VPS.
- **Vault speaks TLS on loopback:** `VAULT_ADDR=https://127.0.0.1:8200`,
  `VAULT_CACERT=/opt/vault/tls/vault.crt` (self-signed, CN=127.0.0.1). Plain
  http is rejected. Cert/key: `/opt/vault/tls/vault.{crt,key}` (key 0600 vault:vault).
- 3 unseal keys (regenerated 2026-06-13) held by the operator. Threshold: 2 of 3.
- **No standing root token.** The install token was revoked 2026-06-13. To get
  a temporary root token, run the generate-root ceremony (below) with 2 unseal
  keys — then revoke it immediately after use.
- Daily AppRole rotation runs under the `rotation-operator` orphan token at
  `/etc/arcora/rotation-operator.token` (policy: `ops/vault/policy-rotation-operator.hcl`
  — mint secret-id + read role + approle login for verify-before-commit).

## Reboot — unseal procedure

After every VPS reboot (relayer can't sign while sealed; its systemd unit
retry-loops until unseal completes):
```
ssh root@<ops-vps>
export VAULT_ADDR=https://127.0.0.1:8200 VAULT_CACERT=/opt/vault/tls/vault.crt
vault operator unseal     # paste unseal key 1 at the hidden prompt
vault operator unseal     # paste unseal key 2
vault status              # expect: Sealed=false, Initialized=true
```

## Need a temporary root token (e.g. to rewrite a policy)

No root token is kept on disk. Mint a one-shot via generate-root with 2 unseal
keys, then revoke it:
```
export VAULT_ADDR=https://127.0.0.1:8200 VAULT_CACERT=/opt/vault/tls/vault.crt
INIT=$(vault operator generate-root -init -format=json)
NONCE=$(echo "$INIT" | jq -r .nonce); OTP=$(echo "$INIT" | jq -r .otp)
ENC=$(vault operator generate-root -nonce="$NONCE" -format=json - <<<"<unseal-key-1>" | jq -r .encoded_root_token)
# if empty, provide a 2nd key with the same -nonce until encoded_root_token is set
ROOT=$(vault operator generate-root -decode="$ENC" -otp="$OTP")
VAULT_TOKEN="$ROOT" vault <your privileged command>
VAULT_TOKEN="$ROOT" vault token revoke -self    # ALWAYS revoke when done
```

## Lost a single unseal key

Acceptable — 2-of-3 still functions. Generate a fresh key set:
```
vault operator rekey -init -key-shares=3 -key-threshold=2
# then for each existing key holder:
vault operator rekey <existing-key>
```

## Lost majority of unseal keys

**Recovery is impossible.** The transit key is unrecoverable. To restore service:
1. Note the address of the inaccessible relayer key.
2. Bring up a fresh Vault on a new VPS (or wipe `/var/lib/vault/data/` and re-init).
3. Generate a new transit key → new relayer address.
4. Submit an admin-controlled tx to the gateway that grants `RELAYER_ROLE` to the new address and revokes the old role:
   ```
   cast send $GATEWAY_ADDRESS "grantRole(bytes32,address)" $RELAYER_ROLE_HASH <newRelayerAddr> --private-key $ADMIN_PK
   cast send $GATEWAY_ADDRESS "revokeRole(bytes32,address)" $RELAYER_ROLE_HASH <oldRelayerAddr> --private-key $ADMIN_PK
   ```
5. Update `GATEWAY_RELAYER` reference if still needed; relayer systemd reloads.

## Daily rotation cron failure

If `secret-id-rotation.sh` errors:
- Relayer still has its current `secret_id` valid for 24h. Manual re-run:
  ```
  ssh root@<ops-vps>
  VAULT_TOKEN=$(cat /root/.vault-rotation-token) bash /opt/arcora/ops/vault/secret-id-rotation.sh
  ```
- Past 24h without rotation → relayer signing fails (invalid secret_id). Use the rotation operator token to mint a new secret_id manually:
  ```
  vault write -f auth/approle/role/relayer/secret-id
  # write secret_id into /etc/arcora/relayer.env, systemctl reload arcora-relayer
  ```
