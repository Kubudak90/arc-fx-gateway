# Plan 4 — v2.0 Crosschain checkout via App Kit Bridge

**Status:** spec; ready to implement after Plan 3 (multi-stablecoin) ships
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-04-30
**Depends on:** Plan 3 (multi-stablecoin shared-vault gateway v0.7)
**Replaces:** the "v2.0" notes that previously lived inside `roadmap_open_items.md` and the landing copy

---

## Why this is a separate plan

The earlier roadmap entry described v2.0 as "wire CCTP into the gateway" and assumed direct calls to Circle's `TokenMessenger` / `MessageTransmitter` contracts. That was correct in principle but wrong on tooling: Arc's official documentation routes all crosschain stablecoin transfers through **App Kit Bridge**, a higher-level wrapper that handles attestation polling, fee abstraction, and gas-on-destination automatically. Reading raw CCTP contracts on Arc when the docs say "use App Kit" is the same mistake as calling `lowlevel_solidity_assembly` instead of OpenZeppelin's audited helpers.

This plan rewrites v2.0 around App Kit, with raw CCTP only as a fallback if a specific feature isn't exposed.

---

## The pitch

Customer holds USDC on Ethereum / Base / Arbitrum / Optimism / Polygon / Avalanche / Linea / Codex. Merchant on Arc invoices in EURC (or whatever stable from the v0.7 registry). With one (or two) signatures the customer pays from their source-chain wallet; Arcora bridges via Circle, swaps on Arc through the v0.7 shared-vault pool, settles to the merchant's preferred stable, fires the same `InvoicePaid` event the v1 indexer already understands.

> "Customer pays from anywhere. Merchant settles on Arc."

---

## What lands

### Contract changes — minimal

Gateway v0.7 (from Plan 3) is **already token-agnostic**. v2.0 doesn't need a v0.8 contract at all if we structure the bridge as an off-chain orchestration that ends in a normal v0.7 `pay()` call from an Arcora-controlled relayer.

**Decision point:** Do we want an on-chain "intent" record so the customer can verify a quote will be honoured, or is an off-chain quote with on-chain reconciliation enough?

- **Off-chain intent** (recommended for v2.0): customer signs a payload off-chain (EIP-712), Arcora relayer executes the source bridge + Arc settlement. Quote is enforced by the relayer (and an on-chain `maxAmountIn`).
- **On-chain intent** (defer to v3): a proper intent contract on Arc holds quote parameters. Bigger surface, audit cost, complex state machine. Skip until v3.

We commit to **off-chain intent** for v2.0.

### App Kit usage

