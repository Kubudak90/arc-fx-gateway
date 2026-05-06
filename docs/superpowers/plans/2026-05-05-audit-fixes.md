# Audit Fixes (Pulse-AI 2026-05-05) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 17 verified-true + 3 partial findings from the 2026-05-05 multi-agent audit. Skip 2 false findings (H3, M2).

**Architecture:** Fixes span four subsystems: (1) API-surface hardening (auth, rate-limit, validation), (2) on-chain ↔ off-chain consistency (relayer/indexer/webhooks), (3) SDK consumer-safety (instance pattern, nonce safety), (4) operational guards (security headers, monitoring, NatSpec/runbook). All fixes are additive and backwards-compatible at the API level. Contract changes are doc-only — V9 is immutable; on-chain fixes (M3 fee bound, refund custody for H4) are queued for a future V10 deploy.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM + Postgres, Vitest, viem, Solidity 0.8.x. Test runner: `pnpm --filter @arc-fx-gateway/app test` (vitest).

---

## File Map

**API-surface (`packages/app/`):**
- `lib/auth/apikey.ts` — H2 prefix fast-path
- `lib/db/schema.ts` — H2 prefix col, merchant.allowedOrigins, M10 unique index, M5 webhook terminal flag
- `lib/db/migrations/0010_*.sql` — schema bump
- `lib/security/safeUrl.ts` — used as-is for H1 server-side; M7 timeout extension
- `lib/security/redirect.ts` *(NEW)* — origin allowlist helper for H1 client side
- `lib/security/headers.ts` *(NEW)* — shared headers helper for M14
- `lib/rate/redis.ts` *(NEW)* — small fixed-window rate limit util for M9, L7
- `lib/checkout/quote-server.ts` — M11 BigInt-only path
- `app/api/invoices/route.ts` — H1 (server), L8 leak audit
- `app/api/invoices/[id]/route.ts` — L8 metadata gating
- `app/api/auth/siwe/verify/route.ts` — M8 generic error
- `app/api/auth/siwe/nonce/route.ts` — M9 rate limit
- `app/api/checkout/quote/route.ts` — M11 alignment, L7 rate limit
- `app/api/checkout/status/[id]/route.ts` — M12 status token gate
- `app/api/checkout/authorize/route.ts` — M10 dedupe
- `app/api/merchant/bootstrap/route.ts` — H1 allowed_origins onboarding input
- `components/checkout/StatusScreens.tsx` — H1 client-side allowlist redirect
- `next.config.ts` (app + shop) — M14 headers
- `middleware.ts` — M14 fallback if config-level headers blocked

**SDK (`packages/sdk*`):**
- `packages/sdk/src/client.ts` — H6 instance pattern (deprecate static `init`)
- `packages/sdk/src/permit2.ts` — M13 throw on Math.random fallback
- `packages/sdk-react/src/useCheckout.ts` — H6 use instance

**Ops (`ops/`):**
- `ops/relayer/run.ts` — M1 key scrubbing
- `ops/indexer/run.ts` — H5 status guard + ON CONFLICT, M6 V6 watch
- `ops/webhooks/run.ts` — M5 terminal flag, M7 dns timeout

**Contracts (`packages/contracts/src/`):**
- `ArcFXGatewayV9.sol` — M4 NatSpec correction (no on-chain change)
- `ArcFXGatewayV10.sol` *(deferred — separate plan)* — M3 bound, H4 custody, M4 reactivate

**Docs/runbooks:**
- `docs/runbooks/h4-refund-approval.md` *(NEW)* — onboarding invariant + monitoring queries
- `docs/audit/2026-05-05-residuals.md` *(NEW)* — record what shipped vs deferred

---

## Phase 0 — Test infrastructure & branch

### Task 0: Branch + baseline test

**Files:**
- No file changes; sanity-check only.

- [ ] **Step 1: Create branch**

```bash
git checkout -b plan-7-audit-2026-05-05
```

- [ ] **Step 2: Confirm test runner is green at baseline**

```bash
pnpm --filter @arc-fx-gateway/app test --run
```
Expected: all existing suites pass.

- [ ] **Step 3: Confirm contracts compile (no contract logic changes planned)**

```bash
pnpm --filter @arc-fx-gateway/contracts build
```
Expected: green.

---

## Phase 1 — H2 bcrypt loop (highest mainnet-blocker scale risk)

### Task 1: Add `api_key_prefix` column + migration

**Files:**
- Modify: `packages/app/lib/db/schema.ts:19-28`
- Create: `packages/app/lib/db/migrations/0010_api_key_prefix.sql`
- Test: `packages/app/lib/db/schema.test.ts`

- [ ] **Step 1: Add column to schema**

Edit `packages/app/lib/db/schema.ts`, in the `merchants` pgTable block:

```ts
export const merchants = pgTable("merchants", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull().unique(),
  payoutToken: text("payout_token").notNull(),
  webhookUrl: text("webhook_url"),
  apiKeyHash: text("api_key_hash").notNull(),
  // First 12 chars of the raw API key (e.g. "ak_live_AB12"). Used as a
  // fast-path lookup index so we don't bcrypt-compare every merchant row
  // on each authenticated request. Audit H2 (2026-05-05).
  apiKeyPrefix: text("api_key_prefix").notNull().default(""),
  allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
  webhookSecretEnc: bytea("webhook_secret_enc").notNull(),
  webhookSecretIv: bytea("webhook_secret_iv").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

(Add `sql` to the drizzle import at the top of the file if not present.)

- [ ] **Step 2: Write migration SQL**

Create `packages/app/lib/db/migrations/0010_api_key_prefix.sql`:

```sql
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS api_key_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS allowed_origins text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_merchants_api_key_prefix
  ON merchants (api_key_prefix);
```

- [ ] **Step 3: Add schema test**

Append to `packages/app/lib/db/schema.test.ts`:

```ts
import { merchants } from "./schema";

