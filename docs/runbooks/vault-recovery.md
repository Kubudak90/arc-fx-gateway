# Vault recovery runbook

## Quick reference

- Vault data lives at `/var/lib/vault/data/` on the VPS.
- 3 unseal keys distributed: 1Password (offline export) + paper backup + (TBD second holder for mainnet T-0).
- Threshold: 2 of 3 to unseal.
- Master root token: revoked after install. Use the long-lived `approle-rotator` token for daily rotation.

## Reboot — unseal procedure

After every VPS reboot:
```
ssh root@<ops-vps>
export VAULT_ADDR=http://127.0.0.1:8200
vault operator unseal <key1>
vault operator unseal <key2>
vault status   # expect: Sealed=false, Initialized=true
```

The relayer cannot sign transactions while Vault is sealed. The systemd
unit will retry-loop until unseal completes; expect log lines like
"vault: server sealed" until then.

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
