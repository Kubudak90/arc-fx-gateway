# Remediation Plan — Full-Scope Audit 2026-06-06

Companion to `docs/audit/audit-2026-06-06.md`. Severities below are the
**verified** severities (AFG-010 re-scored High → Medium). Each item lists the
fix, the files to touch, concrete guidance grounded in the current code, and how
to verify. Effort is a rough engineering estimate (S < 0.5 d, M ≈ 1–2 d,
L > 2 d).

Coupled work is grouped into phases that should land as single PRs.

| Phase | Findings | Severity | Effort | Gate |
|---|---|---|---|---|
| 1 | AFG-019 | High | M | before any new SDK/storefront onboarding |
| 2 | AFG-011 + AFG-010 | Medium | M | before mainnet; do DB TLS now |
| 3 | AFG-003 + AFG-004 | Medium + Low | M | before real-value / automated fulfillment |
| 4 | AFG-001 + AFG-002 | Medium + Low | S–M | before mainnet |
| 5 | AFG-021 | Low | S | mainnet pre-flight |
| 6 | AFG-005 + AFG-013 | Low | M | before mainnet |
| 7 | AFG-009 + AFG-006 | Low | S | opportunistic |

---

## Phase 1 — AFG-019: scoped credentials for the browser (High)

**Problem.** A single full-privilege `ak_live_` bearer key is documented for
browser/CDN/React/`NEXT_PUBLIC_` use; it can create gas-burning invoices, list
merchant escrows, and read private invoice/payer fields. No publishable/scoped
key type exists.

**Target design.** Two credential classes plus a checkout-session token:

1. **Secret key** (`ak_live_…`, unchanged) — server-side only; full capability.
2. **Publishable key** (`pk_live_…`, new) — browser-safe; capability limited to
   *creating a checkout session* (and nothing else), bound to the merchant's
   allowed origins.
3. **Checkout-session token** — short-lived, single-invoice token minted by the
   merchant backend (or by the app from a `pk_` + server-approved cart). The
   browser uses this to render/track one payment, never the raw key.

**Changes.**

- `packages/app/lib/auth/apikey.ts` — add a `pk_live_` prefix and a `keyType`
  discriminator; `generateApiKey(type)`; `lookupMerchantByApiKey` returns the
  key's type so routes can authorize per-capability. Keep `ak_live_` behavior
  intact for back-compat.
- `packages/app/lib/db/schema.ts` — add a `key_type` (or scope) column to the
  api-key table; backfill existing rows to `secret`.
- `packages/app/app/api/invoices/route.ts` (POST) — require a **secret** key;
  reject `pk_` with 403. Add a separate `POST /api/checkout/session` that
  accepts a `pk_` key + a **server-validated** cart (see Phase 3) and mints a
  session token.
- `packages/app/app/api/merchant/escrows/route.ts` (GET) and
  `packages/app/app/api/invoices/[id]/route.ts` — never accept `pk_`; for the
  detail route, keep returning `metadata`/`paidBy`/`paidTx`/`paidAt` only to a
  **secret-key or session** caller, never to a publishable key or anonymous.
- `packages/sdk/src/client.ts` — split: browser/`init()` + `<CheckoutButton>`
  take a `pk_`/session token; server methods (`createInvoice`, `escrows`) take a
  secret key and warn (or refuse) if handed a `pk_`/`NEXT_PUBLIC_` value.
- Docs — `packages/sdk/README.md`, `packages/sdk-react/README.md`,
  `packages/app/app/docs/sdk/page.tsx`: replace every `ak_live_`/`NEXT_PUBLIC_ARCORA_KEY`
  browser sample with the `pk_`/session flow; add an explicit "secret keys are
  server-side only — never ship them to the browser" callout.

**Verification.**
- Unit: `pk_` rejected on invoices/escrows/detail; `ak_` rejected as a browser
  origin-bound caller where applicable.
- Build a sample storefront bundle and grep it for `ak_live_` → must be absent.
- Extend the existing 41 AFG-019 tests to cover the new key type.

