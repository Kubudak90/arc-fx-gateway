# Audit Fixes (High + Medium) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 3 High and 10 Medium-class findings from the 2026-05-19 full code audit of the Arcora payment gateway.

**Architecture:** Each task is a self-contained hardening change to an existing file. No new subsystems. The app is a Next.js 15 App Router monorepo package (`packages/app`); the rate limiter, SSRF guard, compliance providers, and Permit2 verification all already exist — these tasks extend or correct them. TDD where a unit boundary exists; build/lint/grep verification for config and copy changes.

**Tech Stack:** Next.js 15.5, TypeScript, Drizzle ORM (Postgres), Zod, viem, vitest, ESLint 9 (to be configured).

**Branch:** Create `audit-2026-05-19-fixes` off `plan-1-protocol` before Task 1. Do NOT implement on `plan-1-protocol` directly.

**Baseline before starting:** `pnpm typecheck` clean · `pnpm test` = 262 passed / 14 failed (the 14 failures are `lib/auth/*` and `lib/wallet/server-wallet` failing on `ECONNREFUSED :5432` because no local Postgres is running — they are NOT real failures and are NOT in scope). Treat "tests pass" as "262 still pass, no NEW failures, plus the tests this plan adds pass."

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `app/api/checkout/authorize/route.ts` | add per-IP rate limit | T1 |
| `app/api/checkout/submit/route.ts` | add per-IP rate limit | T1 |
| `lib/rate/clientIp.ts` (new) | shared `clientIp` helper extracted from quote route | T1 |
| `app/api/internal/cron/siwe-nonce-cleanup/route.ts` | timing-safe secret compare | T2 |
| `app/api/internal/cron/siwe-nonce-cleanup/route.test.ts` (new) | cron auth test | T2 |
| `lib/checkout/permit2-verify.test.ts` (new) | Permit2 verify unit tests | T3 |
| `lib/checkout/witness.test.ts` (new) | witness hash unit tests | T3 |
| `app/api/invoices/route.ts` | `amountUsdc`/`metadata` bounds | T4 |
| `app/api/merchant/origins/route.ts` | SSRF guard + 404 on missing merchant | T5, T6 |
| `app/api/merchant/webhook/route.ts` | 404 on missing merchant | T6 |
| `lib/compliance/elliptic.ts` | configurable `asset` | T7 |
| `lib/compliance/factory.ts` | pass `ELLIPTIC_ASSET` env to provider | T7 |
| `eslint.config.mjs` (new), `package.json` | working ESLint | T8 |
| `next.config.ts` | `outputFileTracingRoot` | T8 |
| `app/page.tsx`, `components/landing/SiteFooter.tsx` | version string | T9 |
| `components/checkout/QuoteDisplay.tsx` | stale-closure fix | T10 |
| `components/checkout/ExpiryCountdown.tsx` | `aria-live` a11y fix | T11 |

---

## Task 1: Rate-limit `/api/checkout/authorize` and `/api/checkout/submit` (H1)

Both endpoints currently have no rate limiting. `/api/checkout/quote/route.ts` already implements the exact pattern to copy (per-IP `takeToken`, fail-open). First extract the duplicated `clientIp` helper, then apply it.

**Files:**
- Create: `packages/app/lib/rate/clientIp.ts`
- Modify: `packages/app/app/api/checkout/quote/route.ts:18-22` (remove local `clientIp`, import shared)
- Modify: `packages/app/app/api/checkout/authorize/route.ts`
- Modify: `packages/app/app/api/checkout/submit/route.ts`
- Test: `packages/app/app/api/checkout/authorize/route.test.ts` (extend), `packages/app/app/api/checkout/submit/route.test.ts` (extend)

- [ ] **Step 1: Create the shared `clientIp` helper**

Create `packages/app/lib/rate/clientIp.ts`:

```ts
import type { NextRequest } from "next/server";

/**
 * First-hop client IP for per-IP rate limiting. Reads `x-forwarded-for`
 * (Vercel sets this), falls back to `x-real-ip`, then `"unknown"`.
 * `"unknown"` deliberately shares one bucket — abuse from spoofed/missing
 * headers is still capped, just collectively.
 */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
```

- [ ] **Step 2: Point the quote route at the shared helper**

In `packages/app/app/api/checkout/quote/route.ts`: delete the local `function clientIp(...)` (lines 18-22) and add `import { clientIp } from "@/lib/rate/clientIp";` next to the existing `takeToken` import. No behavior change.

- [ ] **Step 3: Run the quote route test to confirm no regression**

Run: `pnpm test app/api/checkout/quote`
Expected: PASS (same count as before).

