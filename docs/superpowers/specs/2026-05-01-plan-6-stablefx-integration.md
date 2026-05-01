# Plan 6 — StableFX integration (App Kit Swap relayer)

**Status:** spec; ready to implement; replaces our custom AMM as the FX layer
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-01
**Depends on:** v1.0.x (gateway + indexer surface), Plan 5 (compliance hooks — gates the relayer)
**Blocks:** v0.8 deploy; archives v0.5/v0.6 internal pool

---

## Why this is required

Arc's docs are explicit: *"Collect a custom spread fee on every swap without writing new smart contracts."* The platform ships StableFX (FxEscrow at `0x867650F5…`) plus App Kit Swap as the canonical FX layer. Every hour we spend hardening our own `IStableSwapPool` is an hour we're competing with Circle's audited, RFQ-based, maker-network-backed engine — and losing on liquidity, audit cost, and price discovery.

The investigation that produced this spec confirmed two facts:

1. **FxEscrow is a 2-phase commit protocol** (`recordTrade` → `takerDeliver` + `makerDeliver`). It is not a single-tx atomic AMM. We cannot call it from inside our gateway contract and emit one `InvoicePaid` in the same tx.
2. **`recordTrade` is gated on `relayers(msg.sender)`**, and `addRelayer` is `onlyOwner` (Circle). We cannot self-permission. The only sanctioned path is **App Kit Swap** (`@circle-fin/swap-kit`), which uses Circle's relayer + maker network under the hood.

So the move is: **stop building the pool, start building a relayer service that wraps `kit.swap()` and presents the customer with v0.6-equivalent UX (one signature, no swap awareness)**. Our custom contracts shrink to invoice escrow + settlement event emission.

---

## Scope

In scope:
- New `ArcFXGateway v0.8` contract: invoice lifecycle + escrow, **no swap logic**.
- Arcora relayer daemon (`ops/relayer/`): event listener + `kit.swap` orchestration + settlement caller. Runs on the same VPS pattern as `arcora-indexer` and `arcora-webhooks`.
- New API surface: `/api/quote` (pre-payment estimate via `kit.estimateSwap`).
- SDK + PayButton update: single Permit2 signature path, quote display with TTL.
- Refund flow preserved (paid invoice → reverse via gateway, no swap needed).

Out of scope (explicit non-goals):
- Direct `FxEscrow.recordTrade` integration. We're not on Circle's relayer whitelist, and chasing it now is the wrong order of operations.
- Maker liquidity provisioning. App Kit's maker network handles this; if testnet liquidity is thin we route around it (see Phase A).
- Crosschain. Plan 4 still covers that; v0.8 is single-chain only.
- Multi-stablecoin pool (Plan 3). Archived — see "Decisions" below.

---

## Architecture

```
┌──────────┐  Permit2 EIP-712 sig (gas-less)  ┌────────────────┐
│ Customer │─────────────────────────────────▶│ /api/checkout/ │
└──────────┘                                  │   submit       │
                                              └────────┬───────┘
                                                       │
                                              ┌────────▼─────────┐
                                              │ Arcora relayer   │
                                              │ (VPS, hot wallet)│
                                              └────────┬─────────┘
                                                       │ 1. Permit2.permitTransferFrom(sig)
                                                       │    customer payIn → hot wallet
                                                       │
                                                       │ 2. kit.swap({ tokenIn, tokenOut,
                                                       │              customFee, slippageBps })
                                                       │    payIn → payoutToken via FxEscrow
                                                       │
                                                       │ 3. ArcFXGateway.settleInvoice(
                                                       │      id, payoutToken, amount, fee)
                                                       │    payout → merchant
                                                       │    emit InvoicePaid
                                              ┌────────▼─────────┐
                                              │ ArcFXGateway     │
                                              │ v0.8 (escrow +   │
                                              │  invoice events) │
                                              └──────────────────┘
```

**Customer experience:** one EIP-712 signature in their wallet (no gas, no tx hash). Identical to a Stripe "confirm payment" tap.

**Custody window:** funds sit in the relayer hot wallet between step 1 and step 3. Expected duration: 1–3 seconds (Arc deterministic finality + kit.swap latency). The hot wallet is segregated, holds only in-flight funds, and is monitored.

---

## Components

### 1. `ArcFXGateway v0.8`

Stateless w.r.t. swap pricing. Roles:
- `RELAYER_ROLE` — only the relayer hot wallet may call `settleInvoice`.
- `OWNER` — admin (deploy + emergency pause).

Public surface:

```solidity
// Customer creates invoice via off-chain merchant call (no on-chain state yet —
// invoices live in our DB; gateway sees them only at settlement).

// Relayer-only. Called after kit.swap completes.
function settleInvoice(
    bytes32 invoiceId,
    address payer,           // who paid (recovered off-chain from Permit2 sig)
    address payoutToken,     // settlement stable
    uint256 payoutAmount,    // gross
    uint256 protocolFee,     // Arcora's cut, transferred to feeRecipient
    address merchant,        // payout destination
    bytes32 swapTxHash       // off-chain reference to the kit.swap tx
) external onlyRole(RELAYER_ROLE);
//   transfers payoutAmount - protocolFee to merchant
//   transfers protocolFee to feeRecipient
//   emits InvoicePaid(invoiceId, payer, payoutToken, payoutAmount, protocolFee, swapTxHash)

// Existing v0.6 surface preserved:
function refundInvoice(bytes32 invoiceId, ...) external; // unchanged
event InvoicePaid(...);
event InvoiceRefunded(...);

// New: stuck-payment recovery. Relayer calls this if kit.swap failed and
// it returned the original payIn token to its own wallet. The gateway
// records the refund-to-payer event so the indexer + webhook flow fires.
function recordPayerRefund(
    bytes32 invoiceId,
    address payer,
    address payInToken,
    uint256 amount,
    bytes32 reason          // hash of error context (logged offchain)
) external onlyRole(RELAYER_ROLE);
event PayerRefunded(...);
```

Gone from v0.6: `IStableSwapPool` interface, `_estimateAmountIn`, `quoteAmountIn`, `payInvoice` (replaced by relayer-driven `settleInvoice`), Chainlink oracle dependency, PriceGuard.