**Effort: M.** No mainnet dependency — ship before onboarding new SDK users.

---

## Phase 2 — AFG-011 + AFG-010: strict DB TLS, then relayer re-validation (Medium)

**AFG-011 first (closes the AFG-010 precondition).**

**Problem.** `ssl: { rejectUnauthorized: false }` at 7 first-party sites
(`ops/relayer/run.ts:108`, `ops/indexer/run.ts:64`, `ops/webhooks/run.ts:52`,
`ops/relayer/replay.ts:46`, `ops/relayer/e2e-test.ts:73`,
`ops/relayer/e2e-twowallet.ts:71`, `ops/indexer/replay.ts:94`) plus
`packages/app/lib/db/client.ts`. This is the Supabase self-signed-pooler
workaround — encrypts but does not verify, so an on-path attacker can MITM.

**Fix.**
- Pin Supabase's CA instead of disabling verification. Obtain the Supabase
  project CA (`prod-ca-*.crt`), ship it with ops (e.g.
  `ops/_shared/supabase-ca.pem`), and build one shared pool factory:
  ```ts
  // ops/_shared/db.ts
  import pg from "pg";
  import { readFileSync } from "node:fs";
  export function makePool(connectionString: string) {
    return new pg.Pool({
      connectionString,
      ssl: {
        ca: readFileSync(process.env.PG_CA_PATH!, "utf8"),
        rejectUnauthorized: true,        // verify-full
        servername: process.env.PG_SERVERNAME, // pooler hostname for SNI/hostname check
      },
    });
  }
  ```
- Replace all 7 ops sites + `lib/db/client.ts` to use the shared factory.
- **Startup self-test:** on boot, run `SELECT 1`; if the effective TLS mode is
  not verify-full (or the CA is missing), `process.exit(1)` with a sanitized log
  (never print the DSN). Refuse to start insecure in production.
- Confirm the live relayer/indexer/webhook `.env` DSNs do not re-introduce
  `sslmode=disable`/`no-verify`.

**Then AFG-010 — read-time gateway re-validation.**

**Problem.** `gatewayFor()` (`ops/relayer/run.ts:149-152`) uses the DB
`gateway_address` as both the `approve()` spender and the `settleInvoice` target
with no env cross-check on the non-NULL path
(`callSettle`, `ops/relayer/run.ts:407-433`).

**Fix.**
- Add a `GATEWAY_ALLOWLIST` env (comma-separated, lowercased) — typically just
  the env `GATEWAY_ADDRESS`, plus any in-flight migration addresses.
- In `gatewayFor()`, after resolving the address, assert membership in the
  allowlist; on mismatch, **fail the job** (do not approve/settle) and alert.
  ```ts
  function gatewayFor(row: QueueRow): Address {
    const addr = (row.gateway_address ?? GATEWAY).toLowerCase();
    if (!GATEWAY_ALLOWLIST.has(addr)) {
      throw new Error(`gateway_not_allowlisted:${addr}`);
    }
    return addr as Address;
  }
  ```
- Defense-in-depth: scope the `approve()` to exactly the gross payout (already
  the case) and prefer `approve(target, 0)` cleanup after settle.

**Verification.**
- DB TLS: integration test that a self-signed cert is rejected (no
  `rejectUnauthorized:false` anywhere — `grep -rn rejectUnauthorized ops/ packages/app/lib/db`
  returns only the new verify-true factory).
- AFG-010: relayer unit test feeding a tampered `gateway_address` → job fails
  with `gateway_not_allowlisted`, no `approve`/`settle` issued.

**Effort: M.** Ship DB TLS pinning now; the allowlist gate is small and can land
in the same PR.

---

## Phase 3 — AFG-003 + AFG-004: server-owned catalog + abuse controls (Medium + Low)

**Problem.** `packages/shop/app/api/checkout/start/route.ts` parses the body
with a bare cast and computes `subtotal = Σ price·qty` from client values
(`route.ts:52-59`), ignoring the server catalog (`packages/shop/lib/products.ts`).
The endpoint is anonymous and mints a real on-chain invoice with the shop's key.

