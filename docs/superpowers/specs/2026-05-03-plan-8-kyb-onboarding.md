# Plan 8 — KYB merchant onboarding

**Status:** spec; mainnet-bar. Two-track strategy: `ManualKybProvider` for zero-cash testnet bridge (free OFAC + EU lists, manual ops review), `PersonaProvider` for post-revenue automated KYB. Adapter pattern lets us flip via env, no code change.
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-03 (revised same day — Sumsub dropped after self-serve signup paywall)
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
| 3 | **Workflow: hybrid self-service + ops queue.** | Vendor green → merchant auto-activated on the gateway. Vendor red / yellow (or Manual provider always) → ticket lands in `/m/admin/kyb` review queue for Arcora ops. |
| 4 | **ToS: re-sign on update.** | Each ToS version has a hash; merchants are inactive on the contract until they sign the current version. Bumping the ToS pauses settlement for merchants on prior versions until they re-sign. |
| 5 | **Compliance hand-off: auto.** | Vendor green triggers a `flow=merchant_payout` screen via Plan-5 `screenWithAudit` against the merchant's payout address. Two screens fire at onboarding finish — one upfront via the KYB provider (legal entity / UBO names against OFAC + EU), one Plan-5 (payout wallet). Both must clear before the on-chain `registerMerchant` (or its delegate-driven sibling) runs. |
| 6 | **Two-track vendor strategy.** | **Track A — `ManualKybProvider`** (today, $0): free OFAC SDN + EU Consolidated lists, ops manual review on `/m/admin/kyb` queue. **Track B — `PersonaProvider`** (mainnet T-0 or earlier if revenue lands): self-serve signup, free unlimited sandbox, automated KYB + sanctions + UBO. Switch is a config flip, no code change. **Sumsub dropped 2026-05-03** — no self-serve signup, sales-touch even for sandbox. |

---

## Architecture

### State machine (vendor-agnostic)

```
   ┌────────────────────────┐
   │ wallet-only (today)    │  ← testnet path stays this forever
   └──────────┬─────────────┘
              │   /m/onboarding/start
              ▼
   ┌────────────────────────┐
   │ kyb_pending            │
   │  ─ entity form filled  │
   │  ─ vendor session open │   (Persona inquiry, or Manual upload page)
   └──────────┬─────────────┘
              │   vendor webhook (Persona) or ops decision (Manual)
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
      │     │ queue          │  (always entered for Manual provider)
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

`ManualKybProvider` short-circuits the vendor branch: every applicant lands in `ops_review` directly, no automated green path. `PersonaProvider` returns green/yellow/red from the provider's webhook.

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

  // Vendor handoff (provider-agnostic — Persona uses inquiryId, Manual uses null)
  vendorProvider: text("vendor_provider").notNull(),       // 'persona' | 'manual' | 'noop'
  vendorApplicantId: text("vendor_applicant_id"),          // Persona inquiry id, or null for Manual
  vendorExternalId: text("vendor_external_id").unique(),   // our merchantId, sent to vendor as referenceId
  vendorReviewResult: jsonb("vendor_review_result"),       // raw verbatim payload (or document refs for Manual)

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
  vendorApplicantId: string | null;  // Persona inquiry id, null for Manual
  hostedFlowUrl: string;             // Persona-hosted page, or our /m/onboarding/upload route for Manual
  expiresAt: Date;
}

export interface KybReview {
  decision: KybDecision;
  reasons: string[];
  rawPayload: unknown;            // verbatim provider response (or document refs for Manual)
  reviewedAt: Date;
}

export interface KybProvider {
  readonly name: "persona" | "manual" | "noop";
  createSession(input: KybApplicantInput): Promise<KybSession>;
  // Webhook handler shape — provider-specific HMAC verification lives in the
  // adapter, the route just forwards the raw payload. `ManualKybProvider`
  // implements parseWebhook as a no-op (review fires from /m/admin/kyb route).
  parseWebhook(rawPayload: unknown, signature: string): Promise<KybReview>;
}
```

Three implementations:

1. **`NoopProvider`** — always returns `green`. Used in vitest and on testnet when KYB enforcement is off. Default in dev.
2. **`ManualKybProvider`** — primary track today. `createSession` returns a hosted-flow URL pointing at our own `/m/onboarding/upload` route; merchant uploads ID + entity docs to Vercel Blob; UBO names + entity name screened against locally-stored OFAC + EU lists; result lands in `ops_review` for Arcora ops to approve via `/m/admin/kyb`. `parseWebhook` is a no-op.
3. **`PersonaProvider`** — Persona's [Cases API](https://docs.withpersona.com/) for KYB. `createSession` creates a Persona Case with our `vendorExternalId` as `reference-id`; returns the hosted flow URL. Webhooks are HMAC-SHA256 over the body; the adapter verifies and maps Persona's verdict to our `KybDecision`. Production billing starts only when we connect a payment method — sandbox is unlimited.

### ManualKybProvider — what's actually doing the work

