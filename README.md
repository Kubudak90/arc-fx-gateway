# Arc FX Gateway

Permissionless USDC ⇄ EURC payments on [Arc Network](https://arc.network) — Circle's stablecoin-native L1.

**One-line merchant integration:**
```ts
ArcFX.init({ apiKey });
const inv = await ArcFX.createInvoice({ amountUsdc: 49.99, payInToken: "EURC", successUrl: "..." });
ArcFX.openCheckout(inv);
```

## Live deployments

| | Where |
|---|---|
| **Demo merchant** | [`https://arc-fx-demo.vercel.app`](https://arc-fx-demo.vercel.app) — click "Pay €4.50" to try the full flow |
| **Live checkout app** | [`https://arc-fx-gateway.vercel.app`](https://arc-fx-gateway.vercel.app) — Vercel + Neon Postgres |
| **Server hot wallet** | [`0x74BB69F48d0dAddB17679534fDa1142c3ab66333`](https://testnet.arcscan.app/address/0x74BB69F48d0dAddB17679534fDa1142c3ab66333) — funds invoice creation gas |
| **ArcFXGateway v0.3** | [`0x54bDe75530984F4add34Ac14f3d6fd2a515E50AF`](https://testnet.arcscan.app/address/0x54bDe75530984F4add34Ac14f3d6fd2a515E50AF) |
| **OracleAMM** | [`0xC2020098aF328ac9CBD274267F424822C400dD66`](https://testnet.arcscan.app/address/0xC2020098aF328ac9CBD274267F424822C400dD66) |
| **MockChainlinkFeed (1.0863 EUR/USD)** | [`0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3`](https://testnet.arcscan.app/address/0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3) |

Smoke-test transaction (Plan 1.5 happy path): [`0x31ddbf35…1c2064a`](https://testnet.arcscan.app/tx/0x31ddbf35ff03918fe2b4aad870f6c6a1185737a7c84643893fc2bf0bd1c2064a) — 0.1 EURC → 0.108587 USDC at the real 1.0863 EUR/USD rate.

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
- **ArcFXGateway v0.3**: Immutable contract holding merchant registry, invoice state, atomic swap-and-settle. Adds `createInvoiceFor` + on-chain delegate authorization so a server hot wallet can submit invoices on behalf of merchants.
- **PriceGuard**: Library that rejects swaps deviating >0.5% from the Chainlink reference rate (defense-in-depth).
- **Hosted app + cron jobs**: Next.js 15 with Vercel Postgres mirror; Vercel Cron at 1-minute granularity for chain → DB sync and HMAC-signed webhook delivery.

## Test status

| Suite | Tests |
|-------|-------|
| Contracts (Foundry) | 69 passing — unit + fuzz (10k runs) + invariant (256×64) + deploy scripts |
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
