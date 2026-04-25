# @arc-fx/contracts

Protocol contracts for **Arc FX Gateway** — a permissionless USDC ⇄ EURC swap layer plus an atomic merchant-settlement contract on [Arc Network](https://arc.network).

## Contracts

| Contract | Role |
|----------|------|
| `ArcFXGateway.sol` | Merchant registry, invoice state, atomic `pay()` (swap-and-settle) |
| `libraries/PriceGuard.sol` | Chainlink-backed deviation guard (±0.5%) |
| `pool/StableSwap.sol` (+ helpers) | StableSwap AMM for the USDC/EURC pair (Saddle Finance Solidity port, MIT) |

## Architecture

```
Customer EURC ──▶ ArcFXGateway.pay() ──▶ StableSwap.swap() ──▶ USDC ──▶ Merchant
                          │
                          └──▶ PriceGuard.check() ──▶ Chainlink EUR/USD (deviation guard)
```

- **Gateway is immutable.** No upgrade proxy. v2 will deploy a new address.
- **Pool is standalone.** Any other dApp can integrate it without touching the gateway.
- **Oracle is guard-only.** Pricing is AMM-determined; Chainlink only rejects swaps that deviate >0.5% from the reference rate.

Full design: [`docs/superpowers/specs/2026-04-24-arc-fx-merchant-gateway-design.md`](../../docs/superpowers/specs/2026-04-24-arc-fx-merchant-gateway-design.md)
Implementation plan: [`docs/superpowers/plans/2026-04-24-plan-1-protocol.md`](../../docs/superpowers/plans/2026-04-24-plan-1-protocol.md)

## Build & Test

```bash
# from repo root
pnpm install

# from packages/contracts
forge build
forge test                                  # 47 tests across 4 suites
FOUNDRY_PROFILE=ci forge test               # fuzz @ 10k runs, invariant @ 256×64
forge coverage --report summary
```

### Coverage thresholds

| File | Lines | Branches |
|------|-------|----------|
| `PriceGuard.sol` | 100% | 100% |
| `ArcFXGateway.sol` | 100% | 92% |

### Test layers

| Layer | Path | Notes |
|-------|------|-------|
| Unit | `test/PriceGuard.t.sol`, `test/ArcFXGateway.t.sol` | 25 tests |
| Fuzz | `test/ArcFXGateway.fuzz.t.sol` | 10k runs, fee invariant |
| Invariant | `test/ArcFXGateway.invariant.t.sol` | "no stuck funds", "payout + fee = total out" |

## Deploy (Arc testnet)

```bash
cp .env.example .env   # fill in values

# 1. Deploy a pool (or reuse one) — see deployments/ for already-deployed addresses
# 2. Deploy the gateway
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --verify

# 3. Seed liquidity (skip if pool already has liquidity)
forge script script/BootstrapLiquidity.s.sol --rpc-url arc_testnet --broadcast
```

Deployed addresses are recorded in `deployments/arc-testnet.json` after a successful broadcast.

### Required env vars

| Var | Purpose |
|-----|---------|
| `ARC_TESTNET_RPC` | Arc testnet RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | EOA used for broadcast (testnet only) |
| `STABLESWAP_POOL_ADDRESS` | Address of the deployed pool |
| `CHAINLINK_EURUSD_FEED` | EUR/USD aggregator (mock feed acceptable for testnet) |
| `TREASURY_OWNER` | Gateway owner; receives withdrawn fees |
| `PROTOCOL_FEE_BPS` | Fee in basis points (10 = 0.10%) |
| `USDC_ADDRESS`, `EURC_ADDRESS` | Token addresses on Arc testnet |
| `BOOTSTRAP_USDC`, `BOOTSTRAP_EURC` | Raw token units to seed (e.g. `100000000000` = 100k USDC at 6 decimals) |

## Security

- **CI:** `.github/workflows/contracts-ci.yml` runs build, tests (default + CI profile), coverage, and Slither on every push. Workflow is configured but inactive on first deploy if the repo owner has GitHub Actions disabled at the account level — enable at https://github.com/settings/actions to activate.
- **Static:** Slither runs in CI; build fails on any high/medium finding.
- **Dynamic:** Foundry fuzz (10k runs/property) + invariant (256×64).
- **Manual:** SWC registry checklist passes; vendored Saddle pool reviewed patch-by-patch against upstream `master` at vendor time.
- **Architectural:** immutable construction params, custom errors only, ReentrancyGuard on mutating entry points.

## Live Arc-testnet deployment (v0.2.0 — OracleAMM)

| | Address |
|---|---|
| ArcFXGateway | [`0xaBa4fc9a11e5E39713F6D6E35a892929e261C53D`](https://testnet.arcscan.app/address/0xaBa4fc9a11e5E39713F6D6E35a892929e261C53D) |
| OracleAMM | [`0xC2020098aF328ac9CBD274267F424822C400dD66`](https://testnet.arcscan.app/address/0xC2020098aF328ac9CBD274267F424822C400dD66) |
| MockChainlinkFeed (EUR/USD = 1.0863) | [`0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3`](https://testnet.arcscan.app/address/0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3) |

End-to-end smoke-test transaction: [`0x31ddbf35…fc2bf0bd1c2064a`](https://testnet.arcscan.app/tx/0x31ddbf35ff03918fe2b4aad870f6c6a1185737a7c84643893fc2bf0bd1c2064a) — invoice for 0.10 USDC paid in EURC at the real 1.0863 EUR/USD rate, settled, marked Paid.

Pool quote example: 0.1 EURC → 0.108587 USDC (gross 0.108630 USDC at oracle = 1.0863, minus 4 bps pool fee = 0.108587).

Full deployment record (current + deprecated v0.1.0): [`deployments/arc-testnet.json`](./deployments/arc-testnet.json)

### Pool architecture — OracleAMM

Plan 1.5 replaces Saddle StableSwap with [`OracleAMM`](src/pool/OracleAMM.sol), a Chainlink-priced two-token pool inspired by Lifinity / Mercurial. Every swap reads the live oracle and quotes at `oracle ± swapFeeBps`. There is no bonding curve — capital efficiency is bounded only by reserves and oracle freshness. Suitable for stable FX pairs that move within a narrow band; LPs face oracle-rate convergence as the pool's mark-to-market value.

The legacy Saddle StableSwap port (`src/pool/StableSwap.sol` and helpers) is left in place for reference but is no longer deployed. See [`deployments/arc-testnet.json`](./deployments/arc-testnet.json) for the deprecated v0.1.0 addresses.

## Pool choice — why Saddle, not Curve

The original plan called for vendoring Curve's Vyper StableSwap. The Curve sources we tried (`curvefi/curve-contract` master) target Vyper 0.2.x, while only Vyper ≥0.3.10 is comfortably installable today. Rather than maintain an old toolchain, we vendored Saddle Finance's Solidity StableSwap port (MIT, last reviewed at upstream master before Saddle's archive). Math is the StableSwap invariant — equivalent behavior, native Foundry compile, no FFI.

## License

- Our code (`src/ArcFXGateway.sol`, `src/libraries/PriceGuard.sol`, scripts, tests): **MIT**
- Vendored Saddle pool (`src/pool/*`): **MIT** (preserved from upstream)
