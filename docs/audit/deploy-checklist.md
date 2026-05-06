# Deploy + Arcscan verify checklist (V8)

Run on every gateway deploy. Verified bytecode + source on the explorer is the cheapest signal we can give external reviewers and bounty hunters.

## ⚠ vercel.json location is not portable

`packages/app/vercel.json` is the SOURCE OF TRUTH for cron registration. The
Vercel project root is set to `packages/app/`; relocating the project root
will silently stop registering all crons. If the monorepo layout is ever
reorganized, coordinate the `vercel.json` move at the same time and verify
crons still register via `vercel crons ls`.

## 1. Pre-deploy

- [ ] All audit-prep gates green on the branch you're deploying from:
  - [ ] `forge build` clean, no new warnings
  - [ ] `forge test` all green (19+ V8 tests today)
  - [ ] Slither passing in CI (`fail-on: medium`)
  - [ ] Mythril passing on push
- [ ] No deprecated imports — V8 standalone (only OpenZeppelin)
- [ ] Constructor args reviewed: `protocolFeeBps`, `initialOwner`, `initialRelayer`
- [ ] `ARC_TESTNET_RPC` (or mainnet RPC) and `DEPLOYER_PRIVATE_KEY` confirmed in env

## 2. Deploy

```bash
cd packages/contracts
forge script script/DeployV8.s.sol \
  --rpc-url $ARC_TESTNET_RPC \
  --broadcast \
  --slow \
  --verify \
  --verifier-url $ARC_EXPLORER_URL \
  --etherscan-api-key $ARC_EXPLORER_KEY
```

The `--verify` flag asks foundry to submit verification metadata to the explorer in the same run. **If it fails (network, key, race), do NOT trust the broadcast log alone — run the post-deploy verification step below.**

## 3. Post-deploy verification

Foundry has been observed reporting `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL` while the tx silently failed to confirm on Arc testnet (memory: roadmap snapshot 2026-04-29). Always:

- [ ] `cast receipt <txhash> --rpc-url $ARC_TESTNET_RPC` → `status: 1`
- [ ] `cast code <deployedAddress> --rpc-url $ARC_TESTNET_RPC` → non-empty hex
- [ ] Open the address on the explorer and confirm the source code badge shows verified

If verification didn't complete during deploy, run it manually:

```bash
forge verify-contract \
  --rpc-url $ARC_TESTNET_RPC \
  --verifier-url $ARC_EXPLORER_URL \
  --etherscan-api-key $ARC_EXPLORER_KEY \
  --constructor-args $(cast abi-encode "constructor(uint256,address,address)" $FEE_BPS $OWNER $RELAYER) \
  <deployedAddress> \
  src/ArcFXGatewayV8.sol:ArcFXGatewayV8
```

- [ ] Verification status checked on explorer (refresh after ~30s)

## 4. Wire-up

- [ ] `GATEWAY_ADDRESS_V8` env updated (Vercel prod + preview, VPS relayer + indexer)
- [ ] `vercel env pull .env.production.local` re-run locally (working tree)
- [ ] First merchant whitelist tx run if needed: `cast send <gateway> "setTokenSupport(address,bool)" <usdc> true`
- [ ] Smoke pay through `arcorapay.xyz/i/<id>` end-to-end (USDC → USDC at minimum)

## 5. Documentation

- [ ] `memory/compliance_phase0.md` (or successor) updated with the new gateway address if relevant
- [ ] `docs/arcora-roadmap.html` "addresses" card updated
- [ ] If this is a re-deploy with breaking ABI changes, bump the SDK in `@arcora/sdk` and publish

## 6. Old gateway

- [ ] If retiring a previous deploy, document the cutover commit hash
- [ ] Indexer dual-watch period: how long to keep the old address in `GATEWAYS`
- [ ] Communicate to integrated merchants (if any) before flipping their env

---

This list lives in audit-readable docs because external reviewers ask "how do you know your deployed bytecode matches the audited source?" — pointing them here is the answer.
