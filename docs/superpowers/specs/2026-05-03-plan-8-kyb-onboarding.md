# Plan 8 — KYB merchant onboarding

**Status:** spec; mainnet-bar. Cheap to spec now while decisions are fresh, expensive (and slow) to design under regulator pressure later.
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-03
**Depends on:** v0.8.1 + Plan 5 Phase 0 (compliance hooks live)
**Blocks:** mainnet deployment

---

## Why this is required

Pre-mainnet, "merchant" means "any wallet that called `registerMerchant`." Mainnet partners (Circle, Arc, payment-rail counterparts) and regulators in our active jurisdictions will not let us settle real-money flows that way. KYB — verify the legal entity, the beneficial owner(s), and have them sign our terms — is the gating control. Until KYB exists, mainnet activations stay on a per-merchant manual list.

This is the second mainnet bar after Plan 5 (compliance hooks for end users). Plan 5 screens the wallets that pay; Plan 8 screens the merchants that get paid.

---

## Resolved decisions (2026-05-03 session)

| # | Decision | Note |
|---|---|---|
| 1 | **Jurisdictions day-one: OFAC + EU sanction lists.** | TR is dropped from the merchant set entirely — Turkey banned crypto payments, so onboarding TR-resident merchants would put them on the wrong side of their domestic regulator. We screen TR UBOs against OFAC+EU like everyone else, but a TR-incorporated merchant gets rejected at the policy layer before vendor verification. |
| 2 | **Depth: light KYB.** | Legal entity name + jurisdiction + tax id + UBO names + UBO ID document + UBO sanctions screen. No adverse-media or PEP at v1. |
| 3 | **Workflow: hybrid self-service + ops queue.** | Sumsub green → merchant auto-activated on the gateway. Sumsub red / yellow → ticket lands in a new `/m/onboarding` review queue for Arcora ops. |
| 4 | **ToS: re-sign on update.** | Each ToS version has a hash; merchants are inactive on the contract until they sign the current version. Bumping the ToS pauses settlement for merchants on prior versions until they re-sign. |
| 5 | **Compliance hand-off: auto.** | Sumsub green triggers a `flow=merchant_payout` screen via Plan-5 `screenWithAudit` against the merchant's payout address. Two screens fire at onboarding finish — one upfront via Sumsub (legal entity / UBO names against sanctions), one Plan-5 (payout wallet). Both must clear before the on-chain `setTokenSupport` + `registerMerchant` permissioning runs. |
| 6 | **Vendor: Sumsub.** | Startup pricing exists; their KYB SDK + API surface fits our hybrid flow. Migration to a different vendor stays possible — adapter pattern (same shape as Plan 5's compliance providers). |

---

## Architecture

### State machine

```
   ┌────────────────────────┐
   │ wallet-only (today)    │  ← testnet path stays this forever
   └──────────┬─────────────┘
              │   /m/onboarding/start
              ▼
   ┌────────────────────────┐
   │ kyb_pending            │
   │  ─ entity form filled  │
   │  ─ Sumsub session open │
   └──────────┬─────────────┘
              │   sumsub webhook: applicantReviewed
              ▼
        ┌─────────────────┐
        │ green / yellow  │
        │ / red branch    │
        └────────┬────────┘
                 │
       ┌─────────┼──────────┐
       ▼         ▼          ▼
   ┌──────┐  ┌──────┐  ┌──────┐
   │green │  │yellow│  │ red  │
   └──┬───┘  └──┬───┘  └──┬───┘
      │         │         │
      │         ▼         ▼
      │     ┌────────────────┐
      │     │ ops_review     │
      │     │ queue          │
      │     └──────┬─────────┘
      │            │ ops decision
      │            ▼
      │     ┌──────────────┐
      │     │ approved /   │
      │     │ rejected     │
      │     └──────┬───────┘
      │            │
      ▼            ▼
   ┌──────────────────────────┐
   │ approved                 │
   │ ─ Plan-5 payout screen   │
   │ ─ ToS hash recorded      │
   │ ─ on-chain registerMerchant
   │   via server hot wallet  │
   │ ─ active                 │
   └──────────────────────────┘
```

### Data model (Drizzle)

```ts
// packages/app/lib/db/schema.ts (additions)

export const kybStatus = pgEnum("kyb_status", [
  "wallet_only",     // testnet default; cannot onboard to mainnet
  "kyb_pending",     // entity form submitted, Sumsub session open
  "ops_review",      // Sumsub yellow/red, awaiting human decision
  "approved",        // Sumsub + Plan-5 + ToS all clear
  "rejected",        // hard reject; cannot re-apply without ops override
]);

export const merchantKyb = pgTable("merchant_kyb", {
  id: uuid("id").defaultRandom().primaryKey(),
  merchantId: uuid("merchant_id").notNull().references(() => merchants.id),

  // Entity bits (light KYB)
  legalEntityName: text("legal_entity_name").notNull(),
  jurisdiction: text("jurisdiction").notNull(),       // ISO-3166 alpha-2
  taxId: text("tax_id").notNull(),

  // Vendor handoff
  sumsubApplicantId: text("sumsub_applicant_id"),
  sumsubExternalId: text("sumsub_external_id").unique(),  // our merchantId, sent to Sumsub
  sumsubReviewResult: jsonb("sumsub_review_result"),       // raw verbatim payload for audit

  // ToS lifecycle
  tosVersionSigned: text("tos_version_signed"),            // semver-tagged ToS hash
  tosSignedAt: timestamp("tos_signed_at", { withTimezone: true }),
  tosSignature: text("tos_signature"),                     // EIP-191 signature over the ToS hash

  // Pipeline state
  status: kybStatus("status").notNull().default("kyb_pending"),
  rejectionReason: text("rejection_reason"),
  reviewerNote: text("reviewer_note"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tosVersions = pgTable("tos_versions", {
  version: text("version").primaryKey(),                   // e.g. "v1.0.0"
  hash: text("hash").notNull(),                            // keccak256 of the ToS markdown
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  url: text("url").notNull(),                              // public link to the immutable doc
});
```

### Adapter shape (mirrors Plan-5's compliance interface)

```ts
// packages/app/lib/kyb/provider.ts

export type KybDecision = "green" | "yellow" | "red";

export interface KybApplicantInput {
  externalId: string;            // our merchantId
  legalEntityName: string;
  jurisdiction: string;
  taxId: string;
  ubos: Array<{ name: string; dob: string; nationality: string }>;
}

export interface KybSession {
  sumsubApplicantId: string;
  hostedFlowUrl: string;          // where the merchant uploads docs
  expiresAt: Date;
}

export interface KybReview {
  decision: KybDecision;
  reasons: string[];
  rawPayload: unknown;            // verbatim provider response
  reviewedAt: Date;
}

export interface KybProvider {
  readonly name: "sumsub" | "noop";
  createSession(input: KybApplicantInput): Promise<KybSession>;
  // Webhook handler shape — provider-specific HMAC verification lives in the
  // adapter, the route just forwards the raw payload.
  parseWebhook(rawPayload: unknown, signature: string): Promise<KybReview>;
}
```

`NoopProvider` returns `green` for any input — used in vitest and on testnet so onboarding flows can be exercised without paying Sumsub.

`SumsubProvider` calls Sumsub's REST API for session creation and verifies their webhook HMAC. Shape inferred from Sumsub's published docs; calibrated against their actual OpenAPI on contract sign.

### Routes

```
POST /api/merchant/kyb/start         → creates kyb row, returns Sumsub hosted-flow URL
POST /api/merchant/kyb/webhook       → Sumsub webhook, HMAC-verified
POST /api/merchant/kyb/sign-tos      → records ToS signature for current version
POST /api/merchant/kyb/finalize      → server-side: runs Plan-5 payout screen + on-chain registerMerchant
GET  /api/merchant/kyb               → returns merchant's own kyb status (for dashboard)

POST /api/admin/kyb/review/[id]      → ops review action (approve / reject / note)
GET  /api/admin/kyb/queue            → ops review queue
```

### Pages

```
/m/onboarding/start          → entity form + UBO form
/m/onboarding/verify         → embeds Sumsub iframe / hosted flow
/m/onboarding/sign-tos       → renders current ToS, captures EIP-191 signature
/m/onboarding/done           → success / pending / rejected splash

/m/admin/kyb                 → ops review queue (separate auth gate from /m)
```

### Compliance integration with Plan 5

Plan 5 today fires `flow="merchant_payout"` on every `/api/invoices` call. With Plan 8 live, that screen shifts to **once at onboarding** plus the existing per-invoice cache lookup. Cache hit on every invoice, no provider call until cache TTL expires (24h). Net effect: same fail-closed posture, lower cost.

The on-chain `registerMerchant` only runs after all three checks pass: Sumsub green/ops-approved, Plan-5 payout screen `decision: allow`, ToS signature verified. If any gates the merchant, the row stays `kyb_pending` or `ops_review` and on-chain merchant state never gets created.

### ToS versioning

```ts
// packages/app/lib/tos/index.ts
export const CURRENT_TOS_VERSION = "v1.0.0";
export const CURRENT_TOS_HASH    = "0x…";  // keccak256 of /docs/tos/v1.0.0.md
```

When a new ToS version ships:
1. Add the markdown to `docs/tos/<version>.md` (immutable; new version = new file)
2. Compute hash, insert into `tos_versions`
3. Bump `CURRENT_TOS_VERSION` constant
4. Existing merchants get a banner in `/m/dashboard` until they re-sign

The on-chain gateway is **not** aware of ToS — that's an off-chain enforcement concern. Pause merchants whose `tosVersionSigned != CURRENT_TOS_VERSION` at the API layer (invoice create + checkout authorize both refuse).

---

## Out of scope (defer to v2 or separate plan)

- **Adverse media / PEP screening** — Sumsub offers it as an add-on; not in light KYB. v2 ask.
- **Multi-tenant policy customisation** (e.g. "this merchant requires deeper KYB") — single global policy in v1.
- **TR market entry** — blocked by domestic regulation. Reopen if/when TR crypto-payment rules change.
- **Periodic re-verification** — annual UBO / sanctions refresh. Add as a cron job in v1.x once data exists.
- **Merchant disputes against rejection** — same posture as Plan 5: ops escalation only.
- **Document storage** — Sumsub holds documents on their side; we store *only* references + result + UBO names. Reduces our GDPR surface.

---

## Effort

| Phase | Time | Cost |
|---|---|---|
| Spec review + Sumsub sandbox account creation | 0.5 day | $0 (sandbox is free) |
| `merchant_kyb` + `tos_versions` migrations + drizzle schema | 0.5 day | $0 |
| `KybProvider` interface + `NoopProvider` + `SumsubProvider` | 1.5 days | $0 |
| Webhook route + HMAC verification + state machine handlers | 1 day | $0 |
| Onboarding pages (start / verify / sign-tos / done) | 1.5 days | $0 |
| Ops review queue page + actions | 1 day | $0 |
| Plan-5 + on-chain `registerMerchant` orchestration on finalize | 0.5 day | $0 |
| Vitest coverage | 1 day | $0 |
| Sumsub sandbox end-to-end smoke (3–5 fake applicants) | 0.5 day | $0 |
| **Total to "KYB-ready on testnet, sandbox-only"** | **~8 days** | **$0** |
| Sumsub production onboarding (paid contract, KYB live for real money) | 1 day | $200–500/month + $2–8/verification |

---

## Open decisions to settle later

1. **EU vs each-EU-country**: do we treat all EU merchants the same, or distinguish e.g. Germany / Ireland / Netherlands at the form level? Sumsub handles per-country form requirements; we pick which countries to expose first.
2. **UBO threshold**: 25% (FATF default) or stricter? Affects who must be screened.
3. **ToS jurisdiction**: which legal regime governs the agreement? Affects which lawyer drafts it.
4. **GDPR retention**: how long do we keep `sumsub_review_result` for rejected merchants? Lean 5y (sanctions traceability) but confirm with counsel.
5. **Webhook signing key rotation**: how often, and what's the rotation procedure?

---

## Decision log (settled 2026-05-03)

- ✅ Jurisdictions: OFAC + EU. TR dropped (domestic crypto-payment ban).
- ✅ KYB depth: light (entity + UBO basics; no adverse-media / PEP).
- ✅ Workflow: Sumsub green = auto-activate; yellow/red = ops queue.
- ✅ ToS: hash-versioned, re-sign required on each new version.
- ✅ Compliance: auto-screen merchant payout via Plan-5 on onboarding finalize.
- ✅ Vendor: Sumsub for v1; adapter pattern preserves switching cost low.
- ❌ Adverse-media / PEP — v2 ask.
- ❌ Multi-tenant policy — v2 ask.
- ❌ Merchant dispute path — ops escalation only.
- ❌ TR-incorporated merchants — blocked by jurisdiction policy.

---

## When picking this up

1. Open a Sumsub sandbox account (free) — get API key + webhook secret. Confirms their actual API shape before locking the adapter.
2. Read this spec end-to-end; the open-decisions list may have updated.
3. Coordinate with Plan 5 (`packages/app/lib/compliance/`) — the merchant-payout screen call shifts from per-invoice to once-at-onboarding; verify Plan-5's cache TTL stays sensible.
4. Start with the migrations + adapter interface + Noop. Sumsub adapter follows once sandbox creds are in.