LoC budget: ~120 lines (vs v0.6's ~280).

### 2. Arcora relayer daemon (`ops/relayer/`)

Long-running Node.js service. Same pattern as `ops/indexer/run.ts`. Lives at `/root/arcora-ops/relayer/` on the VPS, systemd unit `arcora-relayer.service`.

Responsibilities:

```
loop forever:
  1. Pull next pending submission from `relayer_queue` (DB table)
  2. Validate Permit2 signature, deadline, witness data
  3. Compliance gate (Plan 5): screenAddress(payer); reject if blocked
  4. Permit2.permitTransferFrom(payer → hot wallet, payIn, amount)
  5. kit.swap({ tokenIn, tokenOut, amountIn, customFee, slippageBps,
                config: { kitKey } })
     - on success → step 6
     - on failure (slippage exceeded, no liquidity, RPC error)
       → call gateway.recordPayerRefund(...) and forward original payIn back to payer
       → mark queue row as 'refunded'; webhook fires invoice.failed
  6. gateway.settleInvoice(invoiceId, payer, payoutToken, payoutAmount, protocolFee, merchant, swapTxHash)
  7. Mark queue row 'settled'; indexer + webhook flow takes over
```

Hot wallet management:
- Private key in `/root/arcora-ops/relayer/.env`, chmod 600 (KMS once we ship mainnet).
- Wallet is **single-purpose**: receives only in-flight invoice funds, never holds custody beyond a single settlement cycle.
- Threshold alarms: balance > $100 outside of an active settlement → page (means a settle failed).
- Daily sweep: any drift balance gets transferred to a cold reconciliation wallet.

### 3. `/api/quote` (Vercel route)

Pre-payment estimate. The merchant SDK calls this to display "Pay 1.00 USDC, you'll send 0.99 EURC" before the customer signs.

```ts
POST /api/quote
{
  invoiceId, payInToken, payInAmount, payoutToken
}
→
{
  estimatedPayout: "0.99",
  feeBreakdown: { custom: "0.01", provider: "0.0002" },
  ttlSeconds: 30,
  quoteId: <uuid>
}
```

Backed by `kit.estimateSwap()`. Quote TTL is short (30s) because the underlying RFQ rate moves; the SDK shows a countdown and offers refresh.

### 4. `/api/checkout/submit`

Receives the customer's signed Permit2 message. Validates and enqueues into `relayer_queue` for the daemon to pick up.

```ts
POST /api/checkout/submit
{
  invoiceId, payer, permit2: { permit, witness, signature }
}
→ 202 Accepted, { submissionId }
```

The frontend then polls `/api/checkout/status/<submissionId>` for `settled | failed`.

### 5. SDK + PayButton update

`@arcora/sdk`:
- New: `arcora.getQuote({ invoiceId, payIn, payInAmount })` → calls `/api/quote`.
- Replace: `arcora.payInvoice(invoiceId)` no longer triggers a wallet transaction; instead it builds the Permit2 typed data, calls `wallet.signTypedData()`, and POSTs to `/api/checkout/submit`.
- Existing `arcora.openCheckout()` and CDN `<script>` flow continue to work — only the underlying signature mechanism changes.

PayButton UI:
- Quote panel: payIn amount, payout estimate, fee breakdown, TTL countdown.
- Sign step: single Permit2 popup. Wallet shows EIP-712 typed message, no gas warning.
- Settling state: spinner with "settling…" while the relayer works (typically < 5s).
- Settled state: success screen with the merchant's tx receipt link.

---

## Decisions (and what we're explicitly choosing not to do)

**Why not direct FxEscrow integration?** `recordTrade` is relayer-gated. Becoming a Circle relayer is a business process, not a code change, and is the wrong dependency to take onto the critical path. App Kit Swap gives us the same underlying liquidity through a maintained interface; the customer can't tell the difference.

**Why not keep the custom pool?** Three reasons. (1) Liquidity — we'd need to provision $X across both stables; Circle's maker network is already there. (2) Maintenance — every audit cycle on our pool is dead weight against the Arc-native primitive. (3) Pricing — RFQ via Circle's makers will out-execute our oracle-based quote on tight markets, and we don't want to be the FX product that quotes worse than the platform's default.

**Why not frontend `kit.swap`?** Two wallet popups (swap + settle) is the UX the user explicitly rejected. Backend orchestration via the relayer keeps it to one signature.

**Why a relayer instead of Circle's Developer-Controlled Wallets (DCW)?** DCW is a custodial wallet API; running our own hot wallet is simpler than wiring DCW key management into a v0.8 critical path. Revisit when we ship mainnet — DCW + KMS is the right answer there.

**Pool spec (Plan 3) — what happens to it?** Archived. The user's local `feat/v0.7-shared-vault-pool` branch becomes a reference implementation, not a deployable. We add a one-line note in `docs/superpowers/specs/2026-04-29-plan-3-multi-stablecoin.md` redirecting to this plan.

---

## Phased delivery

**Phase A — testnet liquidity smoke (½ day)**

Before writing any new code, run a manual `kit.swap` from the VPS hot wallet on Arc testnet, USDC → EURC, $10. Confirm:
- Quote returns within 2s.
- Swap settles within 5s.
- `customFee.recipientAddress` receives 90% of the configured percentage.
- Provider fee is the documented 0.02%.

If liquidity is too thin to fill, escalate to Circle dev support before committing to the spec. The fallback is implementing this for mainnet only and keeping testnet on the v0.6 path until Circle's testnet maker activity is verified.

**Phase B — gateway v0.8 contract (1 day)**

- Write `ArcFXGateway v0.8` per the surface above.
- Solidity tests: settlement happy path, refund happy path, payer-refund recovery path, role enforcement, reentrancy (nonReentrant on settle), pause behaviour.
- Foundry deploy script + verification on Arc testnet.

**Phase C — relayer daemon + queue (2 days)**

- New DB table `relayer_queue` (Drizzle migration).
- `ops/relayer/run.ts` mirroring the indexer pattern.
- `ops/relayer/replay.ts` recovery CLI (mirrors `ops/indexer/replay.ts`): retry stuck submissions, resubmit a failed swap with a fresh quote.
- Systemd unit, `.env` template, README operator-facing doc.

**Phase D — API + SDK + PayButton (1.5 days)**

- `/api/quote` and `/api/checkout/submit` routes + tests.
- SDK Permit2 typed-data builder + `signTypedData` integration.
- PayButton quote panel + countdown + settling state + status polling.
- Update `@arcora/sdk` to 1.2.0; CDN bundle rebuild.

**Phase E — testnet canary, A/B with v0.6 (½ day)**

- Deploy v0.8 to testnet alongside v0.6 (different `GATEWAY_ADDRESS`).
- Internal merchants (demo-merchant, hosted checkout) flip to v0.8.
- Run for 48 h, watch for stuck submissions, refund triggers, fee accuracy.
- Cut over `arc-fx-gateway.vercel.app` to v0.8 when green.

**Phase F — archive (½ day)**

- Mark `feat/v0.7-shared-vault-pool` as archived in `roadmap_open_items.md`.
- Add redirect note to Plan 3 spec.
- Update `README.md` "How Arcora relates to Arc primitives" matrix: drop our pool row, add StableFX row.

Total: ~6 working days.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Testnet maker network thin / no liquidity | HIGH (blocks Phase A) | Fall back to App Kit liquidity escalation; defer testnet path until Circle confirms; ship to mainnet first if needed |
| Hot wallet key compromise | HIGH | Single-purpose wallet, threshold alarms, daily sweep, KMS for mainnet |
| `kit.swap` returns partial fill | MEDIUM | Treat as failure; refund payer; revisit if it happens > 1% of the time |
| Quote staleness (customer slow to sign) | MEDIUM | Short TTL + UI countdown + refresh button; relayer re-validates at submit time |
| Permit2 signature replay | LOW | Permit2 nonces handle this natively |
| Compliance screening latency | LOW | Plan 5 spec already covers async screening + manual-review queue |

---

## Open questions

1. **Maker network on testnet** — phase-A smoke confirms or denies. If thin, do we run our own maker fund (testnet only, not maintained for mainnet)?
2. **Relayer redundancy** — single VPS daemon is a single point of failure. Acceptable for v0.8 testnet; for mainnet plan a hot standby on a second VPS.
3. **Refund pricing** — when we refund a paid invoice, do we refund in `payoutToken` (what merchant received) or convert back to `payInToken` (what customer paid)? v0.6 default is `payoutToken`; same here unless a specific merchant asks otherwise.
4. **Settle-failure SLA** — if a swap fails, how long before we auto-refund the payer vs retrying? Initial: 3 retries over 30s, then refund. Tunable per merchant later.
