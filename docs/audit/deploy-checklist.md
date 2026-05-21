# Deploy + Arcscan verify checklist (ArcFXGateway)

Run on every gateway deploy. Verified bytecode + source on the explorer is
the cheapest signal we can give external reviewers and bounty hunters.

## ⚠ vercel.json location is not portable

`packages/app/vercel.json` is the SOURCE OF TRUTH for cron registration.
The Vercel project root is set to `packages/app/`; relocating the project
root will silently stop registering all crons. If the monorepo layout is
ever reorganized, coordinate the `vercel.json` move at the same time and
verify crons still register via `vercel crons ls`.

## 1. Pre-deploy

- [ ] All audit-prep gates green on the branch you're deploying from:
  - [ ] `forge build` clean, no new warnings
  - [ ] `forge test` all green (77+ tests today — unit + fuzz + invariant + scripts)
  - [ ] Slither passing in CI (`fail-on: medium`)
  - [ ] Mythril passing on push
- [ ] Constructor args reviewed: `protocolFeeBps` (≤1000), `initialOwner`, `initialRelayer`, `refundWindowSeconds`, `adminRecoveryDelaySeconds`, `feeRecipient`, `permit2`
- [ ] `ARC_TESTNET_RPC` (or mainnet RPC) and `DEPLOYER_PRIVATE_KEY` confirmed in env

## 2. Deploy

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $ARC_TESTNET_RPC \
  --broadcast \
  --slow \
  --verify \
  --verifier-url $ARC_EXPLORER_URL \
  --etherscan-api-key $ARC_EXPLORER_KEY
```

The `--verify` flag asks foundry to submit verification metadata to the
explorer in the same run. **If it fails (network, key, race), do NOT
trust the broadcast log alone — run the post-deploy verification step
below.**

## 3. Post-deploy verification

Foundry has been observed reporting `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`
while the tx silently failed to confirm on Arc testnet. Always:

- [ ] `cast receipt <txhash> --rpc-url $ARC_TESTNET_RPC` → `status: 1`
- [ ] `cast code <deployedAddress> --rpc-url $ARC_TESTNET_RPC` → non-empty hex
- [ ] Open the address on the explorer and confirm the source code badge shows verified

If verification didn't complete during deploy, run it manually:

```bash
forge verify-contract \
  --rpc-url $ARC_TESTNET_RPC \
  --verifier-url $ARC_EXPLORER_URL \
  --etherscan-api-key $ARC_EXPLORER_KEY \
  --constructor-args $(cast abi-encode "constructor(uint256,address,address,uint256,uint256,address,address)" $FEE_BPS $OWNER $RELAYER $REFUND_WINDOW $ADMIN_RECOVERY_DELAY $FEE_RECIPIENT $PERMIT2) \
  <deployedAddress> \
  src/ArcFXGateway.sol:ArcFXGateway
```

- [ ] Verification status checked on explorer (refresh after ~30s)

## 4. Wire-up

- [ ] `GATEWAY_ADDRESS` env updated everywhere:
  - Vercel: production + preview + development scopes
  - VPS: `/root/arcora-ops/{indexer,relayer,webhooks}/.env`
  - Local working tree: `packages/app/.env` (and re-pull `.env.production.local` if used)
- [ ] `NEXT_PUBLIC_GATEWAY_ADDRESS` mirror in the same Vercel scopes
- [ ] `packages/contracts/deployments/arc-testnet.json` `current` block updated (address, `deployedAt`, `deployTx`, `label`, `auditFixesIncluded`)
- [ ] First token whitelist tx if needed:
      `cast send <gateway> "setTokenSupport(address,bool)" <usdc> true`
- [ ] Restart VPS daemons: `systemctl restart arcora-{indexer,relayer,webhooks}`
- [ ] Indexer caught up on the new address — `indexer_state.last_processed_block` advancing
- [ ] Smoke pay through `arcorapay.xyz/i/<id>` end-to-end (USDC → USDC at minimum)

## 5. Documentation

- [ ] `packages/contracts/deployments/arc-testnet.json` is the canonical record
- [ ] `docs/PITCH.md` + `docs/LITEPAPER.md` reference the new address if relevant
- [ ] If this is a re-deploy with breaking ABI changes, regenerate
      `packages/app/lib/chain/gateway-abi.ts`, bump the SDK in `@arcora/sdk`,
      and publish

## 6. Old gateway

- [ ] Document the cutover commit hash in the new manifest entry's `deployNotes`
- [ ] If running a dual-watch window: list both addresses in the indexer's `WATCHED_GATEWAYS` env and document the cutover date
- [ ] Communicate to integrated merchants (if any) before flipping their env

---

This list lives in audit-readable docs because external reviewers ask
"how do you know your deployed bytecode matches the audited source?" —
pointing them here is the answer.