- [ ] **Step 4: Add the failing rate-limit test for `/authorize`**

In `packages/app/app/api/checkout/authorize/route.test.ts`, add a test that mocks `takeToken` to return `false` and asserts the response is `429` with body `{ error: "rate_limited" }`. Follow the existing mocking style in that file and in `quote/route.test.ts` (which already tests a 429 path — mirror it). The test must call `POST` with a valid body shape (`{ invoiceId: "0x"+"a".repeat(64), address: "0x"+"b".repeat(40) }`).

Run: `pnpm test app/api/checkout/authorize`
Expected: FAIL — the route does not yet return 429.

- [ ] **Step 5: Add rate limiting to `/authorize`**

In `packages/app/app/api/checkout/authorize/route.ts`, add imports and a guard at the very start of `POST`, before the body parse:

```ts
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";

// Audit H1 (2026-05-19): per-IP rate limit. Each authorize call hits the
// DB and, on a compliance cache miss, an external provider + App Kit
// estimator. 20/60s is generous for a real checkout (compliance results
// are cached) while capping abuse. Fail-open on limiter outage.
const AUTHORIZE_LIMIT = 20;
const AUTHORIZE_WINDOW_SECONDS = 60;
```

At the top of `POST`:

```ts
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`authorize:${ip}`, AUTHORIZE_LIMIT, AUTHORIZE_WINDOW_SECONDS);
  } catch {
    allowed = true; // fail-open: limiter outage must not block checkout
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: AUTHORIZE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(AUTHORIZE_WINDOW_SECONDS) } },
    );
  }
  // ... existing body parse continues
```

- [ ] **Step 6: Run the `/authorize` test to verify it passes**

Run: `pnpm test app/api/checkout/authorize`
Expected: PASS (all tests, including the new 429 test).

- [ ] **Step 7: Add the failing rate-limit test for `/submit`**