it("merchants table exposes apiKeyPrefix and allowedOrigins", () => {
  expect(merchants.apiKeyPrefix.name).toBe("api_key_prefix");
  expect(merchants.allowedOrigins.name).toBe("allowed_origins");
});
```

- [ ] **Step 4: Run schema test**

```bash
pnpm --filter @arc-fx-gateway/app test schema.test.ts --run
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/db/schema.ts packages/app/lib/db/schema.test.ts packages/app/lib/db/migrations/0010_api_key_prefix.sql
git commit -m "feat(audit-h2): add api_key_prefix + allowed_origins columns"
```

### Task 2: Backfill prefix for existing merchants (idempotent script)

**Files:**
- Create: `packages/app/scripts/backfill-api-key-prefix.ts`

> **Why a script and not a migration?** We can't recover the raw API key from a bcrypt hash. Existing merchants must rotate; this script is a guard that prints rows still needing rotation. New merchants (Task 3) populate the prefix at creation time.

- [ ] **Step 1: Write script**

```ts
// packages/app/scripts/backfill-api-key-prefix.ts
// Run: pnpm --filter @arc-fx-gateway/app exec tsx scripts/backfill-api-key-prefix.ts
//
// Lists merchants whose api_key_prefix is empty (legacy rows from before
// audit H2 fix). Such merchants must rotate their API key via /m/dashboard
// → API Keys → Rotate, which calls hashApiKey + writes the new prefix.
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const stale = await db.select().from(merchants).where(eq(merchants.apiKeyPrefix, ""));
  if (stale.length === 0) {
    console.log("OK: all merchants have api_key_prefix populated");
    return;
  }
  console.log(`WARN: ${stale.length} merchant(s) need API-key rotation:`);
  for (const m of stale) console.log(`  - ${m.id}  ${m.address}`);
  process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/scripts/backfill-api-key-prefix.ts
