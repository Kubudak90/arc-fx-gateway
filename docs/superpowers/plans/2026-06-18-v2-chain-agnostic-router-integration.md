# Integration Plan — v2 Chain-Agnostic CCTP Router into arcorapay

> Status: DRAFT for approval. Author: integration mapping of `arcorapay` (this repo,
> branch `plan-1-protocol`) against `agent-commerce-v2` (the no-custody chain-agnostic
> router, at `~/Desktop/agent-commerce-v2`, deployed to Arc Testnet + Base Sepolia).
> Scope: **testnet only** (mainnet gated separately). Do not start coding until this is
> approved.

---

## 0. The decision this plan rests on

There are **two different things called "v2"** in play:

| | Repo "v2" — `plan-1-protocol` (de-facto mainline) | `agent-commerce-v2` (to integrate) |
|---|---|---|
| Custody | **Relayer holds funds** (Permit2 pull / CCTP mint-to-relayer) | **None** — buyer locks USDC in `PaymentEscrow` |
| Destination | **Arc-only** (bridge→Arc, swap on Arc) | **Chain-agnostic** — path A/B/C via `selectRoute` |
| Refund | On Arc, relayer-driven | `escrowId`-self-routing, on the pay-from chain |
| On-chain | `ArcFXGateway` custody escrow (`0xEaE9…0142`, v1.3.0) | `PaymentEscrow` + `SettlementReceiver` (`0x433D…` / `0xD1FC…`) |

They overlap (CCTP, Iris, route planning, a state machine) but are **architecturally
incompatible**: v2 inverts the custody invariant and the Arc-only destination model.

**DECISION: v2 REPLACES the repo's custodial cross-chain spine** (`crosschain-core` planner/
states + `ops/relayer` mint-to-relayer/swap/`settleInvoice` + `ArcFXGateway` buyer path), and
the same-chain Arc Permit2 flow becomes v2 **Path A**. We do NOT run both custody models in
parallel. Integration happens on a branch off `plan-1-protocol`, behind a feature flag, with a
controlled drain of in-flight `ArcFXGateway` escrows.

---

## 1. Target architecture (after integration)

```
BUYER (any supported chain)                         KEEPER (ex-relayer, no custody)        DEST chain
  connect wallet                                       polls deposits + Iris               SettlementReceiver
  pick pay-from chain (registry)                                                            receiveAndSettle:
  approve(USDC → PaymentEscrow)        ── refund window ──►  settle(escrowId):                mint to itself,
  PaymentEscrow.deposit(DepositParams) ─ Deposited event     A: transfer / Li.Fi swap        require msgSender
        │ escrowId (byte[1]=src domain)                       B/C: depositForBurnWithHook ──► == trustedEscrow,
        └─ refund(escrowId) within window                          (Iris attestation) ─────►  pay merchant / park
```

- **Buyer** signs exactly two txs (approve + deposit), pays gas, never touches CCTP. No Permit2.
- **Keeper** only relays Iris attestations + submits `settle`/`receiveAndSettle`/`recoverToBuyer`.
  It NEVER holds user funds.
- **Invoice** is an off-chain `invoiceRef` created with NO on-chain tx; `escrowId` is attached
  when the `Deposited` event lands (it is generated on-chain and cannot be precomputed).
- **Money** is bigint minor-units end to end; decimal strings only at the API edge.

---

## 2. Contract + package surface to bind against

- Contracts: `PaymentEscrow` `0x433D99c9c08dD283c6267fC53A1A079744eb1a67`,
  `SettlementReceiver` `0xD1FCBd195d39404E534b231077315FF88D1731a5` — same address on
  Arc Testnet (domain 26) and Base Sepolia (domain 6). Arc↔Base already cross-wired
  (`settlementReceiver` + `trustedEscrow`).
- Source of truth for chains / domains / token + contract addresses:
  `agent-commerce-v2/packages/router/src/chains.ts`. The app must NOT hard-code these.
