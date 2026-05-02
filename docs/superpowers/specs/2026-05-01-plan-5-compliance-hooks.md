# Plan 5 — Compliance hooks (Elliptic / TRM Labs adapter)

**Status:** spec; deferred until mainnet readiness; pull forward if a partner asks
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-01
**Depends on:** v1.0.x (today's gateway + indexer surface)
**Blocks:** mainnet deployment

---

## Why this is required

Arcora cannot ship to mainnet without an answer to: *"What stops sanctioned wallets from settling through your gateway?"* Arc's own docs recommend Elliptic and TRM Labs as the compliance providers any payment surface should integrate. The `/build/payments` page lists "Native compliance hooks" as one of the platform's selling points; a checkout product that skips them inherits the regulatory exposure of every customer wallet that touches it.

This is **not** a v1 feature. It's a pre-mainnet bar: testnet doesn't need it (no real money), and the lift is real (provider contracts, API keys, fallback handling, manual-review queue). The point of writing the spec now is so the runtime hooks exist as no-op stubs from day one and the integration is mechanical when it's time to ship — not a from-scratch redesign at the worst moment.

---

## Scope and non-goals

### In scope
- **Off-chain screening** at the API layer (invoice creation + payment authorization).
- **Adapter pattern** so Elliptic / TRM Labs / a no-op implementation are interchangeable behind one interface.
- **Audit log table** for every screening decision (who, when, result, provider, snapshot of the response payload).
- **Reject / review / proceed** UX with merchant-facing error codes.
- **Mainnet rollout phases**: no-op → Elliptic-shadow → Elliptic-enforce.

### Out of scope
- **On-chain blocklist** in the gateway contract. Gas-expensive, hard to keep current, bypasses the merchant relationship. Stripe doesn't gate at the network layer; we don't either.
- **KYC document collection** (selfies, IDs). That belongs in the merchant onboarding flow (KYB), not in checkout.
- **Per-merchant compliance policy customisation** (e.g. "this merchant tolerates medium-risk addresses"). Single global policy in v1; multi-tenant policy is a v2 ask.
- **Travel rule reporting**. Adjacent feature, separate ticket.

---

## Where the hooks fire

```
                 ┌─────────────────────────────────────────────┐
                 │  /api/invoices   (POST, server hot wallet)  │
                 │  → screen merchant.payoutAddress (1×, cache)│
                 │  → reject if hard-fail                      │
                 └─────────────────────────────────────────────┘
                                       │
                                       ▼
                          (invoice on-chain, pending)
                                       │
                                       ▼
                 ┌─────────────────────────────────────────────┐
                 │  /api/invoices/[id]  (GET, customer view)   │
                 │  → no screen yet — invoice is public        │
                 └─────────────────────────────────────────────┘
                                       │
                                       ▼
                 ┌─────────────────────────────────────────────┐
                 │  /api/checkout/authorize  (POST, NEW route) │
                 │  → screen customer wallet                   │
                 │  → returns ok / review / reject             │
                 │  → frontend gates the Pay button on this    │
                 └─────────────────────────────────────────────┘
                                       │
                                       ▼
                          on-chain pay() (no contract change)
```

Two checkpoints, both off-chain. Neither calls the gateway contract; neither changes contract bytecode.

### Why merchant gets screened at invoice creation, not earlier

- Cheaper: one screening per merchant, cached for 24h, not per invoice.
- Honest: the screening result depends on the merchant's *current* payout address (which can change via `updatePayoutAddress`), not the address at registration.
- Failure mode is fixable: a merchant flagged after a payout-address rotation gets a clean error code and can rotate again.

### Why customer gets screened at checkout-authorize, not at /i/[id] page load

- The page itself is public. The wallet isn't connected yet. We don't have an address to screen.
- Authorize fires after the customer connects their wallet but before they sign `pay()`. It's the latest possible moment with full info, earliest possible moment we can block them.
- A stuck on-chain `pay()` from a sanctioned wallet still settles funds we'd then have to refund. Blocking pre-signature avoids that.

---

## Adapter interface

```ts
// packages/app/lib/compliance/provider.ts

export type Risk =
  | "low"            // no flags; proceed
  | "medium"         // flagged exposure; queue for human review
  | "high"           // strong adverse signal; reject
  | "sanctions";     // OFAC / UN / EU sanctions match; hard reject

export interface ScreeningResult {
  risk: Risk;
  reasons: string[];           // human-readable findings
  providerScore?: number;      // raw provider score for the audit log
  providerSnapshot: unknown;   // raw response, persisted verbatim for audit
  cachedAt: Date;
  ttlSeconds: number;          // how long the caller may reuse this result
}

export interface ComplianceProvider {
  readonly name: "elliptic" | "trmlabs" | "noop";
  screenAddress(address: string, context: {
    invoiceId?: string;
    merchantId?: string;
    flow: "merchant_payout" | "customer_pay";
  }): Promise<ScreeningResult>;
}
```

### Three implementations

1. **`NoopProvider`** — always returns `{ risk: "low", reasons: [], … }`. Default for testnet, smoke tests, and any environment where `COMPLIANCE_PROVIDER` is unset.
2. **`ElliptticProvider`** — calls Elliptic Lens API (`/v2/wallet/synchronous` for sanctions + risk score). Maps their score (0–10) into our `Risk` enum: `0–3 → low`, `4–6 → medium`, `7–9 → high`, sanction-flag → `sanctions`.
3. **`TRMLabsProvider`** — calls TRM Labs Forensics API (`/v2/screening/addresses`). Same enum mapping; threshold cutoffs configurable per env.

Provider selection is env-driven:
```
COMPLIANCE_PROVIDER=noop          # default
COMPLIANCE_PROVIDER=elliptic
COMPLIANCE_PROVIDER=trmlabs
COMPLIANCE_API_KEY=…              # provider-specific secret
COMPLIANCE_RISK_THRESHOLD=4       # min score that triggers "review"
```

---

## Database

```sql
create table compliance_screenings (
  id              uuid primary key default gen_random_uuid(),
  address         text not null,           -- the address that was screened
  flow            text not null,           -- 'merchant_payout' | 'customer_pay'
  invoice_id      text references invoices(id),  -- nullable; only set for customer screens
  merchant_id     uuid references merchants(id), -- nullable; only set for merchant screens
  provider        text not null,           -- 'elliptic' | 'trmlabs' | 'noop'
  risk            text not null,           -- ScreeningResult.risk
  reasons         jsonb not null,
  provider_score  numeric,
  provider_snapshot jsonb not null,        -- raw response for forensic audit
  decision        text not null,           -- 'allow' | 'review' | 'reject'
  created_at      timestamptz not null default now()
);
create index idx_compliance_screenings_address on compliance_screenings(address);
create index idx_compliance_screenings_invoice on compliance_screenings(invoice_id) where invoice_id is not null;
```

Caching strategy:
- Read-through cache: before calling the provider, look up the latest `compliance_screenings` row for `(address, flow)` within the TTL window.
- TTL is provider-controlled (Elliptic: 24h on stable risk scores; sanctions list refreshed daily by the provider).
- A merchant who rotates `payoutAddress` triggers a fresh screen on the new address; the old row stays for audit history.

---

## API surface

### `POST /api/checkout/authorize`

```jsonc
// request
{ "invoiceId": "0x…", "address": "0x3687…" }

// response — proceed
{ "decision": "allow", "screenedAt": "2026-05-01T…", "ttlSeconds": 86400 }

// response — manual review (rare, queued)
{ "decision": "review", "reason": "MEDIUM_RISK_EXPOSURE",
  "supportContact": "compliance@arcora.dev",
  "ticketId": "rev_…" }

// response — hard reject (sanctions / high risk)
{ "decision": "reject", "code": "SANCTIONED_WALLET",
  "reason": "Address matches OFAC SDN list" }
```

Frontend behavior:
- `allow` → Pay button enables.
- `review` → Pay button disabled; show "Compliance review required — we'll email the merchant within 24h." Persist `ticketId` so the merchant dashboard can surface the queue.
- `reject` → Pay button disabled; show short, neutral copy ("This wallet can't be used for this payment.") Avoid leaking exact provider reasoning to the customer.

### `POST /api/invoices` (existing route, augmented)

Inside the existing handler, after merchant lookup:
1. Screen `merchant.payoutAddress` with `flow: "merchant_payout"`.
2. If `risk === "sanctions" || risk === "high"`, return 403 with `{ code: "MERCHANT_PAYOUT_BLOCKED" }` and **do not** create the invoice on-chain.
3. If `risk === "medium"`, log + return 202 with `{ status: "queued", ticketId }` — invoice creation deferred until ops review.
4. Otherwise proceed with normal invoice creation.

### Merchant dashboard

A new `/m/compliance` page lists pending review tickets the merchant owns (their own onboarding screen, plus any of their customers that hit `review`). The merchant can't override a `reject`; they can only see what was blocked and why-the-API-said-so.

Webhook payload extension: a new event type `compliance.review_queued` fires when a customer payment is held for review, so a merchant's worker can react (e.g. email the buyer "we're confirming a few details").

---

## Mainnet rollout phases

1. **Phase 0 — Noop** (today): adapter exists, every call returns `low`. Testnet runs exactly like today. Plan 5 effectively dormant.
2. **Phase 1 — Shadow mode** (week 1 of mainnet onboarding): switch `COMPLIANCE_PROVIDER=elliptic`, but the API surface still returns `allow` for everything except `sanctions` matches. We log everything; nothing user-visible changes for medium/high. Goal: gather baseline on the rate of false positives we'd hit if enforced.
3. **Phase 2 — Sanctions enforce + review queue** (week 2): hard reject on `sanctions`; route `high` to the review queue; `medium` becomes `allow` with a quiet log. UX is real but tolerant.
4. **Phase 3 — Full enforce** (week 4+): `medium` joins the review queue; thresholds tuned based on Phase-1/2 data; merchant dashboard tickets actually have humans answering them.

Each phase flip is a config change, not a code change. The adapter ships with all four behaviours wired at code level; phase is a runtime toggle (`COMPLIANCE_ENFORCE_MEDIUM=true`, etc.).

---

## Failure modes the spec must answer

1. **Provider down.** If Elliptic returns 5xx, do we fail-open (allow) or fail-closed (reject)?
   - **Default: fail-closed for `pay`, fail-open for `invoice creation`**. A failed payment screen reverts cleanly; a failed merchant screen would block legitimate invoice creation while the provider's incident persists. Configurable via `COMPLIANCE_FAIL_OPEN_FOR_*` env vars.
2. **Stale cache, fresh sanctions match.** A wallet was clean yesterday; now it's on the SDN list.
   - Mitigation: Phase 0/1 use 24h TTL. Phase 2 onwards drops to 1h for `customer_pay` flow. Sanctions sub-list is refreshed by the provider every 6h server-side; we trust the provider's freshness.
3. **Customer in a screen-on-pay state, but the merchant has already authored a `paid` webhook delivery to their own server.** Not possible — screening happens *before* `pay()` reaches chain. The webhook fires on `InvoicePaid` event, which only emits on a successful settle.
4. **Provider migration mid-rollout** (Elliptic ↔ TRM Labs).
   - Adapter interface is provider-agnostic. Audit log keeps the `provider` column so historical reasoning is preserved. Run both in parallel for a calibration week, then flip via env.

---

## Effort

| Phase | Time |
|---|---|
| Spec review + revisions | 1 h |
| Adapter interface + Noop / Elliptic / TRMLabs implementations | 8 h |
| `compliance_screenings` migration + drizzle schema | 1 h |
| `/api/checkout/authorize` route + audit logging | 3 h |
| Augment `/api/invoices` with merchant screen + queue path | 3 h |
| Frontend Pay button gate (`allow` / `review` / `reject` states) | 3 h |
| Merchant dashboard `/m/compliance` review-queue page | 4 h |
| Webhook payload type `compliance.review_queued` + indexer wire-up | 2 h |
| Vitest coverage (adapter mock, route handlers, gate UI) | 4 h |
| Phase 0 deploy (Noop everywhere) | 1 h |
| **Total** | **~3-4 days**, split 2 sessions |

Phase 1+ deploys are config flips, not effort.

---

## Decision log (settled today)

- ✅ Off-chain screening at API layer; no on-chain blocklist.
- ✅ Two checkpoints: merchant payout address (at invoice create) + customer wallet (at checkout authorize). Public invoice page does NOT screen.
- ✅ Adapter pattern with provider-agnostic interface; concrete Elliptic + TRMLabs implementations behind it.
- ✅ Audit log retains raw provider response for forensic replay.
- ✅ Mainnet rollout staged across 4 phases, each a runtime flip.
- ✅ Default fail-closed for `pay` flow; fail-open for `invoice creation`. Configurable.
- ❌ KYC document collection — that's KYB onboarding territory.
- ❌ Per-merchant policy customisation — single global policy in v1; multi-tenant later.

---

## Resolved questions (2026-05-02 session)

1. **Providers — both day-one.** Ship both Elliptic and TRM Labs adapters wired behind the same interface. Production phase-flip can switch between them or run them in parallel for calibration without a code change.
2. **Region lists — OFAC + EU.** Default sanction-list match set on both providers includes OFAC SDN and the EU consolidated list. UN/UK can be added later without API changes (provider-side flag).
3. **Phase 0 ship target.** Today: Noop as default, full adapter scaffolding for Elliptic + TRM behind their interfaces, real API calls gated on env-supplied API keys (mock-mode for tests). Mainnet Phase 1+ is then a config flip.
4. **Logging retention — 7y sanctions / 13mo non-flagged.** Implement as an `expires_at` column populated at write time; a future cleanup job can prune. Pre-mainnet, confirm with counsel.
5. **Dispute path — ops escalation only.** No self-service override in v1. Merchant dashboard surfaces the reject reason with a "contact support" copy. Document in `/m/compliance` UI.

---

## When picking this up

1. Confirm v0.7 (Plan 3) and v2.0 (Plan 4) decisions haven't drifted — compliance hooks plug in at the API layer above whatever gateway is current.
2. Run a 30-minute sanity call with the chosen provider's solutions engineer to confirm the API shape. Both Elliptic and TRM publish OpenAPI specs — read them first.
3. Start in `packages/app/lib/compliance/`. The Noop provider is the contract test for the interface. Ship it first, then layer real providers on top.
