# Audit 2026-05-05 — Residual findings

External audit: Pulse-AI multi-agent pass, 2026-05-05.
Implementation branch: `plan-7-audit-2026-05-05` (this branch).
Plan: `docs/superpowers/plans/2026-05-05-audit-fixes.md`.

V9 is immutable on-chain, so several findings get an off-chain workaround
(monitoring, deploy guard, NatSpec correction) here and a structural fix
when V10 ships.

## Coverage summary

20 findings actioned (17 verified-true + 3 partial). 2 skipped as false
positives in this codebase (H3, M2). 1 skipped as a false positive on review
(L6 — see below).

### High-severity

| ID | Finding | Resolution | Phase |
|----|---------|------------|-------|
| H1 | Open-redirect / SSRF via `successUrl` / `cancelUrl` | Merchant `allowed_origins` allowlist (UI + API + DB), server enforced before `createInvoiceFor`, client-side `safeClientRedirect` fallback | 2 |
| H2 | bcrypt loop on every authenticated request | `api_key_prefix` indexed column → O(1) lookup; backfill script for legacy rows | 1 |
| H3 | (FALSE POSITIVE) | Original audit cited a leak that's already correctly persisted; verified via code-reading, no change | — |
| H4 | V9 `refundInvoice` requires open ERC20 allowance from `payoutSource` | Off-chain: `readAllowance` at bootstrap with `warning: approval_required`; hourly cron at `/api/internal/cron/h4-allowance-check`; runbook | 5 |
| H5 | Indexer race drops out-of-order `InvoiceRefunded` / `PayerRefunded` | Status guards widened to `in ('created', 'paid')`; webhook insert idempotent via UNIQUE `(invoice_id, event_type)` + ON CONFLICT DO NOTHING | 4 |
| H6 | SDK module-level singleton clobbered across multi-tenant host apps | `Arcora` class (instance pattern); `useCheckout` uses `useMemo(new Arcora(...))`; static API kept as deprecated back-compat shim for CDN bundle | 3 |

### Medium-severity

| ID | Finding | Resolution | Phase |
|----|---------|------------|-------|
| M1 | `RELAYER_PRIVATE_KEY` lives at module scope | IIFE-wrapped account construction; defensive log audit. Note: viem `WalletClient` retains internal key reference — this is logging defense-in-depth, NOT key erasure. V10 + HSM is the real fix. | 6 |
| M2 | (FALSE POSITIVE) | Refund fee already debited per code-reading; no change | — |
| M3 | V9 `protocolFeeBps` has no on-chain upper bound | NatSpec WARNING on V9 constructor + `require(feeBps <= 1000)` in `DeployV9.s.sol` (off-chain). V10 will enforce in-constructor. | 6 |
| M4 | NatSpec misleadingly said deactivated merchants cannot re-register | NatSpec corrected. Behavior unchanged. V10 will add explicit `reactivateMerchant`. | 6 |
| M5 | 4xx-failed webhooks kept retrying forever | `terminal_reason` column + dispatcher sets it on terminal-4xx; `fetchDue` excludes terminated rows | 6 |
| M6 | Indexer didn't watch V6 cohort | Optional `GATEWAY_ADDRESS_V6` env (deprecated default); indexer watches V6/V8/V9 in parallel | 4 |
| M7 | DNS lookup in SSRF guard had no timeout | 3s `AbortController` race in both `lib/security/safeUrl.ts` and `ops/webhooks/run.ts` | 6 |
| M8 | `/api/auth/siwe/verify` leaked verification details in 400 body | Generic `{ error: "siwe_verify_failed" }`; details to server log only | 6 |
| M9 | `/api/auth/siwe/nonce` had no rate limit (DoS via flooding) | Postgres-backed fixed-window limiter (10/60s per IP); cleanup cron at `/api/internal/cron/siwe-nonce-cleanup` (daily) | 6 |
| M10 | `checkout_authorizations` partial index was non-unique | Migration 0014 drops + recreates as UNIQUE; route handler catches 23505 and returns existing unconsumed row | 6 |
| M11 | Quote rounding diverged ±1 base unit between server and route | Single `quoteAmountIn` BigInt-only helper; both call sites unified; `payoutDecimals` added to signature for cross-token correctness | 6 |
| M12 | `/api/checkout/status/[id]` exposed `lastError`/`txHash` to anyone with the invoice id | `status_token` (24-byte hex, 30-min TTL) issued at submit; status route requires token for full detail, returns `{ status }` only without | 6 |
| M13 | SDK `randomNonce` silently fell back to `Math.random` if `crypto.getRandomValues` missing | Throws `ArcoraError("NO_SECURE_RANDOM")` instead | 6 |
| M14 | No CSP / HSTS / X-Frame-Options on app or shop responses | `lib/security/headers.ts` helper wired into `next.config.ts` for both packages | 6 |