| Concern | Implementation |
|---|---|
| Sanctions data | Daily cron pulls [OFAC SDN](https://www.treasury.gov/ofac/downloads/sdn.xml) + [EU Consolidated](https://webgate.ec.europa.eu/fsd/fsf) into a `sanctions_list_entries` Postgres table. Schema: `(provider, listed_at, entity_type, name, normalised_name, raw)`. Indexes on normalised_name (lowercased + diacritics-stripped). |
| Name screening | `ILIKE` + trigram similarity (`pg_trgm`) match merchant entity name + each UBO name against `sanctions_list_entries`. False-positive review by ops is part of the workflow. |
| Document upload | Vercel Blob private bucket. Pre-signed URLs scoped to merchant + 24h TTL. We store the blob URL + content hash; documents themselves never enter the app server. |
| Review UI | `/m/admin/kyb` queue lists pending applicants with the docs, sanctions hits (if any), entered fields. Approve/reject/note. |
| Refresh cadence | Daily (sanctions lists are updated by issuers daily). Cron lives on the existing VPS (`arcora-sanctions-refresh.timer`). |

### Routes

```
POST /api/merchant/kyb/start         → creates kyb row, returns vendor hosted-flow URL
                                       (Persona inquiry URL, or our own /m/onboarding/upload for Manual)
POST /api/merchant/kyb/upload        → Manual provider: receive blob upload + run sanctions screen + queue ops_review
POST /api/merchant/kyb/webhook       → Persona webhook, HMAC-verified (no-op for Manual)
POST /api/merchant/kyb/sign-tos      → records ToS signature for current version
POST /api/merchant/kyb/finalize      → server-side: runs Plan-5 payout screen + on-chain registerMerchant
GET  /api/merchant/kyb               → returns merchant's own kyb status (for dashboard)

POST /api/admin/kyb/review/[id]      → ops review action (approve / reject / note)
GET  /api/admin/kyb/queue            → ops review queue
GET  /api/admin/kyb/sanctions/refresh → manual-trigger refresh of OFAC + EU lists (also runs as cron)
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

The on-chain `registerMerchant` only runs after all three checks pass: vendor green or ops-approved, Plan-5 payout screen `decision: allow`, ToS signature verified. If any gates the merchant, the row stays `kyb_pending` or `ops_review` and on-chain merchant state never gets created.

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

- **Adverse media / PEP screening** — vendor add-on (Persona offers it; ManualKybProvider doesn't). Not in light KYB. v2 ask.
- **Multi-tenant policy customisation** (e.g. "this merchant requires deeper KYB") — single global policy in v1.
- **TR market entry** — blocked by domestic regulation. Reopen if/when TR crypto-payment rules change.
- **Annual re-verification** — UBO + sanctions refresh on schedule. Add as a cron job in v1.x once data exists.
- **Merchant disputes against rejection** — same posture as Plan 5: ops escalation only.
- **Document storage on PersonaProvider** — Persona holds documents on their side; we store only references + result + UBO names. ManualKybProvider stores docs in Vercel Blob (we control retention; default 5y for sanctions traceability per memory).

---

## Effort

### Track A — `ManualKybProvider` (today, $0)

| Phase | Time | Cost |
|---|---|---|
| `merchant_kyb` + `tos_versions` + `sanctions_list_entries` migrations | 0.5 day | $0 |
| `KybProvider` interface + `NoopProvider` + `ManualKybProvider` | 1 day | $0 |
| OFAC + EU list importer (cron job + initial backfill) | 1 day | $0 |
| Onboarding pages (start / upload / sign-tos / done) | 1.5 days | $0 |
| `/m/admin/kyb` queue + actions | 1 day | $0 |
| Plan-5 + on-chain `registerMerchant` orchestration on finalize | 0.5 day | $0 |
| Vitest coverage | 1 day | $0 |
| End-to-end smoke (3–5 fake applicants, sanctioned + clean) | 0.5 day | $0 |
| **Total Track A — "Manual KYB live on testnet"** | **~7 days** | **$0** |

### Track B — `PersonaProvider` (when revenue lands)

| Phase | Time | Cost |
|---|---|---|
| Persona sandbox signup + Cases template config | 0.5 day | $0 (sandbox unlimited) |
| `PersonaProvider` adapter + webhook handler | 1.5 days | $0 |
| Hosted flow integration on `/m/onboarding/start` | 0.5 day | $0 |
| Smoke against Persona sandbox | 0.5 day | $0 |
| **Total Track B addition (assuming Track A live)** | **~3 days** | **$0** dev, ~$2–6 per business + $0.50–2 per UBO at production |

Tracks compose: Track A landed first, Track B added on top, env flip selects which one production uses.

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
- ✅ Workflow: vendor green = auto-activate; yellow/red (and all Manual) = ops queue.
- ✅ ToS: hash-versioned, re-sign required on each new version.
- ✅ Compliance: auto-screen merchant payout via Plan-5 on onboarding finalize.
- ✅ Two-track vendor strategy: `ManualKybProvider` today ($0), `PersonaProvider` post-revenue. Adapter pattern, env-flip switching.
- ❌ Sumsub — dropped 2026-05-03 (no self-serve signup, sales-touch even for sandbox; doesn't fit pre-revenue posture).
- ❌ Adverse-media / PEP — v2 ask.
- ❌ Multi-tenant policy — v2 ask.
- ❌ Merchant dispute path — ops escalation only.
- ❌ TR-incorporated merchants — blocked by jurisdiction policy.

---

## When picking this up

1. Read this spec end-to-end; the open-decisions list may have updated.
2. Coordinate with Plan 5 (`packages/app/lib/compliance/`) — the merchant-payout screen call shifts from per-invoice to once-at-onboarding; verify Plan-5's cache TTL stays sensible.
3. **Track A first**: migrations (`merchant_kyb` + `tos_versions` + `sanctions_list_entries`) + `KybProvider` interface + `NoopProvider` + `ManualKybProvider`. The OFAC + EU importer is the unique-to-this-spec piece — all else is web-app boilerplate.
4. **Track B second** (when revenue lands): open Persona sandbox at https://withpersona.com/signup using `compliance@arcorapay.xyz`. Their Cases API + webhook signing is documented; sandbox is free unlimited. Add `PersonaProvider` alongside `ManualKybProvider`; env flip selects.
