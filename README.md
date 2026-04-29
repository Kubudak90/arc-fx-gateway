# Arcora

Stablecoin merchant checkout and FX settlement on [Arc Network](https://arc.network) — Circle's stablecoin-native L1. Merchants invoice in their preferred stable; customers can pay in USDC or EURC; the contract swaps and settles atomically in one transaction.

**One-line merchant integration:**
```ts
import { Arcora } from "@arcora/sdk";

Arcora.init({ apiKey });
const inv = await Arcora.createInvoice({ amountUsdc: 49.99, payInToken: "EURC", successUrl: "..." });
Arcora.openCheckout(inv);
```

## Live deployments

| | Where |
|---|---|
| **Demo merchant** | [`https://arc-fx-demo.vercel.app`](https://arc-fx-demo.vercel.app) — click "Pay €4.50" to try the full flow |
| **Live checkout app** | [`https://arc-fx-gateway.vercel.app`](https://arc-fx-gateway.vercel.app) — Vercel + Neon Postgres |
| **Server hot wallet** | [`0x74BB69F48d0dAddB17679534fDa1142c3ab66333`](https://testnet.arcscan.app/address/0x74BB69F48d0dAddB17679534fDa1142c3ab66333) — funds invoice creation gas |
| **Arcora Gateway v0.6** | [`0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3`](https://testnet.arcscan.app/address/0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3) |
| **OracleAMM** | [`0xC2020098aF328ac9CBD274267F424822C400dD66`](https://testnet.arcscan.app/address/0xC2020098aF328ac9CBD274267F424822C400dD66) |
| **MockChainlinkFeed (1.0863 EUR/USD)** | [`0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3`](https://testnet.arcscan.app/address/0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3) |

Sample transactions on the live deploy:

| Flow | Tx | Notes |
|---|---|---|
| Same-token USDC → USDC | [`0x3f2fc3ff…`](https://testnet.arcscan.app/tx/0x3f2fc3ff446c8a6b206197de3a6cf25226f2ca9c654e11b2b4548609b384ef08) | No swap; paid 0.999 USDC + 0.001 fee |
| Swap EURC → USDC | [`0xa35cdab6…`](https://testnet.arcscan.app/tx/0xa35cdab6d75e5538df32f998bb35b118b61d43d32e0c9a6a2605b61b54745ae8) | OracleAMM, 1-wei iterating estimator (v0.5 fix) |
| Refund (same-token) | [`0xa1a3471f…`](https://testnet.arcscan.app/tx/0xa1a3471fa4e3d69dc9e1274834343ab36707869b3d0547f867e8a17bdcc63188) | Customer gets payout back, merchant fee returned from accrued |
| Refund (swap) | [`0x2dc24ed9…`](https://testnet.arcscan.app/tx/0x2dc24ed9125b9d1bee4303ae5de3034f5e7834faf5b5962c2ccca7e90733cc42) | Refund delivered in payout token (USDC) regardless of original payIn (EURC) |

## What's in v1.0.x

The first shippable Arcora release. Scope: **Arc-only USDC/EURC checkout** with one swap pool, one Chainlink oracle, hosted checkout + merchant dashboard, npm-published SDK, refund flow, and a per-merchant treasury view. Crosschain payment (any chain CCTP supports) is the v2.0 milestone.

Latest contract is **gateway v0.6** at [`0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3`](https://testnet.arcscan.app/address/0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3). Key features delivered across the v1.0.x line:

- **Namespaced invoice IDs.** Merchants pass their own `merchantInvoiceId`; the contract derives a global ID via `keccak256(merchantAddress, merchantInvoiceId)` so two merchants reusing the same order ID can't collide.
- **Merchant struct expansion.** Separate `payoutAddress` from `msg.sender`, plus an `active` flag. Wallet/payout rotation no longer requires re-deploying. New methods: `updatePayoutAddress`, `updatePayoutToken`, `deactivateMerchant`.
- **Same-token direct payment.** When the customer pays in the merchant's payout token (e.g. USDC → USDC), `pay()` skips the swap path entirely.
- **Event split.** `InvoicePaid` emits `(amountIn, grossReceived, merchantPayout, fee)` so indexers record gross/net without arithmetic.
- **Locked payout token.** Each invoice records the payout token at creation; later `updatePayoutToken` calls don't reroute pending invoices.
- **Iterating swap-input estimator** (v0.5). Linear inverse of the pool's forward quote walks 1 wei at a time until the swap actually delivers `merchantPayout`; cures the 1-wei `InsufficientOutput` revert that bit live EURC→USDC payments before.
- **Refunds** (v0.6). `refundInvoice(globalId)` callable by merchant or owner. Pulls the original `merchantPayout` from the merchant's wallet via `transferFrom`, forwards to the customer, and returns the protocol fee from accrued back to the merchant. Refund always settles in the payout token regardless of original payIn.
- **Treasury dashboard** at `/m/treasury` — per-stable KPI cards (net received, gross volume, refunded, fees) + activity feed.

Operational hardening on top of the contract:

- Long-running VPS daemons replace Vercel cron for chain → DB indexing (`arcora-indexer.service`, 30s tick) and HMAC webhook delivery (`arcora-webhooks.service`, 10s tick). Vercel handles only the request-path API.
- Chunked indexer (9k blocks per pass) so a missed tick can't push the next run past the RPC's `eth_getLogs` cap.

## Roadmap

```
v1.0   live   Arc-only USDC/EURC checkout + refunds + treasury + npm SDK
v1.x   next   Any stablecoin on Arc — USDT, PYUSD, DAI, regional fiat-pegged
                (spec: docs/superpowers/specs/2026-04-29-plan-3-multi-stablecoin.md)
v2.0   next   Crosschain USDC source via CCTP — Ethereum, Arbitrum, Base,
                Optimism, Polygon, Avalanche, Linea, Codex
v2.1   later  + source-side DEX aggregator (Odos / 1inch) so customers can
                pay in native ETH or any ERC-20
v2.2   later  + Solana / Sui / non-EVM
v3.0   later  Intent / solver model — one signature, full route executed
```

The killer-feature bet: **customer pays from where they are with what they have, merchant settles in their preferred stable on Arc**. v1 is Arc-only as a proving ground; v2 ships the differentiator. Public version of this is on the landing page at [arc-fx-gateway.vercel.app/#roadmap](https://arc-fx-gateway.vercel.app/#roadmap).

## Packages

| Package | Description |
|---------|-------------|
| [`@arcora/sdk`](packages/sdk/) | npm SDK — three-function client, ~1.5 KB gzipped |
| [`@arcora/sdk-react`](packages/sdk-react/) | React hook + button component |
| [`@arcora/app`](packages/app/) | Next.js 15 hosted checkout + merchant dashboard |
| [`@arcora/contracts`](packages/contracts/) | Solidity contracts (Foundry, 99 tests passing) |
| [`@arcora/demo-merchant`](packages/demo-merchant/) | Vite app integrating the SDK in ~5 lines |

## Architecture

- **OracleAMM**: Chainlink-priced two-token AMM for USDC ⇄ EURC. No bonding curve, no impermanent loss inside oracle range. Trades execute at oracle ± 4 bps fee.
- **Arcora Gateway v0.4**: Immutable contract holding merchant registry, invoice state, atomic swap-and-settle. Supports `createInvoiceFor` + on-chain delegate authorization so a server hot wallet can submit invoices on behalf of merchants.
- **PriceGuard**: Library that rejects swaps deviating >0.5% from the Chainlink reference rate (defense-in-depth).
- **Hosted app**: Next.js 15 with Neon Postgres mirror.
- **Ops layer**: VPS systemd daemons under `ops/indexer/` and `ops/webhooks/` mirror to `/root/arcora-ops/` on the production VPS. The daemons own state-machine progress, chain-event ingestion, and webhook retries with exponential backoff.

## Test status

| Suite | Tests |
|-------|-------|
| Contracts (Foundry) | 117 passing — unit + fuzz (10k runs) + invariant (256×64) + deploy scripts; refund + 1-wei estimator regressions covered |
| App (vitest) | 46 passing — auth, crypto, schema, API routes (incl. treasury aggregator), UI components |
| App (Playwright E2E) | 5 critical flows passing (the 6th retired with the Vercel cron route) |
| SDK (vitest) | 8 passing |
| @arcora/sdk-react (vitest) | 3 passing |

## Specs and plans

- [Plan 1 spec — protocol design](docs/superpowers/specs/2026-04-24-arc-fx-merchant-gateway-design.md)
- [Plan 1 plan — 17 tasks](docs/superpowers/plans/2026-04-24-plan-1-protocol.md)
- [Plan 2 spec — SDK + Checkout design](docs/superpowers/specs/2026-04-25-plan-2-sdk-checkout-design.md)
- [Plan 2a — backend foundation (12 tasks)](docs/superpowers/plans/2026-04-25-plan-2a-foundation.md)
- [Plan 2b spec — frontend design](docs/superpowers/specs/2026-04-25-plan-2b-frontend-design.md)
- [Plan 2b — frontend (14 tasks)](docs/superpowers/plans/2026-04-25-plan-2b-frontend.md)

## Local development

```bash
pnpm install
docker compose -f packages/app/docker-compose.yml up -d postgres
cp packages/app/.env.example packages/app/.env
# fill MASTER_KEY, IRON_SESSION_PASSWORD, CRON_SECRET
pnpm --filter @arcora/app db:push
pnpm --filter @arcora/app dev
```

Visit http://localhost:3000.

For full setup (server hot wallet, Vercel deploy), see [`packages/app/README.md`](packages/app/README.md).

## Releasing

See [`RELEASING.md`](RELEASING.md) for SDK npm publish + Vercel deploy + tag steps.

## License

MIT — see [`LICENSE`](LICENSE). Vendored Saddle StableSwap (in `packages/contracts/src/pool/`) is also MIT (preserved from upstream).
