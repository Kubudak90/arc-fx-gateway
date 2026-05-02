# Arcora

Stablecoin merchant checkout and FX settlement on [Arc Network](https://arc.network) — Circle's stablecoin-native L1. Merchants invoice in their preferred stable; customers sign a single Permit2 message (no transaction, no gas); Arcora's relayer pulls the funds, runs the swap on Arc's App Kit Swap, and pays the merchant — sub-30s end-to-end.

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
| **Hosted checkout** | [`https://arcorapay.xyz`](https://arcorapay.xyz) (also `arc-fx-gateway.vercel.app`) — Vercel + Neon Postgres |
| **Server hot wallet** | [`0x74BB69F48d0dAddB17679534fDa1142c3ab66333`](https://testnet.arcscan.app/address/0x74BB69F48d0dAddB17679534fDa1142c3ab66333) — funds invoice creation gas |
| **Relayer hot wallet** | [`0xe8E5AAa3d8c705A07de02aADF98CE31F20A5754b`](https://testnet.arcscan.app/address/0xe8E5AAa3d8c705A07de02aADF98CE31F20A5754b) — pulls Permit2 funds, runs `kit.swap`, calls `settleInvoice` |
| **ArcFXGateway v0.8.1** | [`0x6fAaD920b329d0c3eAb700f2BceE6A4ec5d507a8`](https://testnet.arcscan.app/address/0x6fAaD920b329d0c3eAb700f2BceE6A4ec5d507a8) — current Permit2 + relayer-driven gateway |
| **ArcFXGateway v0.6** (legacy) | [`0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3`](https://testnet.arcscan.app/address/0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3) — kept live during v0.8 cutover |
| **Permit2** | [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://testnet.arcscan.app/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) — Uniswap canonical, used for the customer's gas-less authorization |
| **FxEscrow** (StableFX) | [`0x867650F5eAe8df91445971f14d89fd84F0C9a9f8`](https://testnet.arcscan.app/address/0x867650F5eAe8df91445971f14d89fd84F0C9a9f8) — Arc's RFQ escrow that App Kit Swap settles through |

Sample transactions on the live deploy:

| Flow | Tx | Notes |
|---|---|---|
| v0.8 settle (USDC → EURC) | [`0xc414f1fb…`](https://testnet.arcscan.app/tx/0xc414f1fb425849cc0d15627493c69baa2043f82e85ff2228f7e81f37e7f2956e) | Customer signed Permit2; relayer ran kit.swap + settleInvoice. Merchant got exactly `amountOut − fee` |
| v0.8.1 deterministic settle | [`0x0b84712b…`](https://testnet.arcscan.app/tx/0x0b84712bce4f259da4bef8ea4a180d742ca94ebcb1123e3c7971d98bad13c284) | Excess from rate-favorable swap goes to protocol bucket; merchant payout fixed |
| Same-token USDC → USDC (v0.6) | [`0x3f2fc3ff…`](https://testnet.arcscan.app/tx/0x3f2fc3ff446c8a6b206197de3a6cf25226f2ca9c654e11b2b4548609b384ef08) | No swap; legacy in-contract path |
| Refund (v0.6) | [`0xa1a3471f…`](https://testnet.arcscan.app/tx/0xa1a3471fa4e3d69dc9e1274834343ab36707869b3d0547f867e8a17bdcc63188) | Customer gets payout back, merchant fee returned from accrued |

## What's in v0.8.1

The current production release. Scope: **Arc-only USDC/EURC checkout** with the customer signing a single Permit2 EIP-712 message (no transaction), Arcora's relayer driving Circle's App Kit Swap on Arc, and a thin v0.8 gateway that delivers a deterministic merchant payout. Crosschain payment (any chain App Kit Bridge supports) is the v2.0 milestone.

Latest contract is **ArcFXGateway v0.8.1** at [`0x6fAaD920b329d0c3eAb700f2BceE6A4ec5d507a8`](https://testnet.arcscan.app/address/0x6fAaD920b329d0c3eAb700f2BceE6A4ec5d507a8). What's delivered:

- **Permit2 customer flow.** Customer signs one EIP-712 message authorising the relayer to pull `amountIn` of `payInToken`. No on-chain transaction on their side, no gas. Replaces the v0.6 atomic `pay()` path.
- **Relayer-driven settlement.** `ops/relayer/run.ts` watches a `relayer_queue` table; on each row pulls Permit2 funds → `kit.swap()` on Arc → calls `gateway.settleInvoice()`. Refund path triggers if the swap fails.
- **Deterministic merchant payout.** `settleInvoice` always sends the merchant **exactly `amountOut − fee`** in the payout token, regardless of how favourably the swap rate moved. Excess accrues to the protocol fee bucket and offsets the rate-unfavourable cases that revert with a payer refund. Merchant gets a Stripe-shaped predictable amount.
- **Built on Arc primitives.** `kit.swap()` settles through Arc's RFQ-backed maker network and StableFX `FxEscrow`; we don't run our own AMM or oracle anymore. The v0.7 in-house pool work is archived in `feat/v0.7-shared-vault-pool` as a reference implementation.
- **Refund flow preserved.** `refundInvoice(globalId)` callable by merchant or admin. Pulls `merchantPayout` from the merchant's wallet via `transferFrom`, forwards to the customer, returns the protocol fee from accrued.
- **Stuck-payment recovery.** `recordPayerRefund(...)` flips an invoice to `failed` status when the relayer auto-refunds the customer off-chain after a swap failure. Indexer + webhooks pick it up and surface a terminal state to the merchant.
- **Engine cutover.** `/api/invoices?engine=v8` opt-in routes new invoices to the v0.8 gateway; default still creates v0.6 invoices during the migration window.
- **Hosted checkout UI.** `/i/[invoiceId]` reads `metadata.engine` and renders the right PayButton — v0.8 path shows quote with TTL countdown, Permit2 first-time-setup banner, and a granular settling progress list.
- **Treasury dashboard** at `/m/treasury` — per-stable KPI cards (net received, gross volume, refunded, fees) + 30-day activity chart with hover tooltip.

Operational hardening on top of the contract:

- Long-running VPS daemons replace Vercel cron for chain → DB indexing (`arcora-indexer.service`, 30s tick), HMAC webhook delivery (`arcora-webhooks.service`, 10s tick), and the new v0.8 settle pipeline (`arcora-relayer.service`, 5s tick).
- Indexer watches **both v0.6 and v0.8.1 gateways simultaneously** during cutover (set via `GATEWAY_ADDRESS_V8`), decoding the new `SettlementContext` and `PayerRefunded` events alongside the legacy ones.
- Chunked indexer (9k blocks per pass) so a missed tick can't push the next run past the RPC's `eth_getLogs` cap.

## Roadmap

```
v0.8   live   Permit2 + App Kit Swap — customer signs once, relayer settles
                (spec: docs/superpowers/specs/2026-05-01-plan-6-stablefx-integration.md)
v1.0   live   Hosted checkout, merchant dashboard, refunds, treasury, npm SDK
v1.x   next   Compliance hooks — Elliptic / TRM Labs adapters; pre-mainnet bar
                (spec: docs/superpowers/specs/2026-05-01-plan-5-compliance-hooks.md)
v2.0   next   Crosschain checkout via App Kit Bridge — Ethereum, Arbitrum,
                Base, Optimism, Polygon, Avalanche, Linea
                (spec: docs/superpowers/specs/2026-04-30-plan-4-crosschain-checkout.md)
v2.1   later  + source-side DEX aggregator (Odos / 1inch) so customers can
                pay in native ETH or any ERC-20
v2.2   later  + Solana / non-EVM via App Kit's Solana adapter
v3.0   later  Intent / solver model — one signature, full route executed
```

The killer-feature bet: **customer pays from where they are with what they have, merchant settles in their preferred stable on Arc**. v0.8 + v1 are Arc-only as a proving ground; v2 ships the crosschain differentiator. Public version of this is on the landing page at [arcorapay.xyz/#roadmap](https://arcorapay.xyz/#roadmap).

## Packages

| Package | Description |
|---------|-------------|
| [`@arcora/sdk`](packages/sdk/) | npm SDK — three-function client, ~1.5 KB gzipped |
| [`@arcora/sdk-react`](packages/sdk-react/) | React hook + button component |
| [`@arcora/app`](packages/app/) | Next.js 15 hosted checkout + merchant dashboard |
| [`@arcora/contracts`](packages/contracts/) | Solidity contracts (Foundry, 99 tests passing) |
| [`@arcora/demo-merchant`](packages/demo-merchant/) | Vite app integrating the SDK in ~5 lines |

## Architecture

- **ArcFXGateway v0.8.1**: Thin escrow + invoice-state contract. No FX logic, no oracle, no pool. Roles: `DEFAULT_ADMIN_ROLE` (owner) and `RELAYER_ROLE` (the Arcora hot wallet authorised to call `settleInvoice`). Key methods: `createInvoice`, `settleInvoice`, `recordPayerRefund`, `refundInvoice`. Supports `createInvoiceFor` + on-chain delegate authorization so a server hot wallet can submit invoices on behalf of merchants.
- **App Kit Swap**: Circle's RFQ-backed swap module on Arc. We call `kit.swap(USDC → EURC)` (or vice versa) from the relayer; the underlying execution settles through Arc's `FxEscrow` and the Permit2-routed maker network. We do not run our own AMM.
- **Permit2**: Uniswap's universal signature-transfer contract (canonical at `0x000000000022D473…`). Customer signs an EIP-712 `PermitWitnessTransferFrom` authorising the relayer to pull `amountIn` of `payInToken`. Witness binds the signature to a specific `(invoiceId, relayer)` so a captured signature can't replay against a different trade.
- **Arcora relayer** (`ops/relayer/run.ts`): Long-running daemon that drains `relayer_queue`, pulls Permit2 funds, runs `kit.swap`, calls `settleInvoice`. Refund path triggers if the swap fails.
- **Hosted app**: Next.js 15 with Neon Postgres mirror.
- **Ops layer**: VPS systemd daemons under `ops/indexer/`, `ops/webhooks/`, and `ops/relayer/` mirror to `/root/arcora-ops/` on the production VPS. The daemons own state-machine progress, chain-event ingestion, swap orchestration, and webhook retries with exponential backoff.

### How Arcora relates to Arc primitives

Arc itself ships several first-party financial primitives — **StableFX** (RFQ-style FX with on-chain escrow), **App Kit Swap / Bridge / Send** (general-purpose stable transfer + crosschain primitives), **Circle Developer-Controlled Wallets** (server-side wallet issuance), and **Refund Protocol** (programmable refund logic). All of these are documented at [docs.arc.network](https://docs.arc.network).

Arcora is **not** a competitor to those primitives. Where Arc gives you the rails, Arcora is the **merchant abstraction layer** that sits above them. v0.8.1 takes this seriously and delegates the FX layer to App Kit Swap rather than running an in-house pool:

| Concern | Arc primitive | Arcora |
|---|---|---|
| Enterprise FX (RFQ + escrow) | StableFX (`FxEscrow`) | — (used indirectly through App Kit) |
| Generic A→B swap | App Kit Swap (`kit.swap`) | **drives via the relayer** |
| Crosschain USDC bridge | App Kit Bridge (CCTP wrapper) | planned for v2.0 |
| Server-managed wallets | Circle Developer-Controlled Wallets | — (we run our own hot wallet for now) |
| Customer gas-less authorization | Permit2 | **drives via the SDK + PayButton** |
| Invoice lifecycle + deterministic merchant payout | — | **`ArcFXGateway` (`settleInvoice`, `refundInvoice`)** |
| Hosted checkout link + customer wallet flow | — | `/i/[invoiceId]` page + SIWE |
| Refund-in-payout-token + protocol-fee return | — | `refundInvoice()` |
| Per-merchant treasury reconciliation | — | `/m/treasury` + indexer |
| Three-line npm SDK | — | `@arcora/sdk` |

The shape is what payment processors (Stripe, Adyen, Checkout.com) provide on top of card-network rails. We provide the same shape on top of Arc's stablecoin rails. v2.0 will delegate the *crosschain leg* of the flow to App Kit Bridge — see the v2.0 plan in `docs/superpowers/specs/2026-04-30-plan-4-crosschain-checkout.md`.

**Native Arc resources we depend on**:
- USDC (`0x3600…0000`) and EURC (`0x89B5…D72a`) contracts — official addresses from the Arc docs.
- USDC as native gas token (18-decimal native balance, 6-decimal ERC-20 interface).
- Sub-second deterministic finality (Malachite BFT consensus).

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

MIT — see [`LICENSE`](LICENSE). v0.8.1 delegates the FX leg to Circle's App Kit Swap and does not run an in-house pool; the legacy pool work under `packages/contracts/src/pool/` is unused, kept only as a reference implementation for the v1.x shared-vault track.
