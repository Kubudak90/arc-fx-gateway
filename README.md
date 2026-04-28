# Arcora

Stablecoin merchant checkout and FX settlement on [Arc Network](https://arc.network) — Circle's stablecoin-native L1. Merchants invoice in USDC; customers can pay with USDC or EURC; the contract swaps and settles atomically in one transaction.

**One-line merchant integration:**
```ts
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
| **Arcora Gateway v0.4** | [`0xA80A5741a09bff1f43dcBF15Df7c598A23163302`](https://testnet.arcscan.app/address/0xA80A5741a09bff1f43dcBF15Df7c598A23163302) |
| **OracleAMM** | [`0xC2020098aF328ac9CBD274267F424822C400dD66`](https://testnet.arcscan.app/address/0xC2020098aF328ac9CBD274267F424822C400dD66) |
| **MockChainlinkFeed (1.0863 EUR/USD)** | [`0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3`](https://testnet.arcscan.app/address/0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3) |

Smoke-test transaction (v0.2 happy path, real rate): [`0x31ddbf35…1c2064a`](https://testnet.arcscan.app/tx/0x31ddbf35ff03918fe2b4aad870f6c6a1185737a7c84643893fc2bf0bd1c2064a) — 0.1 EURC → 0.108587 USDC at the real 1.0863 EUR/USD rate.

## What's new in v0.4

The contract was bumped after a structured review surfaced edge cases worth fixing before iterating further:

- **Namespaced invoice IDs.** Merchants pass their own `merchantInvoiceId` (e.g. `ORDER-1024`); the contract derives a global ID via `keccak256(merchantAddress, merchantInvoiceId)`, so two merchants reusing the same order ID can no longer collide.
- **Merchant struct expansion.** Separate `payoutAddress` (where money lands) from `msg.sender` (control), plus an `active` flag. New methods: `updatePayoutAddress`, `updatePayoutToken`, `deactivateMerchant`. Wallet rotation no longer requires re-deploying.
- **Same-token direct payment.** When a customer pays in the same token the merchant takes (USDC → USDC), `pay()` skips the swap path entirely — no AMM round-trip, no slippage cushion.
- **Event split.** `InvoicePaid` now emits `(amountIn, grossReceived, merchantPayout, fee)` separately, so indexers can record the gross/net distinction without arithmetic.
- **Locked payout token.** Each invoice records the merchant's `payoutToken` at creation time; later `updatePayoutToken` calls don't reroute pending invoices.

Plus a chunked indexer (9k blocks per pass) so missed cron ticks can't push the next run past the RPC's `eth_getLogs` cap.

## Packages

| Package | Description |
|---------|-------------|
| [`@arc-fx/checkout`](packages/sdk/) | npm SDK — three-function client library, ~1.5 KB |
| [`@arc-fx/checkout-react`](packages/sdk-react/) | React hook + button component |
| [`@arc-fx/app`](packages/app/) | Next.js 15 hosted checkout + merchant dashboard |
| [`@arc-fx/contracts`](packages/contracts/) | Solidity contracts (Foundry, 69 tests passing) |
| [`@arc-fx/demo-merchant`](packages/demo-merchant/) | Vite app integrating the SDK in 3 lines |

## Architecture

- **OracleAMM**: Chainlink-priced two-token AMM for USDC ⇄ EURC. No bonding curve, no impermanent loss inside oracle range. Trades execute at oracle ± 4 bps fee.
- **Arcora Gateway v0.4**: Immutable contract holding merchant registry, invoice state, atomic swap-and-settle. Supports `createInvoiceFor` + on-chain delegate authorization so a server hot wallet can submit invoices on behalf of merchants. v0.4 adds namespaced invoice IDs, merchant updates, same-token direct payment, and a 6-field `InvoicePaid` event (see "What's new in v0.4" above).
- **PriceGuard**: Library that rejects swaps deviating >0.5% from the Chainlink reference rate (defense-in-depth).
- **Hosted app + cron jobs**: Next.js 15 with Neon Postgres mirror; Vercel Cron at 1-minute granularity for chain → DB sync (chunked 9k blocks per tick to stay inside the testnet RPC's `eth_getLogs` cap) and HMAC-signed webhook delivery.

## Test status

| Suite | Tests |
|-------|-------|
| Contracts (Foundry) | 99 passing — unit + fuzz (10k runs) + invariant (256×64) + deploy scripts |
| App (vitest) | 42 passing — auth, crypto, schema, API routes, cron, UI components |
| App (Playwright E2E) | 6/6 critical flows passing |
| SDK (vitest) | 8 passing |
| SDK-React (vitest) | 3 passing |

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
pnpm --filter @arc-fx/app db:push
pnpm --filter @arc-fx/app dev
```

Visit http://localhost:3000.

For full setup (server hot wallet, Vercel deploy), see [`packages/app/README.md`](packages/app/README.md).

## License

MIT for our code; vendored Saddle StableSwap (in `packages/contracts/src/pool/`) is also MIT (preserved from upstream).