**Fix (AFG-003).**
- Replace the body contract: accept only `{ items: [{ sku, qty, size? }], address, payIn }`.
  Validate with zod; `qty` as a bounded positive integer (e.g. 1–10 server-side).
- Resolve `price`, `name`, and validity from `getProduct(sku)` server-side;
  reject unknown SKUs. Compute `subtotal` from catalog prices only.
- Persist a server-side pending order keyed to the minted invoice; fulfill
  against that record, not client-authored metadata.

**Fix (AFG-004).**
- Add an abuse gate before the privileged upstream call: per-IP rate limit
  and/or a lightweight bot/challenge check; idempotency key to collapse retries.
- Keep relying on the upstream 60/60 per-merchant cap as a backstop, but note it
  fails open on a Postgres outage — consider a local cap that fails closed.

**Verification.**
- Repro from the audit (10 tees at `$0.01`) must now 400/return catalog total.
- Tampered/unknown SKU and qty > bound rejected.
- Anonymous flood test bounded by the new per-IP limit.

**Effort: M.**

---

## Phase 4 — AFG-001 + AFG-002: pin webhook DNS, normalize IPs (Medium + Low)

**Problem.** Validation resolves at `ops/webhooks/run.ts:172` but `fetch(row.url)`
re-resolves independently at `:203` (TOCTOU / rebinding); the HTTPS-only guard is
gated on `NODE_ENV === "production"` (`:169`) which the checked-in
`arcora-webhooks.service` never sets. The IPv6 classifier (`:140-148`) misses
hex/expanded/NAT64/6to4 IPv4-mapped forms.

**Fix.**
- Resolve once and pin the validated IP onto the connection via a custom
  `lookup` hook (undici `Agent` with a `connect`/`lookup` that returns the
  pre-validated address) while keeping the original hostname for Host/SNI. Apply
  on every new connection; keep `redirect: "manual"` (already present).
- Replace the hand-rolled classifier with a maintained library (`ipaddr.js`):
  normalize to canonical form, then deny all special-purpose ranges (loopback,
  RFC1918, link-local, ULA, multicast, IPv4-mapped/compatible, NAT64, 6to4).
  Share this one implementation between the validator and the pinned lookup.
- Assert production mode at daemon startup (and add `Environment=NODE_ENV=production`
  to the systemd unit in Phase 5) so the HTTPS-only branch is guaranteed.

**Verification.**
- Re-run the AFG-001 rebinding PoC → must fail to reach loopback (connection
  goes to the pinned public IP or is refused).
- Unit table of the AFG-002 bypass strings (`::ffff:7f00:1`, `64:ff9b::7f00:1`,
  etc.) → all classified private.

**Effort: S–M.**

---

## Phase 5 — AFG-021: unprivileged daemons + systemd sandboxing (Low)

**Problem.** `ops/{relayer,indexer,webhooks}/*.service` run as root from `/root`
with `User=`/`Group=` commented out and no hardening directives.

**Fix.**
- Create an `arcora-ops` system user/group on the VPS; move runtime files out of
  `/root` (e.g. `/opt/arcora-ops/*`).
- Uncomment/activate `User=arcora-ops`, `Group=arcora-ops` in each unit; update
  `WorkingDirectory` and `EnvironmentFile` paths; `chown` the dirs and `.env`s.
- Add hardening to each `[Service]` block:
  `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`,
  `PrivateTmp=yes`, `ProtectKernelTunables=yes`, `RestrictAddressFamilies=AF_INET AF_INET6`,
  and a narrow `ReadWritePaths=` (only what each daemon writes).
- Add `Environment=NODE_ENV=production` (pairs with Phase 4).
- `systemd-analyze security <unit>` to confirm the score drops.

**Verification.** `systemctl show -p User,ProtectSystem,NoNewPrivileges <unit>`
reflects the new config; daemons still run and process jobs.