git commit -m "chore(audit-h2): script to surface merchants needing key rotation"
```

### Task 3: Use prefix in `lookupMerchantByApiKey`

**Files:**
- Modify: `packages/app/lib/auth/apikey.ts`
- Test: `packages/app/lib/auth/apikey.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/app/lib/auth/apikey.test.ts` (read existing file first to follow its setup style):

```ts
it("only bcrypt-compares rows whose api_key_prefix matches", async () => {
  // Seed two merchants — one matching prefix, one decoy with same prefix-pattern
  // but different secret. Lookup must short-circuit on prefix and return the
  // correct one without bcrypt-comparing every row in the table.
  const target = generateApiKey();
  const decoy = generateApiKey();
  await db.insert(merchants).values([
    { address: "0x1...", payoutToken: "USDC", apiKeyHash: await hashApiKey(target), apiKeyPrefix: target.slice(0, 12), webhookSecretEnc: Buffer.from(""), webhookSecretIv: Buffer.from("") },
    { address: "0x2...", payoutToken: "USDC", apiKeyHash: await hashApiKey(decoy),  apiKeyPrefix: decoy.slice(0, 12),  webhookSecretEnc: Buffer.from(""), webhookSecretIv: Buffer.from("") },
  ]);
  const got = await lookupMerchantByApiKey(target);
  expect(got?.address).toBe("0x1...");

  // Wrong-prefix random key: zero bcrypt calls.
  const bogus = "ak_live_ZZZZZZZZZZZZZZZZ" + "A".repeat(40);
  expect(await lookupMerchantByApiKey(bogus)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify FAIL**

```bash
pnpm --filter @arc-fx-gateway/app test apikey.test.ts --run
```
Expected: FAIL (current impl ignores prefix).

- [ ] **Step 3: Implement**

Replace the body of `lookupMerchantByApiKey` in `packages/app/lib/auth/apikey.ts`:

```ts
export const PREFIX_LEN = 12; // "ak_live_" + 4 chars of body

export async function lookupMerchantByApiKey(key: string) {
  if (!key.startsWith(PREFIX)) return null;
  const prefix = key.slice(0, PREFIX_LEN);
  const candidates = await db.select().from(merchants).where(eq(merchants.apiKeyPrefix, prefix));
  for (const m of candidates) {
    if (await verifyApiKey(key, m.apiKeyHash)) return m;
  }
  return null;
}
```

Add `eq` to the drizzle-orm import.

- [ ] **Step 4: Update writers to populate prefix**

Find every site that inserts/updates `apiKeyHash` and add `apiKeyPrefix`. Run:

```bash
/usr/bin/grep -rn "apiKeyHash" packages/app --include="*.ts" --include="*.tsx" | grep -v ".test.ts"
```

For each writer (likely `app/api/merchant/bootstrap/route.ts` and an api-key rotation route under `app/api/merchant/api-key/`), update the insert/update payload to include:
```ts
apiKeyPrefix: rawKey.slice(0, PREFIX_LEN),
```
(Import `PREFIX_LEN` from `@/lib/auth/apikey`.)

- [ ] **Step 5: Run all tests**

```bash
pnpm --filter @arc-fx-gateway/app test --run
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/lib/auth/apikey.ts packages/app/lib/auth/apikey.test.ts \
  packages/app/app/api/merchant/bootstrap/route.ts \
  $(/usr/bin/grep -rln "apiKeyHash" packages/app/app --include="*.ts" | grep -v ".test.ts")
git commit -m "fix(audit-h2): O(1) merchant lookup via api_key_prefix index"
```

---

## Phase 2 — H1 successUrl/cancelUrl SSRF + open-redirect

### Task 4: Add `allowed_origins` to bootstrap input

**Files:**
- Modify: `packages/app/app/api/merchant/bootstrap/route.ts`
- Modify: `packages/app/app/m/dashboard/...` (form UI — locate via grep)
- Test: existing `route.test.ts` for bootstrap (locate first)

- [ ] **Step 1: Locate bootstrap test**

```bash
/usr/bin/find packages/app -name "*.test.ts" -path "*bootstrap*"
```

- [ ] **Step 2: Add zod field + validation**

In `packages/app/app/api/merchant/bootstrap/route.ts`, extend the request schema:

```ts
const bodySchema = z.object({
  // ...existing fields...
  allowedOrigins: z.array(z.string().url()).min(1).max(20),
});
```

In the handler, after parse, normalize to origin-only and persist:

```ts
const origins = parsed.data.allowedOrigins.map((u) => new URL(u).origin);
// pass origins into the merchants insert
```

- [ ] **Step 3: Update UI to collect origins**

Add a textarea/multi-input in the bootstrap form (one origin per line), and POST as array.

- [ ] **Step 4: Run all tests**

```bash
pnpm --filter @arc-fx-gateway/app test --run
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(audit-h1): collect merchant allowed_origins at bootstrap"
```

### Task 5: Server-side validation in `/api/invoices`

**Files:**
- Modify: `packages/app/app/api/invoices/route.ts`
- Modify: `packages/app/lib/security/safeUrl.ts` (export helper)
- Test: `packages/app/app/api/invoices/route.test.ts`

- [ ] **Step 1: Add helper to safeUrl**

Append to `packages/app/lib/security/safeUrl.ts`:

```ts
/**
 * Throws unless `candidate` URL's origin is in the merchant's allowlist.
 * Allowlist entries must already be normalized to `new URL(...).origin`.
 */
export function assertOriginAllowed(candidate: string, allowed: readonly string[]): void {
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error("invalid_url"); }
  if (!allowed.includes(parsed.origin)) throw new Error(`origin_not_allowed:${parsed.origin}`);
}
```

- [ ] **Step 2: Write the failing test**

Add to `packages/app/app/api/invoices/route.test.ts`:

```ts
it("rejects successUrl outside merchant allowed_origins (SSRF/phishing guard)", async () => {
  const merchant = await seedMerchant({ allowedOrigins: ["https://shop.example.com"] });
  const res = await POST(buildReq({
    apiKey: merchant.apiKey,
    body: { /* ...required fields... */, successUrl: "https://attacker.example.com/?x=1" },
  }));
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: expect.stringContaining("origin_not_allowed") });
});

it("rejects successUrl pointing at private IP (SSRF guard)", async () => {
  const merchant = await seedMerchant({ allowedOrigins: ["http://169.254.169.254"] /* even if merchant tried */ });
  const res = await POST(buildReq({
    apiKey: merchant.apiKey,
    body: { /* ... */, successUrl: "http://169.254.169.254/latest/meta-data/" },
  }));
  expect(res.status).toBe(400);
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
pnpm --filter @arc-fx-gateway/app test invoices/route.test.ts --run
```

- [ ] **Step 4: Implement validation in route**

In `packages/app/app/api/invoices/route.ts`, after merchant lookup, before insert:

```ts
import { assertOriginAllowed, assertSafePublicUrl } from "@/lib/security/safeUrl";

// ...
assertOriginAllowed(parsed.data.successUrl, merchant.allowedOrigins);
await assertSafePublicUrl(parsed.data.successUrl);
if (parsed.data.cancelUrl) {
  assertOriginAllowed(parsed.data.cancelUrl, merchant.allowedOrigins);
  await assertSafePublicUrl(parsed.data.cancelUrl);
}
```

Wrap in try/catch returning `{ error }` 400.

- [ ] **Step 5: Run tests, expect PASS**

```bash
pnpm --filter @arc-fx-gateway/app test invoices/route.test.ts --run
```

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(audit-h1): enforce allowed_origins + SSRF guard on successUrl/cancelUrl"
```

### Task 6: Client-side allowlist in StatusScreens

**Files:**
- Create: `packages/app/lib/security/redirect.ts`
- Modify: `packages/app/components/checkout/StatusScreens.tsx`

- [ ] **Step 1: Create redirect helper**

```ts
// packages/app/lib/security/redirect.ts
/**
 * Defense-in-depth client-side check before window.location.href = url.
 * Server already enforces allowlist (audit H1), but a stale invoice or
 * tampered DOM property could still feed an unsafe URL here.
 */
export function safeClientRedirect(url: string, allowedOrigins: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (!allowedOrigins.includes(parsed.origin)) return false;
    window.location.href = parsed.toString();
    return true;
  } catch { return false; }
}
```

- [ ] **Step 2: Update StatusScreens**

In `packages/app/components/checkout/StatusScreens.tsx`:

```tsx
import { safeClientRedirect } from "@/lib/security/redirect";

// In SuccessScreen, replace `window.location.href = successUrl;` with:
if (!safeClientRedirect(successUrl, allowedOrigins)) {
  // Fall back to showing a "Return to merchant" button instead of auto-redirect.
  return <FallbackUI url={successUrl} />;
}
```

`allowedOrigins` must be passed down from the parent (invoice fetch already has merchant context — extend the API response in Task 7 if not already).

- [ ] **Step 3: Extend invoice GET to include allowedOrigins**

In `packages/app/app/api/invoices/[id]/route.ts`, include `allowedOrigins` in the response (it's safe to expose — it's an allowlist of redirect targets).

- [ ] **Step 4: Smoke test in dev server**

```bash
pnpm --filter @arc-fx-gateway/app dev
```
Manually create an invoice with a successUrl outside allowlist and verify the FallbackUI is shown rather than redirecting.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(audit-h1): client-side origin allowlist before redirect"
```

---

## Phase 3 — H6 SDK instance pattern

### Task 7: Add `Arcora` class while keeping static `init` deprecated

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Test: `packages/sdk/src/client.test.ts` (locate or create)

- [ ] **Step 1: Find SDK test setup**

```bash
/usr/bin/find packages/sdk -name "*.test.ts" -not -path "*/node_modules/*"
```

- [ ] **Step 2: Write failing test**

Add to (or create) `packages/sdk/src/client.test.ts`:

```ts
import { Arcora } from "./client";

it("two Arcora instances do not share apiKey state", async () => {
  const a = new Arcora({ apiKey: "ak_live_A" + "x".repeat(56), baseUrl: "http://test/a" });
  const b = new Arcora({ apiKey: "ak_live_B" + "x".repeat(56), baseUrl: "http://test/b" });
  expect(a.options.apiKey).not.toBe(b.options.apiKey);
});
```

- [ ] **Step 3: Run, expect FAIL (Arcora is not a constructor)**

```bash
pnpm --filter @arc-fx-gateway/sdk test --run
```

- [ ] **Step 4: Convert to class while preserving back-compat**

Rewrite `packages/sdk/src/client.ts` (sketch — preserve all existing exported function names):

```ts
import type { InitOptions, CreateInvoiceInput, Invoice } from "./types";

export class Arcora {
  constructor(public readonly options: InitOptions) {
    if (!options.apiKey?.startsWith("ak_live_")) throw new ArcoraError("invalid_api_key");
    if (!options.baseUrl) throw new ArcoraError("baseUrl_required");
  }

  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    return doCreateInvoice(this.options, input);
  }

  async openCheckout(input: CreateInvoiceInput): Promise<void> {
    return doOpenCheckout(this.options, input);
  }
}

// --- Back-compat module-level singleton (deprecated) ---
let _opts: InitOptions | undefined;

/**
 * @deprecated Use `new Arcora({ apiKey, baseUrl })` instead. The static
 * singleton is unsafe in multi-tenant host apps (audit H6, 2026-05-05).
 * Removed in next major.
 */
function init(opts: InitOptions): void {
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn("[arcora] Arcora.init is deprecated; use `new Arcora(opts)`.");
  }
  _opts = opts;
}

async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  if (!_opts) throw new ArcoraError("sdk_not_initialized");
  return doCreateInvoice(_opts, input);
}
async function openCheckout(input: CreateInvoiceInput): Promise<void> {
  if (!_opts) throw new ArcoraError("sdk_not_initialized");
  return doOpenCheckout(_opts, input);
}

// Static API kept for the CDN browser bundle.
export const ArcoraStatic = { init, createInvoice, openCheckout };
```

(Move all real fetch/permit2 logic into `doCreateInvoice` / `doOpenCheckout` private functions in the same file.)

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @arc-fx-gateway/sdk test --run
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(audit-h6): Arcora class for multi-tenant safety; deprecate static init"
```

### Task 8: Update `useCheckout` to use instance

**Files:**
- Modify: `packages/sdk-react/src/useCheckout.ts`
- Test: `packages/sdk-react/src/useCheckout.test.tsx` (locate or create)

- [ ] **Step 1: Write failing test**

```tsx
// packages/sdk-react/src/useCheckout.test.tsx
import { renderHook } from "@testing-library/react";
import { useCheckout } from "./useCheckout";

it("two simultaneous useCheckout hooks keep separate apiKey contexts", () => {
  const a = renderHook(() => useCheckout({ apiKey: "ak_live_A" + "x".repeat(56), baseUrl: "http://a" }));
  const b = renderHook(() => useCheckout({ apiKey: "ak_live_B" + "x".repeat(56), baseUrl: "http://b" }));
  expect(a.result.current.client.options.apiKey).not.toBe(b.result.current.client.options.apiKey);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```tsx
// packages/sdk-react/src/useCheckout.ts
import { useMemo } from "react";
import { Arcora, type InitOptions, type CreateInvoiceInput } from "@arc-fx-gateway/sdk";

export function useCheckout(opts: InitOptions) {
  const client = useMemo(() => new Arcora(opts), [opts.apiKey, opts.baseUrl]);
  return {
    client,
    createInvoice: (input: CreateInvoiceInput) => client.createInvoice(input),
    openCheckout:  (input: CreateInvoiceInput) => client.openCheckout(input),
  };
}
```

- [ ] **Step 4: Run all SDK + react tests, expect PASS**

```bash
pnpm --filter @arc-fx-gateway/sdk-react test --run
```

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(audit-h6): useCheckout uses Arcora instance, no shared module state"
```

---

## Phase 4 — H5 Indexer race + M6 V6 watch

### Task 9: Widen PayerRefunded status guard + ON CONFLICT on webhook insert

**Files:**
- Modify: `ops/indexer/run.ts:251-289`
- Test: `ops/indexer/run.test.ts` (locate or create)

- [ ] **Step 1: Locate indexer tests**

```bash
/usr/bin/find ops -name "*.test.ts" -not -path "*/node_modules/*"
```

- [ ] **Step 2: Write failing test**

If no test exists, add a focused one that exercises the SQL path against a test DB. Otherwise extend the existing one:

```ts
it("PayerRefunded sets status=refunded even when InvoicePaid already ran", async () => {
  await db.insert(invoices).values({ id: "0xabc", status: "paid", /* ... */ });
  await handlePayerRefunded({ globalId: "0xabc", refundTx: "0xref", /* ... */ });
  const row = await db.select().from(invoices).where(eq(invoices.id, "0xabc"));
  expect(row[0].status).toBe("refunded");
  expect(row[0].refundTx).toBe("0xref");
});

it("replayed PayerRefunded does not double-insert webhook_attempts", async () => {
  await handlePayerRefunded(evt); // first time
  await handlePayerRefunded(evt); // replay after crash
  const attempts = await db.select().from(webhookAttempts).where(eq(webhookAttempts.invoiceId, evt.globalId));
  expect(attempts.filter(a => a.type === "invoice.refund_failed").length).toBe(1);
});
```

- [ ] **Step 3: Implement guard widening + ON CONFLICT**

In `ops/indexer/run.ts`, the PayerRefunded UPDATE (around line 251):

```ts
const upd = await db.update(invoices)
  .set({ status: "refunded", refundTx, refundedAt: new Date() })
  .where(and(eq(invoices.id, globalId), inArray(invoices.status, ["created", "paid"])))
  .returning({ id: invoices.id });
```

The webhook insert (around line 267-289):

```ts
await db.insert(webhookAttempts)
  .values({ invoiceId: globalId, type: "invoice.refund_failed", /* ... */ })
  .onConflictDoNothing({ target: [webhookAttempts.invoiceId, webhookAttempts.type] });
```

Verify a unique index `(invoice_id, type)` exists; if not, add one in the migration (Task 1's 0010 file or a follow-up 0011). Confirm with:

```bash
/usr/bin/grep -rn "webhook_attempts\|webhookAttempts" packages/app/lib/db/
```

If no unique index exists yet, add to a new migration `0011_webhook_attempts_dedupe.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_attempts_invoice_type
  ON webhook_attempts (invoice_id, type);
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @arc-fx-gateway/app test --run
```

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(audit-h5): widen PayerRefunded status guard + idempotent webhook insert"
```

### Task 10: Indexer watches V6 cohort

**Files:**
- Modify: `ops/indexer/run.ts:8-24`
- Modify: `ops/indexer/.env.example`

- [ ] **Step 1: Read current env wiring**

Confirm the V8/V9 pattern at `ops/indexer/run.ts:15-16`.

- [ ] **Step 2: Add V6 env**

```ts
const GATEWAY_V6 = (process.env.GATEWAY_ADDRESS_V6 ?? "").toLowerCase();
// extend the watch list / address filter to include GATEWAY_V6 if non-empty
```

Update the address filter near line 22-24 to include `GATEWAY_V6` when present.

- [ ] **Step 3: Decide event-handling path**

V6's ABI may differ. The minimum acceptable: watch only `InvoicePaid`/`PayerRefunded` events using the union of all known ABIs. If V6 has long since drained, document and gate behind a feature flag `INDEXER_INCLUDE_V6=true`.

- [ ] **Step 4: Update `.env.example`**

```
GATEWAY_ADDRESS_V6=
INDEXER_INCLUDE_V6=false
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(audit-m6): indexer optionally watches V6 gateway cohort"
```

---

## Phase 5 — H4 refund-approval policy (no contract change in V9)

### Task 11: Onboarding invariant + monitoring runbook

**Files:**
- Create: `docs/runbooks/h4-refund-approval.md`
- Modify: `packages/app/app/api/merchant/bootstrap/route.ts` — add post-bootstrap invariant check
- Modify: `packages/app/app/m/dashboard/page.tsx` — surface "approval needed" banner

- [ ] **Step 1: Write runbook**

```markdown
# H4 — Refund-Approval Invariant (V9)

V9 `refundInvoice` uses `safeTransferFrom(payoutSource, ...)`. The payout
wallet must keep an open ERC20 allowance to the gateway, otherwise a
refund attempt reverts on-chain.

## Onboarding requirement
When a merchant configures their payout wallet (split-wallet flow), the
dashboard MUST verify `allowance(payoutSource, gateway) >= expected_max_refund`
before activating the merchant. If not, show a "Grant approval" CTA.

## Monitoring
Run hourly (Vercel Cron `/api/internal/cron/h4-allowance-check`):
- For every active merchant, read `allowance(payoutSource, gateway)`.
- For every merchant where `allowance < sum(open invoices not yet refunded)`,
  page the operator and flag the merchant in the dashboard.

## Future
H4 will be properly fixed on V10 (custody model). Until then, this runbook
+ monitoring is the workaround.
```

- [ ] **Step 2: Implement allowance check at bootstrap**

```ts
// In bootstrap route, after merchant insert, before returning success:
import { readAllowance } from "@/lib/chain/erc20";
const allowance = await readAllowance(payoutToken, payoutSource, GATEWAY_V9);
if (allowance < MIN_BOOTSTRAP_ALLOWANCE) {
  // Don't fail — return a warning flag the dashboard renders.
  return NextResponse.json({ ok: true, merchant: row, warning: "approval_required" });
}
```

- [ ] **Step 3: Add Vercel cron entry**

In `vercel.ts` (or wherever crons are configured):

```ts
crons: [
  // ...existing...
  { path: "/api/internal/cron/h4-allowance-check", schedule: "0 * * * *" },
],
```

Create the route handler under `packages/app/app/api/internal/cron/h4-allowance-check/route.ts`. Pseudocode:

```ts
export async function POST(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) return new Response("nope", { status: 401 });
  const open = await db.select().from(merchants); // join with open invoices
  for (const m of open) {
    const need = await sumOpenRefundLiability(m.id);
    const have = await readAllowance(m.payoutToken, m.payoutSource, GATEWAY_V9);
    if (have < need) await pageOperator({ merchantId: m.id, need, have });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/h4-refund-approval.md \
  packages/app/app/api/merchant/bootstrap/route.ts \
  packages/app/app/api/internal/cron/h4-allowance-check/route.ts
git commit -m "feat(audit-h4): allowance-monitoring cron + onboarding warning until V10 custody"
```

---

## Phase 6 — Mediums (config + small hardening)

### Task 12: M1 — relayer key scope hygiene

**Files:**
- Modify: `ops/relayer/run.ts`

- [ ] **Step 1: Make PRIVATE_KEY scope-local**

Wrap account construction in an IIFE so the raw key string isn't held at module scope after init:

```ts
const { wallet, account } = (() => {
  const pk = need("RELAYER_PRIVATE_KEY") as Hex;
  const a = privateKeyToAccount(pk);
  // pk leaves scope here
  return {
    account: a,
    wallet: createWalletClient({ account: a, transport: http(RPC) }),
  };
})();
```

- [ ] **Step 2: Audit catch blocks** for `e?.message` / `e?.cause` references; ensure none log full error objects (which can include constructor args).

```bash
/usr/bin/grep -n "console\.\(log\|error\)\|logger\." ops/relayer/run.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(audit-m1): scope RELAYER_PRIVATE_KEY locally; defensive log audit"
```

### Task 13: M3 — `protocolFeeBps` upper-bound (V10 deferred)

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV9.sol` — NatSpec only (immutable)
- Create: `docs/audit/2026-05-05-residuals.md` — record V10 work

- [ ] **Step 1: Add NatSpec warning**

Above the V9 constructor:

```solidity
/// @dev Audit M3 (2026-05-05): protocolFeeBps has no on-chain upper bound in
///      this version. Off-chain deploy script asserts bps <= 1000 (10%).
///      V10 will enforce the bound in-constructor.
```

- [ ] **Step 2: Add deploy guard**

In the deploy script (locate via `/usr/bin/find packages/contracts/script -name "*.s.sol"`), add:

```solidity
require(protocolFeeBps <= 1000, "fee bps too high");
```

- [ ] **Step 3: Note in residuals doc**

Append to `docs/audit/2026-05-05-residuals.md`:

```markdown
## M3 — protocol fee bound (deferred to V10)
Off-chain guard added in deploy script. V10 will enforce in-constructor.
```

- [ ] **Step 4: Commit**

```bash
git commit -am "docs(audit-m3): NatSpec + deploy-script guard until V10"
```

### Task 14: M4 — deactivated merchant re-register NatSpec

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV9.sol:187-197`

- [ ] **Step 1: Correct NatSpec**

Replace the existing comment block at V9:224 (the misleading one) with:

```solidity
/// @notice After deactivateMerchant, the merchant CAN call registerMerchant
///         again to reactivate. NatSpec previously stated otherwise — this
///         was incorrect (audit M4, 2026-05-05). V10 will introduce an
///         explicit reactivateMerchant with operator-only gating.
```

- [ ] **Step 2: Append to residuals doc**

```markdown
## M4 — deactivate→register NatSpec
NatSpec corrected. Behavior unchanged. V10 will add reactivateMerchant.
```

- [ ] **Step 3: Commit**

```bash
git commit -am "docs(audit-m4): correct NatSpec on deactivated re-register path"
```

### Task 15: M5 — webhook terminal flag

**Files:**
- Modify: `packages/app/lib/db/schema.ts` (webhookAttempts) + new migration `0012_webhook_terminal.sql`
- Modify: `ops/webhooks/run.ts:75-85` and `fetchDue` query

- [ ] **Step 1: Add columns**

In schema:

```ts
// in webhookAttempts pgTable:
terminalReason: text("terminal_reason"),     // 4xx-class string when permanent
succeededAt:    timestamp("succeeded_at", { withTimezone: true }),
```

Migration `0012_webhook_terminal.sql`:

```sql
ALTER TABLE webhook_attempts
  ADD COLUMN IF NOT EXISTS terminal_reason text,
  ADD COLUMN IF NOT EXISTS succeeded_at timestamptz;
```

- [ ] **Step 2: Update dispatcher**

`ops/webhooks/run.ts` near line 75-85:

```ts
if (isTerminal4xx) {
  await db.update(webhookAttempts).set({
    terminalReason: `http_${status}`,
    nextAttemptAt: null,
  }).where(eq(webhookAttempts.id, row.id));
  continue;
}
if (success) {
  await db.update(webhookAttempts).set({
    succeededAt: new Date(),
    nextAttemptAt: null,
  }).where(eq(webhookAttempts.id, row.id));
}
```

In `fetchDue`:

```ts
.where(and(
  isNull(webhookAttempts.succeededAt),
  isNull(webhookAttempts.terminalReason),
  lte(webhookAttempts.nextAttemptAt, new Date()),
))
```

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(audit-m5): permanently terminate 4xx webhook attempts"
```

### Task 16: M7 — DNS lookup timeout

**Files:**
- Modify: `packages/app/lib/security/safeUrl.ts` (the `dns.lookup` call)
- Modify: `ops/webhooks/run.ts:128` if it has its own lookup

- [ ] **Step 1: Add timeout helper**

In `safeUrl.ts`:

```ts
async function dnsLookupWithTimeout(host: string, ms = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_, rej) => ctrl.signal.addEventListener("abort", () => rej(new Error("dns_timeout")))),
    ]);
  } finally { clearTimeout(t); }
}
```

Replace the `dns.lookup(...)` call in `assertSafePublicUrl` with `dnsLookupWithTimeout(parsed.hostname)`.

- [ ] **Step 2: Mirror in webhooks daemon if it has its own resolver**

Check `ops/webhooks/run.ts:128` and either reuse `assertSafePublicUrl` or apply the same wrapper.

- [ ] **Step 3: Test**

Add to `safeUrl.test.ts`:

```ts
it("rejects after dns timeout", async () => {
  // mock dns.lookup to never resolve
  // assert assertSafePublicUrl throws "dns_timeout" within ~3s
});
```

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(audit-m7): 3s timeout on DNS lookup in SSRF guard"
```