- ABIs: take from `agent-commerce-v2/packages/contracts` (forge `out/`). **Do NOT** use
  `packages/sdk/src/abi.ts` — it still ships the legacy `ArcFXGateway` ABI.
- Off-chain brain: `@arcora/router` (chains, `selectRoute`, `money`, `iris`, `lifi`,
  `Orchestrator` + state machine). Bring it in as a workspace dependency (preferred) or vendor.

---

## 3. Phased plan (each phase shippable behind the flag; no phase breaks v1)

### Phase 0 — Foundations (additive, zero behavior change)
- Add `@arcora/router` as a workspace dep (or vendor `chains/selectRoute/money/iris/lifi/orchestrator/stateMachine`).
- Add `PaymentEscrow` + `SettlementReceiver` ABIs and a **multi-chain** deployments manifest
  (today `packages/contracts/deployments/*.json` is single-Arc; extend the shape).
- DB migration (additive only — see §4): new `settlements` table; `merchants` gains
  `payout_chain_id`, `payout_address` (+ `payout_token` as currency enum); `invoices` gains
  `currency`, `idempotency_key`, `invoice_ref`, `escrow_id`, `amount` as canonical minor-units.
- Feature flag `V2_ENABLED` (server) + `NEXT_PUBLIC_V2_ENABLED` (client), default off.
- _Gate:_ migration applies, app builds, v1 fully unchanged with flag off.

### Phase 1 — Create-invoice API + SDK (v2 wire)
- `POST /api/invoices`: accept `amount:string` + `currency` (USDC|EURC|USDT) + `Idempotency-Key`
  header; validate via `money.parseAmount`; **stop** calling on-chain `createInvoiceFor` (no
  server-wallet tx). Create an off-chain `invoiceRef` + derive the on-chain `idemKey` from the
  idempotency key. Add unique `(merchantId, idempotency_key)`.
- Merchant payout config: `{payoutChainId, payoutToken, payoutAddress}` (own address). New/updated
  endpoints; map `payoutChainId → cctpDomain` via the registry; reject chains without a deployed
  escrow. Re-anchor compliance screening to the stored `payoutAddress`.