Per [Arc docs](https://docs.arc.network):

- **App Kit Bridge** (`bridge` primitive): handles CCTP burn + attestation + Arc mint. Abstracts the CCTP contracts (`TokenMessengerV2 0x8FE6…`, `MessageTransmitterV2 0xE737…`, etc.) into a single SDK call. Returns a job-id we can poll.
- **App Kit Send** (`send` primitive): basic source-chain ERC-20 transfer. Probably not needed — bridge implies transfer.
- **Unified Balance** (Circle Gateway, `GatewayWallet 0x0077…`, `GatewayMinter 0x0022…`): an upgrade path where the customer's USDC is already pre-deposited and instantly available on Arc without per-transaction bridging. Big UX win for repeat customers but requires the customer to opt-in to Gateway. Track separately as v2.1+.

The runtime path becomes:

```
1. Customer hits checkout for invoice X (merchant wants Y EURC on Arc)
2. Arcora SDK detects customer is on Ethereum / Base / etc, USDC balance present
3. Arcora computes a route quote:
     amountIn (source USDC)
       = quoteToCover(Y EURC on Arc + Arc-side swap fee + bridge fee + Arc gas)
4. Customer signs:
     a. ERC-20 approve(USDC, App Kit Bridge router, amountIn)
     b. EIP-712 intent (invoice id, maxAmountIn, deadline, recipient = Arcora relayer on Arc)
5. Arcora orchestrator:
     a. AppKit.bridge.send({ from: source, to: Arc, token: USDC, amount: amountIn })
     b. polls until USDC lands on Arc (App Kit returns when minted)
     c. on Arc, relayer wallet calls gateway.pay(invoiceId, amountIn) — v0.7 routes
        the swap via the shared vault to merchant's payout token
     d. emits the existing InvoicePaid event; v1 indexer + webhooks pick up unchanged
```

Two customer signatures total, both on the source chain. No Arc-side signing.

### What NOT to build for v2.0

- **No new gateway contract.** v0.7 from Plan 3 stays canonical.
- **No on-chain intent contract.** Off-chain EIP-712 + relayer-enforced quote.
- **No DEX aggregator on the source chain** (Odos, 1inch). Only USDC source for v2.0; v2.1 adds source-side swap.
- **No multi-hop intermediary chain.** Direct source → Arc only.
- **No solver network.** Single Arcora relayer in v2.0; market-style solver competition is a v3 ask.

---

## Operational layer

### Arc-side relayer

A new daemon `ops/relayer/` joins `ops/indexer/` and `ops/webhooks/`. Same systemd pattern.

Responsibilities:
1. Accept signed intents from the Next.js API surface (`/api/crosschain/quote`, `/api/crosschain/intent`).
2. Trigger App Kit Bridge on the source chain (using a server wallet or, mainnet path, **Circle Developer-Controlled Wallets** for compliance + audit).
3. Poll bridge job until USDC lands on Arc (App Kit polling or CCTP attestation API as fallback).
4. Submit `gateway.pay(invoiceId, amountIn)` on Arc using the relayer's hot wallet (gas paid in USDC).
5. Reconcile: if any leg fails, refund the customer on the source chain (App Kit Bridge in reverse, OR an explicit refund record).

Relayer wallet balance monitoring is required (analogous to the existing oracle-keepalive wallet).

### `payment_routes` table

```sql
create table payment_routes (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      text not null references invoices(id),
  source_chain    text not null,           -- 'ethereum' | 'arbitrum' | …
  source_token    text not null,           -- USDC contract on source
  amount_in       numeric not null,
  intent_signed_by text not null,          -- customer wallet
  intent_deadline timestamptz not null,
  status          text not null,           -- 'created'|'bridging'|'minted'|'settling'|'paid'|'failed'|'refunded'
  source_tx       text,
  bridge_job_id   text,
  arc_mint_tx     text,
  settle_tx       text,
  created_at      timestamptz default now()
);
```

The status column is a tighter pipeline view than the existing `invoices.status`. The indexer keeps owning `invoices.status`; payment_routes mirrors the off-chain orchestration.

### Webhook payload extensions

`invoice.paid` already fires today on Arc-side settlement. Crosschain only needs **one new event** — `payment_route.bridging` — fired when the App Kit bridge call returns a job-id. Useful for merchants that want progress UX. Everything else (invoice.paid, invoice.refunded) reuses existing payloads.

---

## Compliance

Arc docs explicitly recommend integrating **Elliptic** or **TRM Labs** for KYC/AML screening at checkout. Pre-mainnet work, but call it out here so the relayer ops layer is built with hooks ready:

```
relayer.beforeBridge(intent):
  1. screen(customerAddress) via configured provider
  2. screen(merchantPayoutAddress) — already known but re-check
  3. if either flagged → reject + emit payment_route.flagged
```

---

## Stablecoin set in v2.0 launch

Inherits Plan 3's registry. v2.0 day-one:
- Customer brings USDC from any CCTP-supported source chain.
- Merchant settles in any active stable from the registry: USDC, EURC, USDT, PYUSD, DAI, USYC (institutional), regional fiat-pegs as bootstrapped.

USDC-only on the source side keeps day-one scope manageable. Source-side swap (ETH → USDC, native → USDC) is v2.1.

---

## Effort

| Phase | Time |
|---|---|
| Spec review + revisions | 1 h |
| Off-chain intent EIP-712 design + signing helper | 3 h |
| `ops/relayer/` daemon (App Kit Bridge integration + polling + on-chain settle) | 6 h |
| API: `/api/crosschain/quote`, `/api/crosschain/intent` | 3 h |
| `payment_routes` schema + indexer extension to write the row | 2 h |
| Frontend: source-chain detection, quote display, two-signature flow in `/i/[invoiceId]` | 5 h |
| Foundry tests (gateway v0.7 unchanged; new tests are about route reconciliation in TS) | 1 h |
| App vitest: `/api/crosschain/*` mocked end-to-end | 3 h |
| Live testnet smoke (Arbitrum-Sepolia → Arc) | 2 h |
| **Total** | **~3-4 days** |

Realistically split: first session = relayer + intent + API. Second session = frontend integration. Third session = compliance hooks + testnet smoke + ship.

---

## Open questions for next session

1. **App Kit version + auth model** — does App Kit need a Circle API key per Arcora deployment, or per merchant? Affects multi-tenant story. Read [`/app-kit/quickstarts`](https://docs.arc.network/app-kit/quickstarts) before implementing.
2. **Bridge fees** — Circle's CCTP V2 advertises Fast Transfer (~13s) on supported chains. Per-chain fee schedule unclear; quote engine needs to read it dynamically.
3. **Refund-from-bridge-stuck path** — if App Kit Bridge fails halfway (USDC burnt on source, mint failed on Arc), Circle's recovery story is "user calls receiveMessage manually with the attestation." Our relayer should retry that automatically; document the timeout.
4. **Server wallet on source chains** — using Arcora's own EOA per source chain vs Circle Developer-Controlled Wallets. DCW is the docs-recommended path for compliance, but adds Circle dependency. Default to EOA for testnet; mainnet decision deferred.
5. **Unified Balance / Gateway pre-funding** — pure UX upgrade. Not required for v2.0 but should be explicitly mentioned in the v2.0 announcement so the upgrade path to v2.1 is visible.

---

## Decision log (settled today)

- ✅ App Kit Bridge over raw CCTP contract calls — Arc docs recommend this; less custom code; better future maintenance.
- ✅ Off-chain EIP-712 intent (no on-chain intent contract in v2.0).
- ✅ Single relayer (no solver network) for v2.0.
- ✅ USDC-only on source side; source-side aggregator deferred to v2.1.
- ✅ Same `InvoicePaid` event reused; indexer + webhooks unchanged.
- ✅ New `payment_routes` table for crosschain orchestration state; off-chain mirror, not on-chain state.

---

## When picking this up

1. Re-read [docs.arc.network](https://docs.arc.network) for App Kit changes since this spec was written.
2. Confirm Plan 3 (multi-stablecoin) shipped: gateway v0.7 deployed, registry populated, swap branch live for at least one non-USDC/EURC pair.
3. Decide between EOA relayer vs Circle DCW (open question #4 above) — start the first session with that read.
4. Begin with `ops/relayer/run.ts`. Same systemd shape as `ops/indexer/`. The daemon is the heart of v2.0.