**Effort: S** (ops change on the VPS; units already exist in-repo).

---

## Phase 6 — AFG-005 + AFG-013: fail-closed compliance + refund semantics (Low)

**AFG-005.**
- In production/mainnet, fail startup unless `COMPLIANCE_PROVIDER` is a real
  provider (reject `noop`); default `COMPLIANCE_FAIL_OPEN_FOR_INVOICE` to
  **false** outside testnet.
- On RPC payout-read error, fail closed (503) rather than screening the identity
  address; on provider error, fail closed unless explicitly opted open for
  testnet. Files: `packages/app/lib/compliance/factory.ts`,
  `packages/app/app/api/invoices/route.ts:188,214`.

**AFG-013.** Pick one and apply consistently:
- **Option A (enforce):** add `if (block.timestamp >= e.claimableAt) revert RefundWindowClosed();`
  to `refundInvoice()` in `packages/contracts/src/ArcFXGateway.sol`. This is a
  contract change → requires a new deploy + audit-fix bytecode; defer to the V12
  block already tracked in ROADMAP.
- **Option B (document, no redeploy):** make the soft-window reality consistent
  everywhere — fix `RefundButton.tsx` (don't present `claimableAt` as a hard
  cutoff), the quickstart docs, and the API state model to describe
  first-tx-wins. Lower risk; do this now even if Option A is chosen for V12.

**Verification.** Compliance: prod config with `noop` fails to boot; RPC/provider
error paths return 503 in prod. Refund: Forge test for Option A; doc/UI review
for Option B.

**Effort: M** (Option A is contract+deploy; Option B is docs/UI only).

---

## Phase 7 — AFG-009 + AFG-006: input bounds + CSRF consistency (Low)

**AFG-009.** Add a length/precision cap in the schemas **before** `BigInt()`:
- `packages/app/app/api/checkout/quote/route.ts:55`,
  `packages/app/app/api/quote/route.ts:33`,
  `packages/app/app/api/checkout/submit/route.ts:60` — e.g.
  `z.string().regex(/^\d{1,30}(\.\d{1,18})?$/)` (cap digits/precision to the
  domain max). Optionally enforce a request-body size cap at the edge.

**AFG-006.** Apply the existing `isSameOrigin` guard (`packages/app/lib/security/csrf.ts`)
to the three unguarded routes:
- `packages/app/app/api/merchant/api-key/route.ts` (POST),
- `packages/app/app/api/merchant/origins/route.ts` (PATCH),
- `packages/app/app/api/merchant/bootstrap/route.ts` (POST).
Add route-level regression tests asserting a 403 on cross-origin.

**Verification.** Oversized digit string → 400 (no multi-MB `BigInt` parse).
Cross-origin POST to the three routes → 403.

**Effort: S.**

---

## Dependency / tooling follow-ups (from the audit's tool results)

- Bump the root **Hono** override to the patched release named by
  `pnpm audit`; re-run `pnpm audit --prod --audit-level moderate` and confirm
  the 13 Moderate advisories clear or are documented as unreachable.
- Re-run Slither after the AFG-013 contract change (if Option A) and keep the
  `nonReentrant` + CEI mitigations.

---

## Suggested PR sequencing

1. **PR-1 (Phase 1)** — scoped keys + docs. Highest priority; no infra blockers.
2. **PR-2 (Phase 2)** — DB TLS pinning + relayer allowlist (ship DB TLS even if
   the allowlist slips). Coordinate with the VPS `.env`/CA rollout.
3. **PR-3 (Phase 3)** — shop catalog + abuse controls.
4. **PR-4 (Phase 4 + Phase 5)** — webhook DNS pinning + IP normalization +
   systemd hardening (they share the `NODE_ENV=production` change).
5. **PR-5 (Phase 6 Option B + Phase 7)** — fail-closed compliance, refund
   doc/UI alignment, input bounds, CSRF consistency.
6. **V12 block** — AFG-013 Option A contract change + Hono bump, batched with the
   contract findings already in ROADMAP.