- Update `@arcora/sdk` (this repo's copy) to the v2 surface, OR publish/consume agent-commerce-v2's.
- CORS `Allow-Headers` += `idempotency-key`.
- _Gate:_ v2 SDK `createInvoice` round-trips; idempotent retry returns the same invoiceRef.

### Phase 2 — Checkout frontend (the buyer deposit flow) — **the "frontend gaps"**
- `gateway-abi.ts` → add a `PaymentEscrow` ABI module (deposit/refund/getEscrow + `DepositParams` tuple).
- `wagmi-config.tsx` → widen chains/transports to every registry chain with a deployed escrow.
- `ChainSelector.tsx` → registry-driven pay-from picker (chains with non-empty `paymentEscrow`),
  not the hard-coded {Base, Eth Sepolia}.
- Collapse `PayButton` + `CrossChainPayButton` into ONE **DepositButton**: `approve(USDC→escrow, amount)`
  then `PaymentEscrow.deposit(DepositParams{idemKey, invoiceRef, merchant, payoutDomain, payoutToken, amount})`
  on the chosen chain. Delete the Permit2-witness path and the raw CCTP `depositForBurn`-to-relayer path.
  Drop the `chainId===5042002` Arc guard.
- Capture `escrowId` from the `Deposited` event → client resume/status key; localStorage "burn stash"
  → "deposit stash" keyed by `idemKey` (deposit is idempotent on-chain, so resume is simpler).
- `QuoteDisplay.tsx` → remove buyer-side FX (buyer always pays USDC == amount, 1:1). Show
  "you pay N USDC on {chain} → merchant receives {currency} on {payout chain}".
- `CheckoutClient.tsx` → map the poll to v2 settlement states (DEPOSITED / SETTLING / BURN_SENT /
  ATTESTATION_PENDING / RECEIVE_SENT → in-progress; SETTLED / SETTLED_FALLBACK_USDC → paid;
  REFUNDED / RECOVERED_TO_BUYER → refunded; EXPIRED → expired). Rewrite the "What you're signing /
  refund" panel (no Permit2/relayer; on-chain self-routing refund within the window). "Awaiting
  settlement" is a legitimate longer-lived state (settle is AFTER the refund window).
- `checkout-demo/page.tsx` → rewrite narrative to lock-USDC/escrow/no-custody.
- _Gate:_ a buyer can pay an invoice on Arc Testnet AND Base Sepolia against the live contracts;
  status flips correctly; refund works within the window. (Same flow we already proved by hand.)

### Phase 3 — Relayer → keeper (Orchestrator), no custody
- Replace `ops/relayer/crosschain-worker.ts` (mint-to-relayer + swap + `settleInvoice`) and the
  same-chain Permit2 pull with the v2 `Orchestrator`: after the refund window, call
  `PaymentEscrow.settle()`; for B/C poll Iris (`waitForAttestation`) then submit
  `SettlementReceiver.receiveAndSettle`; Path C deferred `settle` with a fresh Li.Fi swap-only
  quote; `recoverToBuyer` on hook failure.
- Back the Orchestrator with a **durable Postgres Store** (NOT `MemoryStore`) — the `settlements`
  table from Phase 0. Per-domain viem clients (Arc + Base) from the registry.
- Keeper key only signs; the `RELAYER_ADDRESS`/`NEXT_PUBLIC_RELAYER_ADDRESS` parity guard becomes obsolete.
- _Gate:_ end-to-end A/B/C on testnet through the daemon (we already validated A + B by hand).

### Phase 4 — Indexer + status + treasury
- Index `PaymentEscrow`/`SettlementReceiver` events (Deposited/Settled/Refunded/PayoutFailed/
  PendingSettle/RecoveredToBuyer). Upsert `escrow_id` + settlement state onto the row.
- `GET /api/invoices/[id]` returns chain context (escrowChain/domain, payoutChain, path A/B/C),
  amount as decimal string, currency.
- Treasury rollups keyed on **(payoutChainId, payoutToken)**, sourced from settlement records.
- Retire/repoint `GET /api/merchant/escrows` (no claim/recover in v2; "claimable" → "refundable").

### Phase 5 — Migration / in-flight drain + cutover (see §4)

### Phase 6 — Docs / roadmap / runbook
- Update ROADMAP (repo's v2.0 = "App Kit bridge, settle on Arc"; this is ahead of it), LITEPAPER,
  `runbooks/crosschain-v2-demo.md` (refund self-routes on source chain, not Arc).

---

## 4. Migration & in-flight drain (the dangerous part — value-bearing)

`ArcFXGateway` v1.3.0 (`0xEaE9…0142`) holds **live testnet escrows** with a 7-day refund window;
the retired v1.2.0 (`0x07BA…e3A3`) is still indexed. `relayer_queue` and `crosschain_payments`
may hold in-flight rows.

**Dual-run, drain-then-retire:**
1. New invoices created with `V2_ENABLED` go down the v2 path (off-chain invoiceRef, buyer deposit).
2. **All existing v1 invoices/escrows/queue rows keep draining on the OLD relayer + gateway path**
   until empty (claims settle, refunds within the 7-day window complete).
3. The indexer watches **both** the legacy gateway(s) AND the v2 contracts during transition.
4. DB migration is **additive only** — do NOT `ALTER`/drop v1 columns (`claimableAt`, `status`
   claimed/recovered, `crosschain_payments.*`) while v1 rows still reference them. `schema.test.ts`
   pins several NOT NULL columns + the `settlement_tier` enum — keep them green.
5. After the 7-day window elapses with zero pending v1 rows, flip the flag globally and retire
   `crosschain-core` + the custody relayer in a separate cleanup PR.
6. **Idempotency must be one chain end-to-end**: API `Idempotency-Key` → `invoices.idempotency_key`
   (unique per merchant) → on-chain `PaymentEscrow.idemKey`. A mismatch = duplicate escrows or a
   deposit that maps to the wrong escrow.

Never route a single invoice through both custody models.

---

## 5. Top risks → mitigations (condensed from the subsystem maps)

| Risk | Mitigation |
|---|---|
| Two custody models live at once | Strict flag isolation; per-invoice path is fixed at create and never crosses |
| `invoiceId` identity change (globalId → invoiceRef; escrowId separate, post-deposit) | New `invoice_ref`/`escrow_id` columns; ref↔escrowId resolution; audit FKs |
| amount float → bigint | `money.parseAmount` at every edge; reconcile historical `numeric` rows; reject `amountUsdc:number` |
| Cross-chain binding | `PaymentEscrow.settlementReceiver` ↔ `SettlementReceiver.trustedEscrow` parity per chain (Arc↔Base already wired) |
| Compliance gate was on Permit2 submit | Move sanctions screen to pre-deposit (create/quote) or a keeper gate |
| Orchestrator durability | Postgres Store, persist after every transition (crash-safe); Path C/recover are deferred |
| escrowId not precomputable | Read from `Deposited` event; key resume/status on it |
| Arc native 18-dp vs ERC-20 6-dp | Only ever use the 6-dp ERC-20 USDC `0x3600…0000`; never mix with native gas units |
| SDK breaking change blast radius | Major version bump; coordinate sdk-react, demo-merchant, README, WooCommerce plugin |

---

## 6. Open product decisions (need your call before/within implementation)

1. **Protocol fee — BLOCKER for revenue.** v1 takes 0.30% at claim + ~1% swap fee. The v2
   `PaymentEscrow`/`SettlementReceiver` as built take **NO fee** (merchant gets the full amount
   minus CCTP fee + swap slippage). To keep arcorapay's revenue we must either (a) add a `feeBps`
   skim to `settle`/`receiveAndSettle` (contract change + redeploy), or (b) take the fee off-chain.
   **Which?** (Recommend (a) — a small `feeRecipient`/`feeBps` in the escrow/receiver, redeploy.)
2. **invoices table: overload vs new `settlements` table?** (Recommend a new `settlements` table,
   1:1 `invoiceRef ↔ escrowId`, leaving `invoices` as the merchant-facing logical object.)
3. **Same-chain Arc Permit2: keep as legacy option, or fully Path A?** (Recommend full Path A —
   one model.)
4. **Gasless is lost** (buyer now pays approve+deposit gas; on Arc gas = USDC). Acceptable for
   launch, or do we want a paymaster/sponsored-gas follow-up? (Recommend accept now, paymaster later.)
5. **Refund window value** — testnet contracts deployed with `REFUND_WINDOW=120s`. Production wants
   a real value (e.g. minutes–hours). This is immutable per deploy → set at the mainnet/redeploy step.

---

## 7. Sequencing / parallelism

- Phase 0 first (everything depends on it). Then Phase 1 (API) and Phase 2 (frontend) can proceed
  in parallel against the live Arc/Base contracts (frontend can deposit even before the keeper is
  rewritten — settlement just won't auto-complete until Phase 3).
- Phase 3 (keeper) and Phase 4 (indexer) can overlap once Phase 1's `settlements` table exists.
- Phase 5 (drain) runs continuously alongside; Phase 6 (docs) last.
- The contract **fee decision (§6.1)** gates a possible redeploy — resolve it early so we don't
  deploy twice.

---

## 8. What is already proven (de-risks this plan)

On the live testnet contracts we already validated by hand: same-chain deposit→refund (Arc),
same-chain settle→merchant payout (Arc, Path A USDC), and **full cross-chain Arc→Base (Path B):
deposit → settle/burn → Iris attestation (~30s) → `receiveAndSettle` → merchant paid on Base**.
`escrowId` byte[1] correctly carried the source domain on-chain. So the contract + router half of
this integration is working; the work here is wiring the arcorapay app to it.