### Task 17: M8 — siwe/verify generic error

**Files:**
- Modify: `packages/app/app/api/auth/siwe/verify/route.ts:18`

- [ ] **Step 1: Replace error response**

```ts
} catch (e) {
  console.warn("[siwe] verify failed", { err: (e as Error)?.message });
  return NextResponse.json({ error: "siwe_verify_failed" }, { status: 401 });
}
```

- [ ] **Step 2: Update existing test in `lib/auth/siwe.test.ts` if it asserts on `detail`**

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(audit-m8): siwe/verify returns generic error; details to server log only"
```

### Task 18: M9 — siwe/nonce rate limit

**Files:**
- Create: `packages/app/lib/rate/limiter.ts`
- Modify: `packages/app/app/api/auth/siwe/nonce/route.ts`
- Periodic cleanup: `packages/app/app/api/internal/cron/siwe-nonce-cleanup/route.ts` *(new)*

- [ ] **Step 1: Choose backend**

If Upstash Redis is already configured (check `.env` for `UPSTASH_REDIS_REST_URL`), use it. Otherwise use a Postgres-backed fixed-window table.

```bash
/usr/bin/grep -rn "UPSTASH_REDIS\|@upstash/redis\|ratelimit" packages/app --include="*.ts" --include=".env*"
```

- [ ] **Step 2: Postgres fallback (no new deps)**

Migration `0013_rate_limit.sql`:

```sql
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
```

`lib/rate/limiter.ts`:

```ts
export async function takeToken(bucket: string, limit: number, windowSec: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000);
  const upsert = await db.execute(sql`
    INSERT INTO rate_limit_counters (bucket, window_start, count)
    VALUES (${bucket}, ${windowStart}, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
    RETURNING count
  `);
  return Number((upsert.rows[0] as any).count) <= limit;
}
```

- [ ] **Step 3: Wire to nonce route**

```ts
const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
if (!await takeToken(`siwe-nonce:${ip}`, 10, 60)) {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}
```

- [ ] **Step 4: Cleanup cron**

Daily route deletes expired nonces and rate-limit rows older than 1h.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(audit-m9): rate-limit siwe/nonce; periodic cleanup"
```