In `packages/app/app/api/checkout/submit/route.test.ts`, add the equivalent test: mock `takeToken` → `false`, assert `429` / `{ error: "rate_limited" }`. Use a valid `SubmitBody` shape (mirror an existing passing test's body in that file).

Run: `pnpm test app/api/checkout/submit`
Expected: FAIL.

- [ ] **Step 8: Add rate limiting to `/submit`**

In `packages/app/app/api/checkout/submit/route.ts`, add the same imports and constants (`SUBMIT_LIMIT = 10`, `SUBMIT_WINDOW_SECONDS = 60`, comment: "submit is one-shot per invoice; 10/60s never bothers a real user") and the same guard block at the top of `POST` with bucket `` `submit:${ip}` ``.

- [ ] **Step 9: Run `/submit` test + full suite**

Run: `pnpm test app/api/checkout/submit` → Expected: PASS
Run: `pnpm test` → Expected: 262 prior + new tests pass; still 14 DB-env failures, no new failures.

- [ ] **Step 10: Commit**

```bash
git add packages/app/lib/rate/clientIp.ts packages/app/app/api/checkout/
git commit -m "fix(security): rate-limit checkout authorize + submit endpoints (audit H1)"
```

---

## Task 2: Timing-safe `CRON_SECRET` comparison (H2)

`app/api/internal/cron/siwe-nonce-cleanup/route.ts:21` compares the bearer secret with `===`, leaking timing. Replace with `timingSafeEqual`. The route is also currently untested — add a test.

**Files:**
- Modify: `packages/app/app/api/internal/cron/siwe-nonce-cleanup/route.ts`
- Test: `packages/app/app/api/internal/cron/siwe-nonce-cleanup/route.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/app/app/api/internal/cron/siwe-nonce-cleanup/route.test.ts`. Mock `@/lib/db/client` so `db.execute` resolves to `{ rowCount: 0 }` (follow the db-mock style used in `app/api/merchant/treasury/route.test.ts`). Cases:
1. `CRON_SECRET` set, no `authorization` header → `401`.
2. `CRON_SECRET` set, wrong secret → `401`.
3. `CRON_SECRET` set, correct `` `Bearer ${secret}` `` → `200` with `{ ok: true }`.
4. `CRON_SECRET` set, correct bare secret (no `Bearer `) → `200`.
5. `CRON_SECRET` unset/empty → `401` (fail-closed).

Set/unset `process.env.CRON_SECRET` per case and restore it in `afterEach`. Build the request with `new NextRequest("http://localhost/api/internal/cron/siwe-nonce-cleanup", { headers: { authorization: ... } })`.

Run: `pnpm test app/api/internal/cron`
Expected: PASS for cases 1-5 already — the current `===` logic is functionally correct, so this test passes BEFORE the change. That is intentional: it is a regression net for Step 2.

- [ ] **Step 2: Replace `===` with constant-time comparison**

In `route.ts`, add `import { timingSafeEqual } from "node:crypto";` and a helper, then use it:

```ts
/** Constant-time string compare. Returns false on length mismatch
 *  without leaking the secret length through an early `===`. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

Replace the guard:

```ts
const provided = req.headers.get("authorization") ?? req.headers.get("x-cron-secret") ?? "";
const expected = process.env.CRON_SECRET ?? "";
const ok = !!expected && (safeEqual(provided, `Bearer ${expected}`) || safeEqual(provided, expected));
if (!ok) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
```

- [ ] **Step 3: Run the test to verify it still passes**

Run: `pnpm test app/api/internal/cron`
Expected: PASS — all 5 cases unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/app/app/api/internal/cron/
git commit -m "fix(security): constant-time CRON_SECRET comparison + cron route tests (audit H2)"
```

---

## Task 3: Permit2 verification unit tests (H3)

`lib/checkout/permit2-verify.ts` and `lib/checkout/witness.ts` are the core fund-authorization path and have zero unit tests. Add them. No production code changes — this task only adds coverage. Use `viem` to produce a real signature in-test so the verification is exercised end-to-end.

**Files:**
- Test: `packages/app/lib/checkout/permit2-verify.test.ts` (new)
- Test: `packages/app/lib/checkout/witness.test.ts` (new)
- Read first: `packages/app/lib/checkout/permit2.ts` (for `PERMIT2_ADDRESS`), `packages/app/lib/checkout/quote-server.test.ts` (test style reference).

- [ ] **Step 1: Write `witness.test.ts`**

Create `packages/app/lib/checkout/witness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { expectedWitnessHash, ARCORA_WITNESS_TYPE_STRING, PERMIT2_WITNESS_TYPE_STRING } from "./witness";

const INVOICE = ("0x" + "ab".repeat(32)) as `0x${string}`;
const RELAYER = "0x1111111111111111111111111111111111111111" as `0x${string}`;

describe("expectedWitnessHash", () => {
  it("is deterministic for the same inputs", () => {
    expect(expectedWitnessHash(INVOICE, RELAYER)).toBe(expectedWitnessHash(INVOICE, RELAYER));
  });
  it("is 32 bytes hex", () => {
    expect(expectedWitnessHash(INVOICE, RELAYER)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("changes when the relayer changes", () => {
    const other = "0x2222222222222222222222222222222222222222" as `0x${string}`;
    expect(expectedWitnessHash(INVOICE, RELAYER)).not.toBe(expectedWitnessHash(INVOICE, other));
  });
  it("changes when the invoice id changes", () => {
    const other = ("0x" + "cd".repeat(32)) as `0x${string}`;
    expect(expectedWitnessHash(INVOICE, RELAYER)).not.toBe(expectedWitnessHash(other, RELAYER));
  });
  it("is case-insensitive on the relayer address", () => {
    expect(expectedWitnessHash(INVOICE, RELAYER.toUpperCase() as `0x${string}`))
      .toBe(expectedWitnessHash(INVOICE, RELAYER));
  });
  it("exposes the pinned Permit2 witness type string", () => {
    expect(PERMIT2_WITNESS_TYPE_STRING).toContain(ARCORA_WITNESS_TYPE_STRING.replace("ArcoraSwapIntent", "ArcoraSwapIntent"));
    expect(PERMIT2_WITNESS_TYPE_STRING).toContain("TokenPermissions(address token,uint256 amount)");
  });
});
```

Run: `pnpm test lib/checkout/witness`
Expected: PASS (this is pure verification of existing code).

- [ ] **Step 2: Write `permit2-verify.test.ts`**

Create `packages/app/lib/checkout/permit2-verify.test.ts`. Use `privateKeyToAccount` + `account.signTypedData` from `viem/accounts` to produce a genuine signature over the SAME typed-data structure `verifyPermit2Signature` reconstructs, then assert verification:

```ts
import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { verifyPermit2Signature, ARC_TESTNET_CHAIN_ID } from "./permit2-verify";
import { PERMIT2_ADDRESS } from "./permit2";

const PK = ("0x" + "11".repeat(32)) as Hex;
const account = privateKeyToAccount(PK);

const TYPES = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  ArcoraSwapIntent: [
    { name: "invoiceId", type: "bytes32" },
    { name: "relayer", type: "address" },
  ],
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "ArcoraSwapIntent" },
  ],
} as const;

const params = {
  chainId: ARC_TESTNET_CHAIN_ID,
  invoiceId: ("0x" + "ab".repeat(32)) as Hex,
  payer: account.address as Address,
  payInToken: "0x3333333333333333333333333333333333333333" as Address,
  amountIn: 1_000_000n,
  relayer: "0x4444444444444444444444444444444444444444" as Address,
  nonce: 7n,
  deadline: 9_999_999_999n,
};

async function sign(p: typeof params): Promise<Hex> {
  return account.signTypedData({
    domain: { name: "Permit2", chainId: p.chainId, verifyingContract: PERMIT2_ADDRESS },
    types: TYPES,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: p.payInToken, amount: p.amountIn },
      spender: p.relayer,
      nonce: p.nonce,
      deadline: p.deadline,
      witness: { invoiceId: p.invoiceId, relayer: p.relayer },
    },
  });
}

describe("verifyPermit2Signature", () => {
  it("accepts a signature from the claimed payer", async () => {
    const signature = await sign(params);
    expect(await verifyPermit2Signature({ ...params, signature })).toBe(true);
  });

  it("rejects when amountIn is tampered after signing", async () => {
    const signature = await sign(params);
    expect(await verifyPermit2Signature({ ...params, amountIn: 999n, signature })).toBe(false);
  });

  it("rejects when the relayer is swapped", async () => {
    const signature = await sign(params);
    const other = "0x5555555555555555555555555555555555555555" as Address;
    expect(await verifyPermit2Signature({ ...params, relayer: other, signature })).toBe(false);
  });

  it("rejects when the invoice id is swapped", async () => {
    const signature = await sign(params);
    const other = ("0x" + "cd".repeat(32)) as Hex;
    expect(await verifyPermit2Signature({ ...params, invoiceId: other, signature })).toBe(false);
  });

  it("rejects when the recovered signer is not the claimed payer", async () => {
    const signature = await sign(params);
    const impostor = "0x6666666666666666666666666666666666666666" as Address;
    expect(await verifyPermit2Signature({ ...params, payer: impostor, signature })).toBe(false);
  });

  it("rejects when the nonce is tampered", async () => {
    const signature = await sign(params);
    expect(await verifyPermit2Signature({ ...params, nonce: 8n, signature })).toBe(false);
  });
});
```

If `verifyPermit2Signature` throws on a malformed signature (rather than returning false), note it — the submit route already wraps the call in try/catch, so a throw is acceptable; only adjust the test (e.g. `await expect(...).rejects` ) if a real throw is observed, do not change production code.

Run: `pnpm test lib/checkout/permit2-verify`
Expected: PASS — all 6 cases.

- [ ] **Step 3: Run the full lib test set**

Run: `pnpm test lib/checkout`
Expected: PASS (existing `quote-server` tests + 2 new files).

- [ ] **Step 4: Commit**

```bash
git add packages/app/lib/checkout/permit2-verify.test.ts packages/app/lib/checkout/witness.test.ts
git commit -m "test(checkout): unit-cover Permit2 signature verification + witness hashing (audit H3)"
```

---

## Task 4: Invoice input bounds — `amountUsdc` ceiling + `metadata` size (M1, M2)

`app/api/invoices/route.ts:24,28` — `amountUsdc` is `z.number().positive()` with no upper bound (floats above 2^53 lose integer precision and `Infinity` crashes `BigInt`), and `metadata` is `z.record(z.string())` with no size cap.

**Files:**
- Modify: `packages/app/app/api/invoices/route.ts:23-29`
- Test: `packages/app/app/api/invoices/route.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

In `packages/app/app/api/invoices/route.test.ts`, add cases (mirror the existing `bad_body` 400 tests in that file — they already exercise the zod schema). With a valid API key mock:
1. `amountUsdc: 5_000_000` → `400` `{ error: "bad_body" }` (over the $1M ceiling).
2. `amountUsdc: 0` → `400` (already covered by `.positive()`, keep as a guard).
3. `metadata` with 60 keys → `400`.
4. `metadata` with a value of 300 chars → `400`.
5. `amountUsdc: 99.99` with small valid `metadata` → still `201` (or whatever the existing happy-path test asserts) — confirm the ceiling did not break the normal path.

Run: `pnpm test app/api/invoices/route`
Expected: FAIL for cases 1, 3, 4.

- [ ] **Step 2: Tighten the zod schema**

In `app/api/invoices/route.ts` replace the `Body` schema:

```ts
// amountUsdc ceiling: $1,000,000 per invoice. Above ~9e15 a JS double loses
// integer precision and Math.round(amountUsdc * 1e6) silently corrupts the
// on-chain BigInt; an Infinity input would crash BigInt() outright. $1M is
// well clear of both and a sane single-invoice cap. (Audit M1)
// metadata is stored verbatim as JSONB and echoed back on GET — cap key
// count and value length so a merchant can't bloat every row. (Audit M2)
const Body = z.object({
  amountUsdc: z.number().positive().max(1_000_000),
  payInToken: z.enum(["USDC", "EURC"]),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string().max(256)).optional()
    .refine((m) => !m || Object.keys(m).length <= 50, {
      message: "metadata may not exceed 50 keys",
    }),
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test app/api/invoices/route`
Expected: PASS — all cases including the happy path.

- [ ] **Step 4: Commit**

```bash
git add packages/app/app/api/invoices/
git commit -m "fix(api): bound invoice amountUsdc and metadata size (audit M1, M2)"
```

---

## Task 5: SSRF guard on `PATCH /api/merchant/origins` (M3)

`app/api/merchant/origins/route.ts` persists merchant-declared redirect origins without the `assertSafePublicUrl` DNS guard that `/api/merchant/webhook` and `/api/merchant/bootstrap` apply, and accepts `http://` origins.

**Files:**
- Modify: `packages/app/app/api/merchant/origins/route.ts`
- Test: `packages/app/app/api/merchant/origins/route.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/app/app/api/merchant/origins/route.test.ts`. Mock `@/lib/auth/session` so `getSession()` returns `{ merchantAddress: "0xabc..." }`, and mock `@/lib/db/client` so `db.update(...).set(...).where(...).returning()` resolves to `[{ address: "0xabc..." }]`. Cases:
1. Valid `["https://shop.example.com"]` → `200`, `{ ok: true }`.
2. `["http://shop.example.com"]` → `400` `{ error: "unsafe_origin" }` (http rejected).
3. `["https://169.254.169.254"]` → `400` `{ error: "unsafe_origin" }` (SSRF range).
4. No session → `401`.

For the SSRF case, mock `@/lib/security/safeUrl` `assertSafePublicUrl` to throw for the metadata IP. Follow the mocking pattern in `app/api/merchant/bootstrap/route.test.ts` (it already exercises `assertSafePublicUrl`).

Run: `pnpm test app/api/merchant/origins`
Expected: FAIL for cases 2 and 3.

- [ ] **Step 2: Add the SSRF + https guard**

In `app/api/merchant/origins/route.ts`, add `import { assertSafePublicUrl } from "@/lib/security/safeUrl";`. After the `normalized` array is built (after line 35), before the DB update:

```ts
// Audit M3 (2026-05-19): origins are redirect targets — apply the same
// SSRF/DNS guard webhook + bootstrap use, and require https. A merchant
// (or stolen session) must not be able to persist an RFC1918 / cloud-
// metadata origin that a future redirect-path regression could exploit.
for (const origin of normalized) {
  if (!origin.startsWith("https://")) {
    return NextResponse.json(
      { error: "unsafe_origin", detail: `origin must be https: ${origin}` },
      { status: 400 },
    );
  }
  try {
    await assertSafePublicUrl(origin);
  } catch (e) {
    return NextResponse.json(
      { error: "unsafe_origin", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `pnpm test app/api/merchant/origins`
Expected: PASS — all 4 cases.

- [ ] **Step 4: Commit**

```bash
git add packages/app/app/api/merchant/origins/
git commit -m "fix(security): SSRF + https guard on merchant origins PATCH (audit M3)"
```

---

## Task 6: 404 on missing-merchant updates — webhook + origins (M4)

`POST`/`PATCH /api/merchant/webhook` and `PATCH /api/merchant/origins` call `db.update(...)` without checking rows affected; an authenticated session whose merchant row no longer exists gets a misleading success. `/api/merchant/api-key/route.ts:17-18` already shows the correct `.returning()` + 404 pattern.

> **Note:** Task 5 runs before Task 6 and already adds `.returning()` to the origins update implicitly via its test mock — Task 6 makes the 404 check explicit. Do Task 5 first.

**Files:**
- Modify: `packages/app/app/api/merchant/webhook/route.ts` (both `PATCH` and `POST`)
- Modify: `packages/app/app/api/merchant/origins/route.ts` (`PATCH`)
- Test: extend `packages/app/app/api/merchant/origins/route.test.ts`; create `packages/app/app/api/merchant/webhook/route.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/app/api/merchant/webhook/route.test.ts`. Mock session + db. For each of `PATCH` (URL update) and `POST` (secret rotation):
- merchant exists (`db.update(...).returning()` → `[{ address: "0xabc..." }]`) → success (`200` / secret body).
- merchant missing (`returning()` → `[]`) → `404` `{ error: "no_merchant" }`.

In `app/api/merchant/origins/route.test.ts`, add: `returning()` → `[]` → `404`.

Run: `pnpm test app/api/merchant/webhook app/api/merchant/origins`
Expected: FAIL for the missing-merchant cases.

- [ ] **Step 2: Add `.returning()` + 404 to webhook `PATCH`**

In `app/api/merchant/webhook/route.ts`, change the `PATCH` update:

```ts
const updated = await db.update(merchants).set({ webhookUrl: parsed.data.webhookUrl })
  .where(eq(merchants.address, session.merchantAddress))
  .returning({ address: merchants.address });
if (updated.length === 0) return NextResponse.json({ error: "no_merchant" }, { status: 404 });
return NextResponse.json({ ok: true });
```

- [ ] **Step 3: Add `.returning()` + 404 to webhook `POST`**

```ts
const updated = await db.update(merchants)
  .set({ webhookSecretEnc: ciphertext, webhookSecretIv: iv })
  .where(eq(merchants.address, session.merchantAddress))
  .returning({ address: merchants.address });
if (updated.length === 0) return NextResponse.json({ error: "no_merchant" }, { status: 404 });
return NextResponse.json({ webhookSecret });
```

- [ ] **Step 4: Add `.returning()` + 404 to origins `PATCH`**

In `app/api/merchant/origins/route.ts`, change the update:

```ts
const updated = await db.update(merchants)
  .set({ allowedOrigins: normalized })
  .where(eq(merchants.address, session.merchantAddress))
  .returning({ address: merchants.address });
if (updated.length === 0) return NextResponse.json({ error: "no_merchant" }, { status: 404 });
return NextResponse.json({ ok: true, allowedOrigins: normalized });
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test app/api/merchant/webhook app/api/merchant/origins`
Expected: PASS — all cases.

- [ ] **Step 6: Commit**

```bash
git add packages/app/app/api/merchant/webhook/ packages/app/app/api/merchant/origins/
git commit -m "fix(api): 404 instead of silent success when merchant row is missing (audit M4)"
```

---

## Task 7: Configurable Elliptic screening asset (M5)

`lib/compliance/elliptic.ts:55` hardcodes `asset: "ETH"` in the screening request; Arc wallets must be screened as Arc, not Ethereum. The correct Elliptic asset identifier is not confirmed, so make it configurable (default unchanged) and wire an env var. Provider runs `noop` on prod, so this has no production behavior impact today — it makes the adapter correct-by-config for when a real provider is enabled.

**Files:**
- Modify: `packages/app/lib/compliance/elliptic.ts`
- Modify: `packages/app/lib/compliance/factory.ts`
- Test: `packages/app/lib/compliance/elliptic.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `lib/compliance/elliptic.test.ts`, add a test: construct `new EllipticProvider({ apiKey: "k", asset: "arc", fetch: fakeFetch })`, call `screenAddress`, and assert the captured request body's `subject.asset === "arc"`. Add a second: omit `asset`, assert it defaults to `"ETH"`. Follow the existing `fetch`-mock style already in that test file.

Run: `pnpm test lib/compliance/elliptic`
Expected: FAIL — `EllipticConfig` has no `asset` field.

- [ ] **Step 2: Add `asset` to `EllipticProvider`**

In `lib/compliance/elliptic.ts`:

```ts
export interface EllipticConfig {
  apiKey: string;
  baseUrl?: string;
  /** Chain/asset identifier sent to Elliptic. Arc wallets must NOT be
   *  screened as "ETH" — set ELLIPTIC_ASSET once confirmed with Elliptic's
   *  solutions team. Defaults to "ETH" only for back-compat. (Audit M5) */
  asset?: string;
  fetch?: typeof fetch;
}
```

Add a `#asset` field, set it in the constructor (`this.#asset = config.asset ?? "ETH";`), and use it in the request body: `subject: { address, asset: this.#asset }`.

- [ ] **Step 3: Wire the env var in the factory**

In `lib/compliance/factory.ts`, where `EllipticProvider` is constructed, pass `asset: process.env.ELLIPTIC_ASSET` (so an unset env keeps the `"ETH"` default). Match the surrounding construction style.

- [ ] **Step 4: Run the tests**

Run: `pnpm test lib/compliance`
Expected: PASS — elliptic + factory tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/compliance/elliptic.ts packages/app/lib/compliance/elliptic.test.ts packages/app/lib/compliance/factory.ts
git commit -m "fix(compliance): make Elliptic screening asset configurable, not hardcoded ETH (audit M5)"
```

---

## Task 8: Working ESLint config + `outputFileTracingRoot` (M6, M7)

`pnpm lint` runs deprecated `next lint` and drops into an interactive setup because no ESLint config exists. `next.config.ts` lacks `outputFileTracingRoot`, so Next picks the wrong workspace root when multiple lockfiles are present.

**Files:**
- Create: `packages/app/eslint.config.mjs`
- Modify: `packages/app/package.json` (`lint` script, devDependencies)
- Modify: `packages/app/next.config.ts`

> Use Context7 (`resolve-library-id` → `query-docs` for "eslint-config-next" / "Next.js 15 ESLint flat config") to confirm the exact current flat-config setup for Next.js 15 before writing the config — the package set has changed across recent releases.

- [ ] **Step 1: Install ESLint deps**

Run (from `packages/app`):

```bash
pnpm add -D eslint eslint-config-next @eslint/eslintrc
```

Expected: the three packages added to `devDependencies`.

- [ ] **Step 2: Create the flat config**

Create `packages/app/eslint.config.mjs` using the Next.js 15 flat-config bridge:

```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "test-results/**", "lib/db/migrations/**"],
  },
];

