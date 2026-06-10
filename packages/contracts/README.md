# @arc-fx/contracts — ArcFXGateway V8

Solidity contracts powering **Arcora**, a Stripe-shaped stablecoin checkout settling on [Arc Network](https://arc.network). The customer signs **one** EIP-712 (Permit2) message; an off-chain Arcora relayer pulls the pay-in, runs Circle App Kit Swap to convert it, and calls the gateway to deliver the merchant's preferred stablecoin payout.

## Audit scope

The canonical, in-scope contract is **`src/ArcFXGatewayV8.sol`** plus the OpenZeppelin libraries it imports. Everything else under `src/` is helper or testnet glue (`testnet/MintableERC20.sol`, etc.).

Deprecated v0.6 / v0.7 contracts (StablePool, StablecoinRegistry, OracleAMM, PriceGuard, MockChainlinkFeed) live in [`legacy/`](./legacy/) — out of audit scope, kept for traceability of design history.

Read first if you're reviewing this code:
- [`docs/audit/threat-model.md`](../../docs/audit/threat-model.md) — actors, assets, trust boundaries, A–H attack-surface matrix, accepted risks
- [`docs/audit/deploy-checklist.md`](../../docs/audit/deploy-checklist.md) — how every deploy ends with a verified bytecode badge on Arcscan
- [`docs/superpowers/specs/2026-05-03-plan-7-audit-prep.md`](../../docs/superpowers/specs/2026-05-03-plan-7-audit-prep.md) — full audit prep plan, including the zero-budget path that is canonical until revenue exists

## Architecture in one diagram

```
                              ┌──────────────────────────────┐
   ┌────────────────┐         │ Arcora relayer (off-chain)   │
   │ Customer EOA   │         │ ops/relayer/run.ts (VPS)     │
   │ signs Permit2  │────────▶│  ─ Permit2.permitTransferFrom│
   └────────────────┘         │  ─ kit.swap (App Kit Swap)   │
                              │  ─ approve gateway           │
                              │  ─ settleInvoice             │
                              └─────┬────────────────────────┘
                                    │ (msg.sender = relayer)
                                    ▼
                              ┌─────────────────────────────────┐
                              │  ArcFXGatewayV8                 │
                              │   ─ supportedTokens (whitelist) │
                              │   ─ merchants                   │
                              │   ─ invoices  (Created → ...)   │
                              │   ─ payments  (refund accounting)│
                              │   ─ AccessControl: ADMIN/RELAYER│
                              │   ─ Pausable / ReentrancyGuard  │
                              └─────────────┬───────────────────┘
                                            │ safeTransfer
                                            ▼
                              ┌────────────────┐
                              │ Merchant payout│
                              └────────────────┘
```

The gateway never holds the pay-in token. App Kit Swap is the only swap surface, and it runs entirely off-chain via the relayer's signed RFQ flow against Circle's maker network.

## Build & test

```bash
# from repo root
pnpm install

# from packages/contracts
forge build --sizes
forge test                        # 19 V8 tests today
forge coverage --report summary   # see "Coverage" below
bin/coverage-gate.sh              # threshold gate (Plan 7 Layer 2 #4)
```

### Coverage

Audit-scope file (`src/ArcFXGatewayV8.sol`) coverage as of 2026-05-03 (after the test backfill — 49 tests):

| Metric | Today | Floor (CI gate) | Target (audit-ready) |
|---|---|---|---|
| Lines     | **100.00%** | 95% | 95% |
| Branches  | **100.00%** | 90% | 90% |
| Statements | **100.00%** | — | — |
| Functions  | **100.00%** | — | — |

Floor sits at the audit-ready bar so regressions below the bar fail CI immediately.

### Static analysis

- **Slither** runs on every push and PR (`fail-on: medium`). Triage exceptions live in [`.slither-triage.md`](./.slither-triage.md).
- **Mythril** runs on push (skipped on PR for speed), 30-min timeout, V8 only.
- **Forge fuzz/invariant suites** for V8 are a follow-up — the v0.7 fuzz/invariant files were targeted at the deprecated pool path and moved to `legacy/`.

## Deploy

Use [`script/DeployV8.s.sol`](./script/DeployV8.s.sol) and follow [`docs/audit/deploy-checklist.md`](../../docs/audit/deploy-checklist.md). The checklist embeds a foundry-broadcast-lying gotcha (verified `cast receipt` + `cast code` are the ground-truth checks).

Required env vars:

| Var | Purpose |
|-----|---------|
| `ARC_TESTNET_RPC` (or mainnet RPC) | RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | EOA used for broadcast |
| `PROTOCOL_FEE_BPS` | Fee in basis points (locked at deploy; default 30 = 0.30%) |
| `INITIAL_OWNER` | Address granted `DEFAULT_ADMIN_ROLE` |
| `INITIAL_RELAYER` | Address granted `RELAYER_ROLE` |
| `ARC_EXPLORER_KEY` / `ARC_EXPLORER_URL` | For `--verify` to land Arcscan source verification in the same broadcast |

After deploy, update `GATEWAY_ADDRESS_V8` in Vercel + the VPS relayer/indexer envs. Memory has the canonical addresses (see `~/.claude/projects/.../memory/`).

## Live testnet deployments

| Contract | Address | Status |
|---|---|---|
| ArcFXGatewayV8 | `0x6fAaD9…507a8` | live, canonical |
| ArcFXGateway v0.6 | `0x7c1137…b7a3` | deprecated; events still indexed for legacy invoices |
| FxEscrow (App Kit Swap settlement) | `0x867650…a9f8` | Circle-managed |
| Permit2 | `0x000000…78BA3` | universal Permit2 |
| USDC / EURC | Circle-managed canonical addresses | live |

(Full address list: `packages/contracts/deployments/arc-testnet.json` is the canonical record, or run the dashboard at `arcorapay.xyz`.)

## Reporting a finding

See repo-root [`SECURITY.md`](../../SECURITY.md) — short version: email `compliance@arcora.dev`, 24h response. A live Immunefi bug bounty replaces this channel at mainnet T-0.

## License

- `src/ArcFXGatewayV8.sol`, scripts, tests: **MIT**
- `legacy/*` (deprecated): **MIT** — Saddle Finance's StableSwap port preserved upstream-MIT for the historical record only