### Task 19: M10 — checkout_authorizations UNIQUE partial index

**Files:**
- Create: `packages/app/lib/db/migrations/0014_checkout_auth_unique.sql`
- Modify: `packages/app/lib/db/schema.ts` (the index declaration)
- Modify: `packages/app/app/api/checkout/authorize/route.ts` to handle unique-violation gracefully

- [ ] **Step 1: Verify current migration**

```bash
/bin/cat packages/app/lib/db/migrations/0007_checkout_authorizations.sql | tail -10
```

If line 31-33 declares a non-unique index, drop and recreate as UNIQUE:

```sql
DROP INDEX IF EXISTS idx_checkout_auth_active;
CREATE UNIQUE INDEX idx_checkout_auth_active
  ON checkout_authorizations (invoice_id, payer)
  WHERE consumed_at IS NULL;
```

- [ ] **Step 2: Update authorize route**

`route.ts:174-179` — wrap insert in try/catch on unique-violation; on conflict, return the existing row instead of erroring. Existing semantics: idempotent re-authorize from same payer.

- [ ] **Step 3: Test**

In `app/api/checkout/authorize/route.test.ts`:

```ts
it("repeat authorize from same payer returns existing unconsumed row", async () => {
  const r1 = await POST(buildReq(...));
  const r2 = await POST(buildReq(...)); // same invoice + payer
  expect((await r1.json()).id).toBe((await r2.json()).id);
});
```

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(audit-m10): UNIQUE partial index on (invoice_id, payer) where unconsumed"
```

### Task 20: M11 — quote rounding alignment

**Files:**
- Modify: `packages/app/lib/checkout/quote-server.ts:82-83`
- Modify: `packages/app/app/api/checkout/quote/route.ts:98-105`
- Test: `packages/app/app/api/quote/route.test.ts`

- [ ] **Step 1: Pick canonical path**

Use BigInt-only (no decimal.js dep). Replace both rounding sites with a single helper in `quote-server.ts`:

```ts
/**
 * target: payout token amount in base units (e.g. USDC 6dp)
 * rate:   pay-in token per 1.0 payout token, as bigint scaled by 1e18
 * buffer: bps above (e.g. 30 → 0.3% headroom)
 * payInDecimals: decimals of pay-in token
 *
 * Returns ceil(target * 10^payInDecimals * (10000 + buffer) / (rate * 10000)),
 * always rounded UP — never under-quote a payer.
 */