export default eslintConfig;
```

- [ ] **Step 3: Update the `lint` script**

In `packages/app/package.json`, change `"lint": "next lint"` to `"lint": "eslint ."`.

- [ ] **Step 4: Run lint and resolve violations**

Run: `pnpm lint`
Expected: it runs non-interactively. If it reports errors on the existing codebase, fix only genuine bugs; for noisy stylistic rules that flag pre-existing intentional patterns (e.g. the `eslint-disable` already present in `QuoteDisplay.tsx`, `any` in catch blocks), downgrade those specific rules to `"warn"` in `eslint.config.mjs` rather than rewriting unrelated code. The task's done-criterion is: `pnpm lint` exits 0 (warnings allowed, errors not). Do NOT change application logic to satisfy a lint rule in this task.

- [ ] **Step 5: Add `outputFileTracingRoot` to `next.config.ts`**

In `packages/app/next.config.ts`, add the import and config key:

```ts
import type { NextConfig } from "next";
import path from "node:path";
import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Pin the monorepo root — multiple lockfiles otherwise make Next infer
  // the wrong workspace root and mis-trace serverless function files.
  // (Audit M7)
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async headers() {
  // ... rest unchanged
```

- [ ] **Step 6: Verify the build**

Run: `pnpm build`
Expected: build succeeds; the "Next.js inferred your workspace root" warning is gone. (If `__dirname` is unavailable in the TS config context, use `path.join(process.cwd(), "../../")` — `next.config.ts` runs from the package dir.)

- [ ] **Step 7: Commit**

```bash
git add packages/app/eslint.config.mjs packages/app/package.json packages/app/next.config.ts packages/app/pnpm-lock.yaml ../../pnpm-lock.yaml
git commit -m "chore(tooling): working ESLint flat config + pin outputFileTracingRoot (audit M6, M7)"
```

---

## Task 9: Correct the landing version string (M8)

The landing hero and footer say "v1.1" but the tagged release is `v1.2.0`.

**Files:**
- Modify: `packages/app/app/page.tsx` (lines ~106, ~132)
- Modify: `packages/app/components/landing/SiteFooter.tsx` (line ~79)

- [ ] **Step 1: Locate every occurrence**

Run: `grep -rn "v1\.1" packages/app/app/page.tsx packages/app/components/landing/`
Expected: 3 matches (hero tag, hero/CTA area, footer strip).

- [ ] **Step 2: Update each to v1.2**

Replace the user-visible "v1.1" strings with "v1.2" in `app/page.tsx` and `components/landing/SiteFooter.tsx`. Match the existing surrounding copy exactly — only the version token changes (e.g. `Stablecoin checkout · v1.1 live` → `Stablecoin checkout · v1.2 live`). Do not touch contract addresses or any string that is not a version label.

- [ ] **Step 3: Verify**

Run: `grep -rn "v1\.1" packages/app/app/page.tsx packages/app/components/landing/`
Expected: 0 matches.
Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/app/app/page.tsx packages/app/components/landing/SiteFooter.tsx
git commit -m "fix(landing): bump displayed version string to v1.2 (audit M8)"
```

---

## Task 10: Fix `QuoteDisplay` stale-closure on the staleness interval (Medium)

`components/checkout/QuoteDisplay.tsx:86-106` — the quote-refresh `useEffect` has its deps suppressed; the `stale` state read inside the interval is captured at mount, so the `!stale` guard never re-evaluates and `props.onStale()` can fire repeatedly instead of once.

**Files:**
- Read first: `packages/app/components/checkout/QuoteDisplay.tsx` (whole file), `packages/app/app/i/[invoiceId]/CheckoutClient.tsx` (to see how `onStale`/`onQuote` are passed).
- Modify: `packages/app/components/checkout/QuoteDisplay.tsx`

- [ ] **Step 1: Read the component and confirm the bug**

Read `QuoteDisplay.tsx`. Confirm: (a) a `stale` piece of state exists, (b) an interval inside the suppressed-deps `useEffect` reads `stale` and calls `props.onStale()`, (c) the interval would re-fire `onStale` because it reads the mount-time `stale`.

- [ ] **Step 2: Add a ref mirror for `stale`**

Add `import { useRef } from "react";` (extend the existing react import). Introduce a ref that mirrors the `stale` state so the interval reads the current value without needing the variable in the dependency array:

```ts
const staleRef = useRef(false);
// keep the ref in sync whenever the state changes
useEffect(() => { staleRef.current = stale; }, [stale]);
```

Inside the interval body, replace the read of `stale` with `staleRef.current`, and guard the `onStale()` call so it only fires on the transition to stale:

```ts
if (/* quote is now stale */ !staleRef.current) {
  staleRef.current = true;
  setStale(true);
  props.onStale();
}
```

Adapt the exact expression to the file's actual staleness condition — the principle is: read `staleRef.current`, fire `onStale()` exactly once on the false→true edge. Keep the existing `eslint-disable` only if still needed after this change; prefer removing it if the deps are now honest.

- [ ] **Step 3: Verify**

Run: `pnpm test components/checkout` (covers `StatusScreens`; QuoteDisplay has no test today — do not add one in this task, it needs App Kit mocking out of scope here).
Run: `pnpm build`
Expected: both succeed.

- [ ] **Step 4: Manual reasoning check**

Confirm by re-reading: across multiple interval ticks after the quote goes stale, `props.onStale()` is called exactly once. State that conclusion in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/app/components/checkout/QuoteDisplay.tsx
git commit -m "fix(checkout): fire QuoteDisplay onStale exactly once via ref, not stale closure (audit)"
```

---

## Task 11: `ExpiryCountdown` accessibility — announce the countdown (Medium)

`components/checkout/ExpiryCountdown.tsx:34` sets `aria-live="off"` during the countdown, so screen-reader users on the checkout page never hear the payment expiry.

**Files:**
- Modify: `packages/app/components/checkout/ExpiryCountdown.tsx`

- [ ] **Step 1: Change the live-region attributes**

In `ExpiryCountdown.tsx`, replace the conditional `aria-live` with a stable `polite` region and `aria-atomic`. The `<span>` becomes:

```tsx
return (
  <span
    className={className}
    role="timer"
    aria-atomic="true"
    aria-live={label === "Expired" ? "assertive" : "polite"}
  >
    {label}
  </span>
);
```

`aria-live` is set at render time on every render (not toggled mid-stream from `off`), so assistive tech observes it from first paint. `polite` announces each updated time without interrupting; `assertive` makes the final "Expired" interrupt. `aria-atomic` ensures the whole label is read as a unit. Remove the `aria-label={label}` line — with the text content now in a live region, a duplicate `aria-label` causes double announcement; the visible text is the accessible name.

- [ ] **Step 2: Verify**

Run: `pnpm build`
Expected: build succeeds.
Run: `pnpm test components/checkout`
Expected: PASS (no existing test targets this component; confirm nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add packages/app/components/checkout/ExpiryCountdown.tsx
git commit -m "fix(a11y): announce checkout expiry countdown to screen readers (audit)"
```

---

## Final verification (after all tasks)

- [ ] Run `pnpm typecheck` → clean.
- [ ] Run `pnpm lint` → exits 0.
- [ ] Run `pnpm test` → the 14 pre-existing DB-env failures remain (unchanged), every other test passes including all tests added by this plan. No NEW failures.
- [ ] Run `pnpm build` → succeeds, no workspace-root warning.
- [ ] Dispatch a final code review over the whole branch diff.
- [ ] Use superpowers:finishing-a-development-branch to complete.

## Out of scope (consciously deferred)

Low-severity findings are NOT in this plan: compliance `fetch` timeouts, the V9 gateway address label in `LiveSettlement`, the `dash-area` SVG gradient id, the "All" dashboard date range, the `SuccessScreen` negative countdown, unused `supertest` deps + unused shadcn components, the `foundry.toml` legacy profile, and the `ArcFXGatewayV10` source-name vs V11-deployed-label convention. The frontend-audit "Date prop not serializable" item was a verified false positive (Date is serializable across the RSC boundary; checkout works in production) — no task.
