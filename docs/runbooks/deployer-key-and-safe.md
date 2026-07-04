# Runbook — deployer key hygiene + Safe multisig migration

Companion to MAINNET-READINESS item 5. State as of 2026-07-05:

- `~/.foundry/keystores/arcora-deployer` **already exists** (eth v3 keystore,
  aes-128-ctr — created by `cast wallet import`). Whether its password is known
  and it decrypts to the live deployer `0x26Bf165a2e606d39B9DB410196c61bD3B7c2D8e3`
  has NOT been verified — that is step 1.
- `packages/contracts/.env` still holds `DEPLOYER_PRIVATE_KEY` in cleartext
  (gitignored, never in git history — the exposure is this machine, not the repo).
- `Deploy.s.sol` now supports keystore broadcast: leave `DEPLOYER_PRIVATE_KEY`
  unset and pass `--account/--sender` (2026-07-05).

## Phase A — retire the plaintext key (do now, ~10 min)

1. **Verify the keystore decrypts to the right address** (prompts for password):
   ```bash
   cast wallet address --account arcora-deployer
   # expect: 0x26Bf165a2e606d39B9DB410196c61bD3B7c2D8e3
   ```
   If the password is lost or the address differs: re-import while the plaintext
   key still exists — `cast wallet import arcora-deployer --interactive` —
   then re-verify. (This is why the .env line is scrubbed LAST.)
2. **Dry-run a keystore-based script call** against testnet:
   ```bash
   cd packages/contracts
   forge script script/Deploy.s.sol --rpc-url "$ARC_TESTNET_RPC" \
     --account arcora-deployer --sender 0x26Bf165a2e606d39B9DB410196c61bD3B7c2D8e3
   # NO --broadcast: just proves signing works without DEPLOYER_PRIVATE_KEY set.
   # Comment the env line out first (see step 3) or run with `env -u DEPLOYER_PRIVATE_KEY`.
   ```
3. **Scrub the plaintext**: delete the `DEPLOYER_PRIVATE_KEY=…` line from
   `packages/contracts/.env` (keep `DEPLOYER_ADDRESS`). Then look for stray copies:
   shell history (`history | grep -c PRIVATE`), Time Machine excludes, editor
   swap files.
4. Update `packages/contracts/README.md` env table: key is keystore-based;
   `DEPLOYER_PRIVATE_KEY` row removed.

## Phase B — Safe multisig for admin (mainnet blocker, needs signers)

Target end-state (threat-model.md mitigation): `DEFAULT_ADMIN_ROLE` +
`TREASURY_OWNER` on a 2-of-3 Safe; the EOA keeps NO role. On Arc, deploy Safe
via the canonical SafeProxyFactory once Circle publishes/permits the singleton
(check `https://docs.safe.global` supported networks; if Safe contracts aren't
on Arc mainnet at launch, deploy the audited singleton+factory ourselves from
the safe-smart-account release tags and record addresses in `arc-mainnet.json`).

1. Choose 3 signer devices (hardware keys preferred; at minimum: laptop keystore,
   phone signer, offline backup). Record addresses.
2. Deploy/instantiate the Safe (2-of-3) on the target chain; smoke-test with a
   0-value tx.
3. Grant + revoke on the gateway (the contract uses AccessControl):
   ```solidity
   gw.grantRole(DEFAULT_ADMIN_ROLE, SAFE);   // from current admin EOA
   // FROM THE SAFE: verify it can call an admin fn (e.g. a no-op param read/set)
   gw.revokeRole(DEFAULT_ADMIN_ROLE, EOA);   // executed via the Safe AFTER verify
   ```
   Order matters: grant → verify from Safe → revoke EOA. Same dance for the
   treasury owner and PaymentEscrow `owner()` (v2 uses Ownable →
   `transferOwnership(SAFE)`, two-step if the mainnet rev adopts Ownable2Step —
   see low-triage note on `AccessControlDefaultAdminRules`).
4. Update `deploy-checklist.md` + `arc-mainnet.json` with the Safe address; add
   a preflight check that admin != an EOA.

## Phase C — relayer key (tracked separately)

Vault KV + AppRole is live; the residual (key in process memory) is the
documented HSM/KMS step at mainnet T-0 — out of scope for this runbook.