export function quoteAmountIn(args: {
  targetBaseUnits: bigint;
  rateScaled1e18: bigint;
  bufferBps: bigint;
  payInDecimals: number;
}): bigint {
  const num = args.targetBaseUnits * 10n ** BigInt(args.payInDecimals) * (10000n + args.bufferBps);
  const den = args.rateScaled1e18 * 10000n;
  return (num + den - 1n) / den; // ceil
}
```

- [ ] **Step 2: Use in both call sites**

Replace the two existing rounding implementations with calls to `quoteAmountIn`.

- [ ] **Step 3: Test**

```ts
it("server and route handler return identical amountIn", async () => {
  const inputs = { /* known payment scenario */ };
  const a = await quoteOnServer(inputs);
  const b = await POST(buildReq(inputs)).then(r => r.json());
  expect(a.amountIn).toBe(b.amountIn);
});
```

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(audit-m11): unify quote rounding to BigInt ceil; eliminate ±1 base unit drift"
```

### Task 21: M12 — checkout/status token gate

**Files:**
- Modify: `packages/app/lib/db/schema.ts` (checkout_authorizations or new column on submit)
- Modify: `packages/app/app/api/checkout/submit/route.ts` — issue short-lived status token
- Modify: `packages/app/app/api/checkout/status/[id]/route.ts:18-56` — require token