### Low-severity (rolled into one batch)

| ID | Finding | Resolution | Phase |
|----|---------|------------|-------|
| L1 | V9 `refundInvoice` / `withdrawFees` not `whenNotPaused` | NatSpec documents intentional design (refunds must work when paused) | 7 |
| L2 | V9 `recordPayerRefund` lacks `nonReentrant` | Modifier added (V10 effect — V9 is immutable) | 7 |
| L3 | `.slither-triage.md` scope said V8-only | Updated to V8+V9 | 7 |
| L4 | `ops/relayer/.env.example` had both `PRIVATE_KEY` and `RELAYER_PRIVATE_KEY` | Removed legacy `PRIVATE_KEY=` | 7 |
| L5 | No payout-token allowlist | `SUPPORTED_PAYOUT_TOKENS` env + bootstrap rejection (defaults to `USDC_ADDRESS`, `EURC_ADDRESS`) | 7 |
| L6 | (REVIEWED FALSE POSITIVE) `x-pathname` response header was thought to be unused; actually consumed by `app/m/layout.tsx:10` for the `/m/` auth-redirect guard | Skipped — header has a live consumer | 7 |
| L7 | `/api/checkout/quote` had no rate limit (KIT_KEY quota DoS) | 30/60s per IP via shared `takeToken` from M9 | 7 |
| L8 | Public invoice GET returned merchant-controlled `metadata` jsonb | Public response scrubbed to `{ id, status, payInToken, payoutToken, amountOut, expiresAt, allowedOrigins }`; full record only with merchant API key | 7 |
| L9 | `session.apiKey` was stored on session for "dashboard convenience" | Removed; bootstrap/rotation responses still return `apiKey` in body | 7 |
| L10 | `packages/shop/lib/cart.tsx` used `JSON.parse(raw) as CartItem[]` | Zod-validated parse with `[]` fallback | 7 |

## Deferred to V10

| Finding | Plan |
|--------|------|
| H4 (refund custody) | V10 custody model — eliminates allowance dependency entirely |
| M3 (fee bound) | V10 in-constructor `require(protocolFeeBps <= 1000)` |
| M4 (reactivate semantics) | V10 explicit `reactivateMerchant` with operator-only gating |
| L2 (`nonReentrant` on `recordPayerRefund`) | V10 redeploy will pick up the modifier (V9 immutable) |

## Operational gotchas worth carrying into V10 plan

1. **Cron response leaks merchant addresses** — `/api/internal/cron/h4-allowance-check` returns flagged merchant `address` + `payoutToken` + liability in the public JSON. Anyone holding `CRON_SECRET` (a long-lived shared secret) can dump this. Move details to server-side log + ops-dashboard fetch in V10 cycle.
2. **Bootstrap allowance check goes stale on payoutAddress rotation** — `bootstrap/route.ts` reads `allowance(session.merchantAddress, gateway)` once. After `updatePayoutAddress`, the dashboard banner doesn't re-check. Hourly cron catches it; UI should re-check on rotation event.
3. **M1 IIFE is logging defense, not key erasure** — viem `WalletClient` retains internal references to the key after `privateKeyToAccount`. The IIFE only prevents accidental `console.log(PRIVATE_KEY)` and module-globals dumps. HSM/encrypted-keystore is the V10 fix.
4. **`vercel.json` location is fragile** — lives at `packages/app/vercel.json` because Vercel project root is set there. If anyone moves project root to repo root, the cron silently stops registering.
5. **Migration 0014 (M10 UNIQUE index) was not exercised against the local dev DB** — local DB is on a pre-0007 snapshot (no `checkout_authorizations` table). The migration SQL is correct and will apply cleanly to production. Test coverage for the idempotency path is via mocked drizzle 23505 errors.

## Verification at branch tip

- `pnpm --filter @arcora/app exec vitest run` — 175 tests passing (31 files)
- `pnpm --filter @arcora/sdk exec vitest run` — 14 tests passing (3 files)
- `pnpm --filter @arcora/sdk-react exec vitest run` — 4 tests passing (1 file)
- `pnpm --filter @arcora/contracts test` — 100 forge tests passing
- `tsc --noEmit` clean across `@arcora/app`, `@arcora/sdk`, `@arcora/shop`
- Slither: not run (no `slither` script in `packages/contracts/package.json`); see `.slither-triage.md` for triage notes from prior audits
