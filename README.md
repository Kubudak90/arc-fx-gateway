# Arcora

Stablecoin merchant checkout and FX settlement on [Arc Network](https://arc.network) — Circle's stablecoin-native L1. Merchants invoice in their preferred stable; customers sign a single Permit2 message (no transaction, no gas); Arcora's relayer pulls the funds, runs the swap on Arc's App Kit Swap, and settles into a per-invoice custody escrow inside the gateway. Funds become claimable to the merchant after a 7-day refund window — sub-30s end-to-end, refunds with no merchant approval.

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
| **Hosted checkout** | [`https://arcorapay.xyz`](https://arcorapay.xyz) — Vercel + Supabase Postgres |
| **Server hot wallet** | [`0x74BB69F48d0dAddB17679534fDa1142c3ab66333`](https://testnet.arcscan.app/address/0x74BB69F48d0dAddB17679534fDa1142c3ab66333) — funds invoice creation gas |
| **Relayer hot wallet** | [`0x29EcFedDF31E4dA4a62b89bADe35b224cE144DAE`](https://testnet.arcscan.app/address/0x29EcFedDF31E4dA4a62b89bADe35b224cE144DAE) — pulls Permit2 funds, runs `kit.swap`, calls `settleInvoice` |
| **ArcFXGateway** | [`0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3`](https://testnet.arcscan.app/address/0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3) — custody-escrow gateway (audit-fixed bytecode, deployed 2026-05-13) |
| **Permit2** | [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://testnet.arcscan.app/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) — Uniswap canonical, used for the customer's gas-less authorization |
| **FxEscrow** (StableFX) | [`0x867650F5eAe8df91445971f14d89fd84F0C9a9f8`](https://testnet.arcscan.app/address/0x867650F5eAe8df91445971f14d89fd84F0C9a9f8) — Arc's RFQ escrow that App Kit Swap settles through |

All prior gateway deployments (v0.6 – v1.1) remain on-chain but are no longer watched — testnet was wiped on 2026-05-20 and there are no in-flight invoices on those addresses. The canonical record is `packages/contracts/deployments/arc-testnet.json`.

## What's in v1.2

The current production release. Scope: **Arc-only USDC/EURC checkout** with the customer signing a single Permit2 EIP-712 message (no transaction), Arcora's relayer driving Circle's App Kit Swap on Arc, and a custody-escrow gateway that holds the merchant's payout for 7 days before it can be claimed. Crosschain payment (any chain App Kit Bridge supports) is the v2.0 milestone — see `docs/ROADMAP.md`.

The current contract is **ArcFXGateway** at [`0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3`](https://testnet.arcscan.app/address/0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3). What's delivered:

- **Permit2 customer flow.** Customer signs one EIP-712 message authorising the relayer to pull `amountIn` of `payInToken`. No on-chain transaction on their side, no gas.
- **Relayer-driven settlement.** `ops/relayer/run.ts` watches a `relayer_queue` table; on each row pulls Permit2 funds → `kit.swap()` on Arc → calls `gateway.settleInvoice()`. Refund branch triggers if the swap fails.
- **Custody escrow.** `settleInvoice` deposits the merchant's exact payout (`amountOut − fee`) into `escrows[globalId]` inside the gateway, with `claimableAt = now + 7 days`. Excess from a favourable swap rate accrues to `protocolFeesAccrued[token]`.
- **Refunds without merchant approval.** During the 7-day window, `refundInvoice(globalId)` drains the escrow back to the customer — no ERC-20 allowance from the merchant wallet required, no protocol fee retained.
- **Permissionless claim.** After the 7-day window, anyone can call `claim(bytes32[])` to release matured escrows to the merchant payout address. Fee is accrued at claim time, not settle time.
- **Admin recovery.** `adminRecoverEscrow(globalIds[], to)` lets the admin sweep escrows from a merchant deactivated for ≥ 14 days. Bounded by `merchant.deactivatedAt`.
- **Server delegate.** `authorizeDelegate(delegate, expiresAt, rights)` with bit-flag scope (`RIGHT_CREATE_INVOICE | RIGHT_REFUND`) lets a server hot wallet submit invoices on the merchant's behalf via `createInvoiceFor`.
- **Hosted checkout UI.** `/i/[invoiceId]` shows the quote with a TTL countdown, a Permit2 first-time-setup banner, and a granular settling progress list.
- **Treasury dashboard** at `/m/treasury` — per-stable KPI cards (net received, gross volume, refunded, fees) + 30-day activity chart with hover tooltip, and a **Claim** section for matured escrows.

Production hardening on top of the contract (v1.2 audit pass):

- Long-running VPS daemons replace Vercel cron for chain → DB indexing (`arcora-indexer.service`, 30s tick), HMAC webhook delivery (`arcora-webhooks.service`, 10s tick), and the settle pipeline (`arcora-relayer.service`, 5s tick).
- Per-IP rate limiting on `/api/checkout/{authorize,submit}` and `/api/invoices`, backed by a Postgres token-bucket.
- Constant-time secret comparison on the `CRON_SECRET` path.
- Server-side Permit2 EIP-712 signature verification in `/api/checkout/submit` before any queue row is written.
- SSRF + `https://` guard on merchant `successUrl` / `cancelUrl` / `webhookUrl`.
- Stale-processing lease on the relayer queue — a crashed worker's row is reclaimable instead of stuck.
- Vault-managed relayer signer with daily secret-id rotation (see `docs/runbooks/vault-recovery.md`).

## Roadmap

The forward roadmap, operational hygiene, and consciously-deferred audit Low backlog all live in **[`docs/ROADMAP.md`](docs/ROADMAP.md)**. Summary:

| Phase | Ships |
|---|---|
| **v1.2** (current) | Custody-escrow gateway live on Arc testnet; production hardening (audit fixes, rate limits, Permit2 verification tests, SSRF guard, a11y). USDC/EURC only (App Kit Swap testnet limit). |
| **v2.0** (next) | Crosschain USDC source via Arc App Kit Bridge (Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, Linea, Codex). Q1 v2.0 implementation plan lives at `docs/superpowers/plans/2026-06-08-q1-cross-chain-v2-code-spine.md`; it starts with Base/Ethereum demo routes, keeps source-chain expansion behind feature flags, and preserves the merchant payout-token invariant. |
| **v2.1** | Source-side aggregator — customer pays in any token on the source chain via Odos/1inch/0x/Paraswap. |
| **v2.2** | Non-EVM sources (Solana, Sui). |
| **v3.0** | Intent / solver model. One-signature one-click; Arcora's solver executes the full route. |

A pre-mainnet checklist (external audit RFP, multisig admin, KYB go-live, Vault hardening, real Chainlink feeds, compliance provider flip, mainnet manifest, Immunefi bounty) is tracked in the same doc and triggered by Arc Network mainnet launch *or* first paying merchant *or* funding round close — whichever comes first.

Public version of this is on the landing page at [arcorapay.xyz/#roadmap](https://arcorapay.xyz/#roadmap).

## Packages

| Package | Description |
|---------|-------------|
| [`@arcora/sdk`](packages/sdk/) | npm SDK — three-function client, ~1.5 KB gzipped |
| [`@arcora/sdk-react`](packages/sdk-react/) | React hook + button component |
| [`@arcora/app`](packages/app/) | Next.js 15 hosted checkout + merchant dashboard |
| [`@arcora/contracts`](packages/contracts/) | Solidity contracts (Foundry, 77 tests passing) |
| [`@arcora/demo-merchant`](packages/demo-merchant/) | Vite app integrating the SDK in ~5 lines |
| [`@arcora/shop`](packages/shop/) | Storefront dogfooding the checkout — `arcora-shop.vercel.app` |

## Architecture

- **ArcFXGateway**: Custody-escrow invoice contract. No FX logic, no oracle, no pool. Roles: `DEFAULT_ADMIN_ROLE` (owner) and `RELAYER_ROLE` (the Arcora hot wallet authorised to call `settleInvoice`). Key methods: `createInvoice`, `createInvoiceFor`, `settleInvoice`, `recordPayerRefund`, `refundInvoice`, `claim`, `adminRecoverEscrow`, `authorizeDelegate`. Funds sit in per-invoice escrow inside the contract for 7 days; refunds drain straight from escrow.
- **App Kit Swap**: Circle's RFQ-backed swap module on Arc. We call `kit.swap(USDC → EURC)` (or vice versa) from the relayer; the underlying execution settles through Arc's `FxEscrow` and the Permit2-routed maker network. We do not run our own AMM.
- **Permit2**: Uniswap's universal signature-transfer contract (canonical at `0x000000000022D473…`). Customer signs an EIP-712 `PermitWitnessTransferFrom` authorising the relayer to pull `amountIn` of `payInToken`. Witness binds the signature to a specific `(invoiceId, relayer, payIn, amountIn)` so a captured signature can't replay against a different trade.
- **Arcora relayer** (`ops/relayer/run.ts`): Long-running daemon that drains `relayer_queue`, pulls Permit2 funds, runs `kit.swap`, calls `settleInvoice`. Refund branch triggers if the swap fails. Secret-id rotated daily via Vault.
- **Hosted app**: Next.js 15 with Supabase Postgres mirror.
- **Ops layer**: VPS systemd daemons under `ops/indexer/`, `ops/webhooks/`, and `ops/relayer/` mirror to `/root/arcora-ops/` on the production VPS. The daemons own state-machine progress, chain-event ingestion, swap orchestration, and webhook retries with exponential backoff.

### How Arcora relates to Arc primitives

Arc itself ships several first-party financial primitives — **StableFX** (RFQ-style FX with on-chain escrow), **App Kit Swap / Bridge / Send** (general-purpose stable transfer + crosschain primitives), **Circle Developer-Controlled Wallets** (server-side wallet issuance), and **Refund Protocol** (programmable refund logic). All of these are documented at [docs.arc.network](https://docs.arc.network).

Arcora is **not** a competitor to those primitives. Where Arc gives you the rails, Arcora is the **merchant abstraction layer** that sits above them. v1.2 takes this seriously and delegates the FX layer to App Kit Swap rather than running an in-house pool:

| Concern | Arc primitive | Arcora |
|---|---|---|
| Enterprise FX (RFQ + escrow) | StableFX (`FxEscrow`) | — (used indirectly through App Kit) |
| Generic A→B swap | App Kit Swap (`kit.swap`) | **drives via the relayer** |
| Crosschain USDC bridge | App Kit Bridge (CCTP wrapper) | planned for v2.0 |
| Server-managed wallets | Circle Developer-Controlled Wallets | — (we run our own hot wallet for now) |
| Customer gas-less authorization | Permit2 | **drives via the SDK + PayButton** |
| Invoice lifecycle + custody escrow + deterministic payout | — | **`ArcFXGateway` (`settleInvoice`, `claim`, `refundInvoice`)** |
| Hosted checkout link + customer wallet flow | — | `/i/[invoiceId]` page + SIWE |
| Refund-in-payout-token from custody escrow | — | `refundInvoice()` |
| Per-merchant treasury reconciliation | — | `/m/treasury` + indexer |
| Three-line npm SDK | — | `@arcora/sdk` |

The shape is what payment processors (Stripe, Adyen, Checkout.com) provide on top of card-network rails. We provide the same shape on top of Arc's stablecoin rails. v2.0 will delegate the *crosschain leg* of the flow to App Kit Bridge — see `docs/ROADMAP.md`.

**Native Arc resources we depend on**:
- USDC (`0x3600…0000`) and EURC (`0x89B5…D72a`) contracts — official addresses from the Arc docs.
- USDC as native gas token (18-decimal native balance, 6-decimal ERC-20 interface).
- Sub-second deterministic finality (Malachite BFT consensus).

## Test status

| Suite | Tests |
|-------|-------|
| Contracts (Foundry) | 77 passing — unit + fuzz (10k runs) + invariant + deploy scripts |
| App (vitest) | 301 passing — auth, crypto, schema, API routes, UI components |
| App (Playwright E2E) | critical flows passing |
| SDK (vitest) | 17 passing |
| @arcora/sdk-react (vitest) | 6 passing |

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

MIT — see [`LICENSE`](LICENSE). Arcora delegates the FX leg to Circle's App Kit Swap and does not run an in-house pool; the legacy pool work under `packages/contracts/src/pool/` is kept only as a reference implementation for a future shared-vault track and is not on any execution path.