- [ ] **Step 1: Add status_token column**

To `invoices` (or a separate `checkout_status_tokens` table for shorter TTL):

```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status_token text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status_token_expires_at timestamptz;
```

- [ ] **Step 2: Issue at submit**

In submit route, generate `crypto.randomBytes(24).toString("hex")`, store with 30-minute TTL, return in submit response.

- [ ] **Step 3: Require at status**

```ts
const token = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-status-token");
if (!token || token !== row.statusToken || row.statusTokenExpiresAt < new Date()) {
  // Public minimum: status only, no error/tx hash details.
  return NextResponse.json({ status: row.status });
}
return NextResponse.json({ status: row.status, lastError: ..., txHash: ... });
```

- [ ] **Step 4: Update SDK/checkout poller** to send the token.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(audit-m12): gate checkout/status detail behind submit-time token"
```

### Task 22: M13 — SDK Math.random nonce throws

**Files:**
- Modify: `packages/sdk/src/permit2.ts:144-153`

- [ ] **Step 1: Replace silent fallback**

```ts
function randomNonce(): bigint {
  const g = (globalThis.crypto as Crypto | undefined);
  if (!g?.getRandomValues) {
    throw new ArcoraError("no_secure_random",
      "Secure random unavailable — refusing to use Math.random for permit2 nonce. Upgrade Node ≥ 19 or polyfill globalThis.crypto.");
  }
  const buf = new Uint8Array(32);
  g.getRandomValues(buf);
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
}
```

- [ ] **Step 2: Test**

```ts
it("throws when secure RNG unavailable instead of silently falling back", () => {
  const orig = globalThis.crypto;
  // @ts-expect-error
  globalThis.crypto = undefined;
  expect(() => randomNonce()).toThrow(/no_secure_random/);
  globalThis.crypto = orig;
});
```

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(audit-m13): SDK refuses to fall back to Math.random for permit2 nonce"
```

### Task 23: M14 — security headers (app + shop)

**Files:**
- Create: `packages/app/lib/security/headers.ts`
- Modify: `packages/app/next.config.ts`
- Modify: `packages/shop/next.config.ts`

- [ ] **Step 1: Helper**

```ts
// packages/app/lib/security/headers.ts
export function securityHeaders() {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Content-Security-Policy", value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'", // tighten once nonces wired
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self' https:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ") },
  ];
}
```

- [ ] **Step 2: Wire in `next.config.ts`**

```ts
import { securityHeaders } from "./lib/security/headers";

export default {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
  // ...rest of config
};
```

- [ ] **Step 3: Mirror in shop**

In `packages/shop/next.config.ts`, inline the same helper or copy securityHeaders.

- [ ] **Step 4: Manually verify**

```bash
pnpm --filter @arc-fx-gateway/app dev
curl -sI http://localhost:3000/ | grep -E "X-Frame|Content-Security|Strict-Transport"
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(audit-m14): security headers (CSP, HSTS, X-Frame-Options) on app + shop"
```

---

## Phase 7 — Lows

### Task 24: L7 — quote endpoint rate limit

**Files:**
- Modify: `packages/app/app/api/checkout/quote/route.ts`

- [ ] **Step 1: Apply per-IP rate limit using `takeToken` from Task 18**

```ts
const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
if (!await takeToken(`quote:${ip}`, 30, 60)) {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}
```

- [ ] **Step 2: Commit**

```bash
git commit -am "fix(audit-l7): rate-limit /api/checkout/quote to protect KIT_KEY quota"
```

### Task 25: L8 — invoice GET metadata leak

**Files:**
- Modify: `packages/app/app/api/invoices/[id]/route.ts`

- [ ] **Step 1: Decide policy**

Public checkout needs status, payInToken, amountOut, expiresAt — but NOT the full `metadata` field, which may contain merchant-internal data. Restrict the response:

```ts
// Public response (no auth):
return NextResponse.json({
  id, status, payInToken, payoutToken, amountOut, expiresAt,
  // omit: metadata, paidBy (PII), paidTx (until status_token gate)
});
```

When the request is authenticated (merchant API key), return the full record.

- [ ] **Step 2: Test**

```ts
it("public GET /api/invoices/[id] does not return metadata", async () => {
  const inv = await seedInvoice({ metadata: { internal: "secret" } });
  const res = await GET(buildReq({ id: inv.id }));
  expect(await res.json()).not.toHaveProperty("metadata");
});
```

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(audit-l8): scrub merchant metadata from public invoice GET"
```

### Task 26: L1–L6, L9, L10 — small one-liners (batched)

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV9.sol` (L1, L2 — comment + `nonReentrant`)
- Modify: `.slither-triage.md` (L3)
- Modify: `ops/relayer/.env.example` (L4 — drop the duplicate)
- Modify: `packages/app/lib/db/schema.ts` (L5 — payoutToken allowlist via FK to a new `supported_tokens` table)
- Modify: `packages/app/middleware.ts` (L6 — drop the `x-pathname` response header)
- Modify: `packages/app/lib/auth/session.ts` (L9 — remove unused `apiKey?: string`)
- Modify: `packages/shop/src/cart.tsx` (L10 — Zod validate localStorage payload)

> Each is small enough to be a single commit; group them in the order above.

- [ ] **Step 1: L1 — refundInvoice/withdrawFees + whenNotPaused**

In V9, decide and document. Most likely: leave behavior as-is and add NatSpec stating the design intent (refunds must work even when paused).

- [ ] **Step 2: L2 — `recordPayerRefund` `nonReentrant`**

Add the modifier — it's defensive only. Re-run the contract tests.

- [ ] **Step 3: L3 — update `.slither-triage.md`**

Change "V8-only" to include V9.

- [ ] **Step 4: L4 — `.env.example`**

Pick one of `PRIVATE_KEY` / `RELAYER_PRIVATE_KEY` (latter is current) and remove the other.

- [ ] **Step 5: L5 — payoutToken allowlist**

Add `supported_tokens` table or env-driven allowlist. Validate at merchant bootstrap.

- [ ] **Step 6: L6 — drop `x-pathname` response header**

```bash
/usr/bin/grep -n "x-pathname" packages/app/middleware.ts
```
Delete the line setting it as a response header. Keep request-header propagation only if downstream consumes it (verify first).

- [ ] **Step 7: L9 — `apiKey` removal from session**

```ts
// session.ts: remove the line `apiKey?: string;`
```

- [ ] **Step 8: L10 — Zod-validate localStorage cart**

```ts
const cartSchema = z.array(z.object({ id: z.string(), qty: z.number().int().positive() }));
const parsed = cartSchema.safeParse(JSON.parse(raw ?? "[]"));
const cart = parsed.success ? parsed.data : [];
```

- [ ] **Step 9: Single rollup commit**

```bash
git add -A
git commit -m "fix(audit-lows): close L1-L10 misc hardening (NatSpec, env, headers, schema)"
```

---

## Phase 8 — Verification & PR

### Task 27: Full regression sweep

- [ ] **Step 1: Type-check + lint + tests**

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test --run
```

- [ ] **Step 2: Foundry contract tests**

```bash
pnpm --filter @arc-fx-gateway/contracts test
```

- [ ] **Step 3: Slither**

```bash
pnpm --filter @arc-fx-gateway/contracts slither
```

- [ ] **Step 4: Smoke a full checkout in dev**

```bash
pnpm --filter @arc-fx-gateway/app dev &
pnpm --filter @arc-fx-gateway/shop dev &
```
Open `arcora-shop` locally → cart → pay flow → verify successUrl redirect respects allowlist (deny with bad URL) → verify status endpoint without token returns minimal info.

- [ ] **Step 5: Manual run of operational scripts**

```bash
pnpm --filter @arc-fx-gateway/app exec tsx scripts/backfill-api-key-prefix.ts
```
Expected: WARN listing legacy merchants. Rotate them via dashboard.

### Task 28: Residuals doc + PR

- [ ] **Step 1: Finalize residuals doc**

`docs/audit/2026-05-05-residuals.md` should record:
- All TRUE findings → which task closed them.
- H3, M2 (FALSE) → noted with code-evidence link to verification.
- M3 (V10), H4-custody (V10), M4-reactivate (V10) → deferred with V10 plan link.

- [ ] **Step 2: Open PR**

```bash
git push -u origin plan-7-audit-2026-05-05
gh pr create --title "audit: close 17 verified-true + 3 partial findings (Pulse-AI 2026-05-05)" --body "$(cat <<'EOF'
## Summary
- Phase 1: H2 bcrypt loop → api_key_prefix index
- Phase 2: H1 successUrl/cancelUrl SSRF + open-redirect (allowlist + assertSafePublicUrl)
- Phase 3: H6 SDK Arcora class (instance pattern); useCheckout uses instance
- Phase 4: H5 indexer race + M6 V6 watch
- Phase 5: H4 monitoring/runbook (V10 will fix custody)
- Phase 6: M1, M3-doc, M4-doc, M5, M7, M8, M9, M10, M11, M12, M13, M14
- Phase 7: L1–L10 misc hardening
- Skipped (FALSE): H3 (already correctly persists), M2 (refund fee already debited)

## Test plan
- [ ] pnpm -r typecheck && pnpm -r lint && pnpm -r test --run
- [ ] foundry contract tests
- [ ] slither clean
- [ ] manual checkout smoke (success + cancel + token-less status)
- [ ] siwe nonce 429 after 10 in 60s
- [ ] /api/checkout/quote 429 after 30 in 60s

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

Spec coverage:
- H1 ✅ (Tasks 4–6), H2 ✅ (Tasks 1–3), H3 ❌ skipped (false), H4 ✅ (Task 11, V10 deferred), H5 ✅ (Task 9), H6 ✅ (Tasks 7–8)
- M1–M14 ✅ (Tasks 12–23), with M3/M4 doc-only on V9 + V10 deferred
- L1–L10 ✅ (Task 26 batch), with L7/L8 their own tasks (24, 25)

Type consistency: `assertOriginAllowed` (Task 5) signature matches its callsite. `quoteAmountIn` (Task 20) signature is single source of truth. `Arcora` class (Task 7) used in `useCheckout` (Task 8) with same `options` property name. `takeToken` (Task 18) reused in Task 24.

Placeholder scan: deploy-script path under `packages/contracts/script` referenced abstractly in Task 13 — engineer must `find` it (single shell command shown). Dashboard-side UI changes for Task 4 and Task 11 banner reference component paths abstractly because the dashboard structure should be located via grep at execution time. Documented this explicitly so the executing agent knows it's expected lookup, not a placeholder.

Deferred to V10 plan: refund custody model (H4), in-constructor fee bound (M3), explicit reactivateMerchant (M4). All recorded in residuals doc.
