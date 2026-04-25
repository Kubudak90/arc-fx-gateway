# Plan 2 — SDK + Hosted Checkout + Minimal Merchant Surface — Design Spec

**Date:** 2026-04-25
**Status:** Design approved, pending implementation plan
**Scope:** Plan 2 of the Arc FX Gateway grant submission. Builds on the deployed protocol (Plan 1 + 1.5).
**Timeline:** ~3 weeks solo full-stack
**Live protocol:** Gateway `0xaBa4fc9a11e5E39713F6D6E35a892929e261C53D`, OracleAMM `0xC2020098aF328ac9CBD274267F424822C400dD66` on Arc testnet (chainId 5042002).

---

## 1. Overview

Plan 2 ships the customer-facing and merchant-facing surfaces that turn the on-chain `ArcFXGateway` into a usable product:

1. **`@arc-fx/checkout` npm SDK** — three-function client library (init, createInvoice, openCheckout). Zero EVM dependencies; merchant just calls `openCheckout(invoice)` and the customer is redirected to a hosted page.
2. **Hosted Next.js app** at `checkout.arc-fx.xyz` — Stripe-style hosted checkout page (`/i/:invoiceId`) plus a minimal merchant dashboard (`/m`) with SIWE login, settings, and invoice history.
3. **API routes** for invoice CRUD, quote, SIWE auth, and cron-triggered indexer + webhook dispatch.
4. **Vercel Cron indexer** that polls the chain every 30 s, mirrors `InvoicePaid` events into Postgres, and queues HMAC-signed webhooks to merchants' URLs.

The split between protocol (Plan 1) and product (Plan 2) is preserved: Plan 2 is a thin orchestration layer on top of an immutable, permissionless gateway.

**Out of scope for Plan 2:** multi-tenant production hardening (rate-limit tuning, anomaly detection), refunds/chargebacks, mainnet deployment, mobile SDK, customer-side wallet onboarding tutorial, multi-currency dashboards, i18n.

---

## 2. Goals & Non-Goals

### Goals
- **One-line merchant integration**: `npm install @arc-fx/checkout`, then three lines of code to accept payment.
- **Stripe-style hosted checkout**: customer redirects to our domain, completes payment, returns to merchant's `successUrl`.
- **End-to-end loop**: `createInvoice` → customer pays → indexer detects → DB updated → webhook delivered → merchant sees Paid status.
- **Wallet-native merchant onboarding**: SIWE auth, no email/password.
- **Production-shaped security**: API key (bcrypt-hashed) for inbound auth, separate webhook secret (AES-GCM-encrypted) for outbound HMAC signing.
- **Live demo URL** anyone can visit with a wallet to make a real testnet payment.

### Non-Goals
- Not a multi-merchant SaaS yet (single Postgres tenant, no rate-limit per merchant beyond a global default).
- Not a payments gateway with fiat off-ramp.
- Not a customer onboarding wizard (assume customer already has a wallet + EURC).
- Not a real-time push system (cron polling, not WebSockets).

---

## 3. Architecture

Four layers behind a single Vercel deployment:

| Layer | Responsibility | Surface |
|-------|----------------|---------|
| SDK | Stateless redirect-to-checkout | `@arc-fx/checkout` (npm) |
| Hosted UI | Customer checkout page + merchant dashboard | `/i/:invoiceId`, `/m/*` |
| API | Inbound REST + cron handlers | `/api/*` |
| Indexer | Chain → DB sync + webhook dispatch | Vercel Cron jobs |

**Key design decisions:**
- **Vercel + Vercel Postgres** — chosen for simplicity, free-tier sufficiency for testnet demo, and one-command deploy. Independent of GitHub Actions for CI; Vercel auth supports email/Google.
- **SIWE merchant auth** — wallet sign-in, no password store. Aligns with crypto-native UX and the merchant address is needed on-chain for `registerMerchant` anyway.
- **Server-paid invoice creation** — the API server holds a hot wallet that submits `Gateway.createInvoice(...)` on the merchant's behalf. Removes a per-invoice on-chain step from the merchant's hot path. Server wallet is gas-funded from faucet on testnet.
- **API key vs webhook secret split (Stripe pattern)** — API key (`ak_live_...`) is bcrypt-hashed; never stored in plaintext after issuance. Webhook secret (`whsec_...`) is separate, AES-256-GCM-encrypted at rest with a server-side master key. Compromising one does not yield the other.
- **Cron polling, not push** — Vercel Cron every 30 s indexes events from a 5-block reorg buffer. Customer browser also polls in parallel (DB or chain) for instant UX while page is open.

```
┌──────────────────────────┐         ┌────────────────────────────┐
│  Merchant site           │         │  Customer browser          │
│  + @arc-fx/checkout SDK  │  →      │  (wallet extension)         │
└──────────┬───────────────┘         └────────────┬───────────────┘
           │ ArcFX.openCheckout()                 │
           ▼                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│   checkout.arc-fx.xyz  (Next.js 15 App Router on Vercel)         │
│  Public routes: /i/:invoiceId, /api/quote, /api/invoices         │
│  Merchant: /m/login (SIWE), /m/dashboard, /m/settings            │
│  Cron: /api/cron/index-events, /api/cron/dispatch-webhooks       │
└──────────────┬──────────────────────────────────────┬───────────┘
               ▼                                       ▼
        ┌──────────────┐                     ┌─────────────────┐
        │  Postgres    │                     │  Arc testnet    │
        │  (mirror)    │                     │  (Gateway/Pool) │
        └──────────────┘                     └─────────────────┘
```

---

## 4. Components

### 4.1 `@arc-fx/checkout` (npm SDK)

**Role:** Stateless redirector. Calls our REST API to mint an invoice, opens hosted checkout in the same tab.

**Public API:**
```ts
ArcFX.init({ apiKey: string, environment?: 'testnet' | 'mainnet' });

ArcFX.createInvoice(params: {
  amountUsdc: number;             // human units, e.g. 49.99
  payInToken: 'USDC' | 'EURC';
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}): Promise<{ invoiceId: string; url: string }>;

ArcFX.openCheckout(invoice: { url: string }): void;  // window.location.href = invoice.url
```

- **Build:** TypeScript → ESM + CJS bundles. Target size <5 KB gzipped.
- **Dependencies:** none beyond `fetch` and `window`. Tree-shake-friendly.
- **Sister package:** `@arc-fx/checkout-react` exposes a `useCheckout({ apiKey })` hook + `<CheckoutButton />` component. Adds React peer dep.
- **Distribution:** Public npm. If `@arc-fx` scope is unavailable, fall back to `arc-fx-checkout` (no scope).
- **Errors:** Custom `ArcFXError` class with discriminated `code: 'INVALID_API_KEY' | 'NETWORK' | 'SERVER_ERROR' | 'INVALID_URL' | 'TIMEOUT'`.

### 4.2 Hosted Next.js app

**Stack:** Next.js 15 App Router · Tailwind v4 · wagmi + viem · thirdweb Connect (customer wallet only) · iron-session (SIWE) · drizzle-orm · @vercel/postgres.

**Public customer routes:**
| Route | Purpose |
|-------|---------|
| `/i/[invoiceId]` | Customer checkout — connect wallet → quote → approve → pay → success |

**Merchant routes (SIWE-protected):**
| Route | Purpose |
|-------|---------|
| `/m/login` | SIWE flow — wallet sign-in nonce + verify |
| `/m/dashboard` | Invoice list, recent activity |
| `/m/settings` | Payout token, webhook URL, API key rotate, webhook secret rotate |

**API routes:**
| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/invoices` | API key (X-Arc-Api-Key) | Create invoice (server submits on-chain), returns `{ invoiceId, url }` |
| `GET /api/invoices/:id` | Public | Read invoice status from DB mirror |
| `GET /api/quote` | Public | Live pool quote (read-only chain call) |
| `POST /api/auth/siwe/nonce` | — | Issue SIWE nonce |
| `POST /api/auth/siwe/verify` | — | Verify SIWE signature, set iron-session cookie |
| `POST /api/cron/index-events` | `Authorization: Bearer ${CRON_SECRET}` | Vercel Cron — chain → DB sync |
| `POST /api/cron/dispatch-webhooks` | `Authorization: Bearer ${CRON_SECRET}` | Vercel Cron — pending webhook delivery |

### 4.3 Postgres schema

```sql
merchants (
  id                  uuid PRIMARY KEY,
  address             text UNIQUE NOT NULL,
  payout_token        text NOT NULL,
  webhook_url         text,
  api_key_hash        text NOT NULL,
  webhook_secret_enc  bytea NOT NULL,
  webhook_secret_iv   bytea NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

invoices (
  id              text PRIMARY KEY,
  merchant_id     uuid NOT NULL REFERENCES merchants(id),
  pay_in_token    text NOT NULL,
  amount_out      numeric NOT NULL,
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL CHECK (status IN ('created', 'paid', 'expired')),
  paid_by         text,
  paid_tx         text,
  paid_at         timestamptz,
  metadata        jsonb,
  success_url     text NOT NULL,
  cancel_url      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

webhook_attempts (
  id              uuid PRIMARY KEY,
  invoice_id      text NOT NULL REFERENCES invoices(id),
  url             text NOT NULL,
  payload         jsonb NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  next_attempt    timestamptz NOT NULL,
  succeeded_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

indexer_state (
  key             text PRIMARY KEY,
  value           text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

server_wallets (
  id                      uuid PRIMARY KEY,
  address                 text UNIQUE NOT NULL,
  encrypted_pk            bytea NOT NULL,
  pk_iv                   bytea NOT NULL,
  balance_alert_below     numeric,
  created_at              timestamptz NOT NULL DEFAULT now()
);

siwe_nonces (
  nonce       text PRIMARY KEY,
  expires_at  timestamptz NOT NULL,
  used        boolean NOT NULL DEFAULT false
);
```

Migrations are managed by drizzle-kit; pushed to test DB before each test run.

### 4.4 Indexer + webhook dispatcher

**`/api/cron/index-events` (every 30 s):**
1. Read `last_processed_block` from `indexer_state`.
2. `fromBlock = last_processed_block + 1`, `toBlock = currentBlock - 5` (reorg buffer).
3. Call `viem.getLogs({ address: GATEWAY, event: InvoicePaid, fromBlock, toBlock })`.
4. For each log: update `invoices` (set `status='paid'`, `paid_by`, `paid_tx`, `paid_at`); insert `webhook_attempts` row with `next_attempt = now`.
5. Update `indexer_state.last_processed_block = toBlock`. All in a single transaction.

**`/api/cron/dispatch-webhooks` (every 30 s):**
1. Select up to 50 rows where `succeeded_at IS NULL AND next_attempt <= now`.
2. For each: decrypt `webhook_secret`, compute `sig = hmac_sha256(body, secret)`, POST with header `X-Arc-Signature: sha256=hex(sig)`.
3. 2xx → `succeeded_at = now`. 4xx (after 3 attempts) → terminal, `last_error` set. 5xx / timeout → `attempts++`, `next_attempt = now + 2^attempts s`, capped at 24 h.
4. Idempotency: each payload includes a stable `event_id` (UUID); merchants are documented to dedupe.

### 4.5 Server hot wallet (gas-as-a-service)

A single hot wallet, generated locally, encrypted with AES-256-GCM using `MASTER_KEY` env var, stored in `server_wallets`. Used to:
- Submit `Gateway.createInvoiceFor(...)` on behalf of merchants who have authorized this address as a delegate.
- (Future) submit `withdrawFees` on schedule.

Balance is monitored by a daily check; if below `balance_alert_below`, dashboard banner + Vercel log alert.

### 4.6 Gateway v0.3.0 — `createInvoiceFor` extension

The Plan-1 Gateway exposes `createInvoice(...)` which keys off `msg.sender == merchant`. For server-paid invoice creation we add three functions in a backward-compatible v0.3.0 deployment:

```solidity
mapping(address merchant => mapping(address delegate => uint64 expiresAt))
    public delegateAuthorizations;

event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt);
event DelegateRevoked(address indexed merchant, address indexed delegate);

function authorizeDelegate(address delegate, uint64 expiresAt) external {
    if (!merchants[msg.sender].registered) revert NotMerchant();
    delegateAuthorizations[msg.sender][delegate] = expiresAt;
    emit DelegateAuthorized(msg.sender, delegate, expiresAt);
}

function revokeDelegate(address delegate) external {
    delegateAuthorizations[msg.sender][delegate] = 0;
    emit DelegateRevoked(msg.sender, delegate);
}

function createInvoiceFor(
    address merchant,
    bytes32 id,
    address payIn,
    uint256 amountOut,
    uint64 expiresAt
) external {
    uint64 authExpiry = delegateAuthorizations[merchant][msg.sender];
    if (authExpiry < block.timestamp) revert DelegateNotAuthorized();
    Merchant memory m = merchants[merchant];
    if (!m.registered) revert NotMerchant();
    if (payIn == m.payoutToken) revert UnsupportedPair();
    if (payIn != address(USDC) && payIn != address(EURC)) revert UnsupportedPair();
    if (invoices[id].status != InvoiceStatus.None) revert InvoiceAlreadyExists(id);

    invoices[id] = Invoice({
        merchant:  merchant,
        payIn:     payIn,
        amountOut: amountOut,
        expiresAt: expiresAt,
        status:    InvoiceStatus.Created,
        paidBy:    address(0)
    });
    emit InvoiceCreated(id, merchant, payIn, amountOut, expiresAt);
}
```

**Properties:**
- Existing `createInvoice` is preserved unchanged (merchants who self-submit still work).
- Delegate authorization is on-chain (no signatures, no replay risk, on-chain revocation).
- One-time merchant action: `authorizeDelegate(serverWallet, farFutureTimestamp)` during onboarding.
- v0.3.0 deploys a new immutable Gateway address; the old v0.2.0 Gateway remains live for existing flows. Plan 2 wires through the v0.3.0 instance.

This addition is small (~30 lines of contract + 5 unit tests + 1 fork test) and lives at the start of the Plan 2 implementation plan.

---

## 5. Data Flow

### 5.1 Merchant onboarding (one-time)
1. Merchant visits `/m/login`.
2. wagmi connects wallet → server issues SIWE nonce → wallet signs → server verifies → iron-session cookie set.
3. Merchant fills `/m/settings`: payout token (USDC by default), webhook URL.
4. Server generates `api_key` (random 32 bytes, prefixed `ak_live_`) and `webhook_secret` (random 32 bytes, prefixed `whsec_`).
5. `api_key` shown once, `bcrypt(api_key)` stored as `api_key_hash`. `webhook_secret` shown once, AES-GCM encrypted into `webhook_secret_enc`.
6. Merchant clicks "Register on-chain" — wagmi sends `Gateway.registerMerchant(payoutToken)` from their wallet. On confirm, DB inserts `merchants` row.
7. UI prompts a second tx: `Gateway.authorizeDelegate(serverWalletAddress, type(uint64).max)` so the server can submit invoices on the merchant's behalf. (Two consecutive wagmi popups during onboarding — acceptable one-time UX.)

### 5.2 Invoice creation (programmatic, server-paid)
1. Merchant backend `POST /api/invoices` with `X-Arc-Api-Key` and JSON body.
2. Server: bcrypt compare → look up merchant address → generate `invoiceId` (random bytes32) → compute `amountOut = round(amountUsdc * 1e6)` → `expiresAt = now + 30 min`.
3. Server submits `Gateway.createInvoiceFor(merchantAddress, invoiceId, payIn, amountOut, expiresAt)` using the hot wallet (merchant authorized this delegate during onboarding §5.1.7).
4. On tx confirm: insert `invoices` row with `status='created'`, store `success_url`, `cancel_url`, `metadata`.
5. Return `{ invoiceId, url: 'https://checkout.arc-fx.xyz/i/<invoiceId>' }`.

If the merchant has not yet authorized the server delegate (or the authorization has expired), the API returns `412 Precondition Failed` with `{ error: 'delegate_not_authorized' }` and a dashboard deep-link.

### 5.3 Customer payment
1. Merchant calls `ArcFX.openCheckout(invoice)` → `window.location.href = invoice.url`.
2. `/i/[invoiceId]` SSR fetches invoice from DB.
3. If `status='created'` and not expired: render checkout UI with currency, amounts.
4. Customer connects wallet via thirdweb Connect.
5. UI calls `/api/quote?from=EURC&to=USDC&amountOut=<n>` → renders "You pay X EURC" with rate + fee breakdown.
6. Quote auto-refreshes every 30 s; "Refresh" button after.
7. Customer clicks Pay → wagmi sends `EURC.approve(Gateway, maxAmountIn)` → wagmi sends `Gateway.pay(invoiceId, maxAmountIn)`.
8. Client polls `/api/invoices/:id` every 3 s; also subscribes to wagmi receipt.
9. On `status='paid'`: redirect to merchant's `successUrl`.

### 5.4 Status sync (cron, every 30 s)
See §4.4 above.

### 5.5 Webhook dispatch (cron, every 30 s)
See §4.4 above.

---

## 6. Error Handling

### 6.1 SDK
| Failure | Detection | Response |
|---------|-----------|----------|
| 401 invalid API key | HTTP status | `throw ArcFXError('INVALID_API_KEY')` |
| 5xx | HTTP status | `throw ArcFXError('SERVER_ERROR', { retryAfter })` |
| Network timeout (15 s) | fetch reject | `throw ArcFXError('NETWORK')` |
| Invalid `successUrl` format | SDK pre-validate | synchronous `throw ArcFXError('INVALID_URL')` |

### 6.2 Hosted checkout
| Failure | UX |
|---------|----|
| Invoice not found | "Invoice not found or expired. Contact merchant." + retry |
| Invoice expired | Auto-redirect to `cancelUrl` with `?reason=expired` |
| Invoice already paid | Direct redirect to `successUrl?status=already-paid` |
| Wallet disconnect | Banner: "Reconnect to continue" |
| Quote stale (>30 s) | Refresh button + force re-confirm |
| `EURC.approve` rejected | Toast: "Approval rejected. Try again." |
| `Gateway.pay` revert | Decode custom error → human message (`SlippageExceeded` → "rate moved, refresh"; `OracleDeviation` → "market disrupted"; `InvoiceExpired` → redirect cancelUrl) |
| Tx pending >5 min | "Transaction stuck — see explorer" + manual check |

### 6.3 API
| Failure | Response |
|---------|----------|
| Bad API key | 401 `{ error: 'invalid_api_key' }` |
| Rate limit | 429 + `Retry-After` |
| Server wallet OOG | 503 + alert log; failover to backup wallet if configured |
| `createInvoice` chain revert | 502 + DB rollback |
| Quote chain error | 503; respond with last cached quote (≤5 min old) |
| SIWE nonce reuse | 401 + new nonce |

### 6.4 Indexer
| Failure | Recovery |
|---------|----------|
| RPC timeout | retry next tick; do not advance block pointer |
| Reorg detected (block hash mismatch) | reset `last_processed_block -= 20`, re-index |
| Cron overlap | DB advisory lock — second invocation skips |
| DB write fail | abort, retry next tick |

### 6.5 Webhook dispatch
| Failure | Recovery |
|---------|----------|
| 4xx | terminal after 3 attempts, `last_error` set |
| 5xx / timeout | exponential backoff 1s, 2s, 4s, 8s, …, capped at 24 h |
| DNS / connection refused | treated as 5xx |
| Receiver signature mismatch | their problem; we still mark delivered on 2xx |

### 6.6 Cross-cutting
- **Idempotency**: every webhook payload has `event_id` (UUID); merchants must dedupe.
- **No double-charge**: on-chain `InvoiceAlreadyPaid` revert; DB never marks paid twice (unique constraint via status check).
- **No silent loss**: failures surface to merchant via dashboard alerts and webhook URL failures.
- **Observability**: critical paths log to Vercel logs. Production-grade tracing (Sentry, Datadog) deferred.

---

## 7. Testing Strategy

| Layer | Tool | Target |
|-------|------|--------|
| Unit (TS) | Vitest | ~40 tests: SDK, HMAC/AES helpers, SIWE verify, DB queries |
| API integration | Vitest + supertest + test DB | ~25 tests: every endpoint × happy/sad/auth |
| Component (UI) | Vitest + Testing Library | ~15 tests: React adapter, key components |
| E2E | Playwright + Synpress (MetaMask mock) | 6 critical flows |
| Contract | Foundry (Plan 1) | unchanged — Gateway already covered |

### Coverage
- SDK: ≥ 95% line, ≥ 90% branch
- API handlers: ≥ 90% line, ≥ 80% branch
- Cron logic: ≥ 95% line, ≥ 90% branch
- Auth (SIWE + API key + HMAC): 100% line + branch
- UI: manual QA

### Test DB
- Local: `docker-compose up postgres` (postgres:16, ephemeral volume).
- CI: GitHub Actions Postgres service. Per-test isolation via transaction rollback.
- Migrations: drizzle-kit push before each suite.

### E2E flows (Playwright)
1. **Happy path** — merchant onboard → API key → invoice → customer pay → status=paid → webhook delivered.
2. **Expired invoice** — `vm.warp` 30 min → customer visit → expired UX + redirect to cancelUrl.
3. **Replay** — same `invoiceId` second pay attempt → "already paid" UX.
4. **Rate refresh** — oracle moves mid-checkout → "Refresh quote" CTA, customer re-signs.
5. **SIWE auth** — wallet sign-in → dashboard → logout.
6. **Webhook retry** — merchant URL returns 500 → exponential backoff → eventually 200 → delivered.

### Static + security
- TypeScript strict + `noUncheckedIndexedAccess`.
- ESLint + @typescript-eslint + Next.js plugin.
- `npm audit --omit=dev` in CI; fail on critical/high.
- Secret scanning: GitHub native + gitleaks pre-commit.
- Dependabot weekly.
- OWASP Top-10 manual review for API endpoints (XSS, CSRF, SQL injection, IDOR, mass assignment, broken auth).

### Scope guard (YAGNI)
- No load testing (testnet, demo traffic).
- Chrome-only Playwright; Safari/Firefox manual spot-check.
- Basic a11y via axe-core; full WCAG 2.1 deferred.
- English-only UI; i18n deferred.

---

## 8. Open Questions / Risks

1. **Gateway v0.3.0 redeploy** — Plan 2 starts with deploying a new Gateway instance carrying the `createInvoiceFor` extension. The Plan 1.5 v0.2.0 Gateway remains live but is superseded for the product flow. Migration: redeploy, re-bootstrap the OracleAMM with the new Gateway as expected caller (no change needed since pool is permissionless), update `deployments/arc-testnet.json`, smoke-test.
2. **Vercel free-tier limits** — Cron: 2 jobs at any rate on Hobby plan. We need 2 (`index-events`, `dispatch-webhooks`). On the edge of the limit; if a third cron is needed (e.g., expiry sweeper) we either bundle into one cron or upgrade to Pro ($20/mo).
2. **Server hot-wallet gas top-up** — testnet faucet rate-limits to 20 USDC / 2 h. Demo traffic could outpace it. Mitigation: monitor, document.
3. **Reorg handling** — Arc has sub-second finality so we use a 5-block buffer. If finality model changes, revisit the buffer.
4. **SIWE replay across chains** — EIP-4361 supports `chainId`; we lock to Arc testnet (5042002). Mainnet rollout will need explicit chain switching.
5. **GitHub Actions vs Vercel preview** — current GitHub account is flagged; Vercel deploys can use Vercel's own GitHub integration when account is unflagged. Demo URL works regardless.
6. **`@arc-fx` npm scope availability** — to be checked at publish time. Fallback `arc-fx-checkout`.
7. **Domain** — `checkout.arc-fx.xyz` placeholder; real domain TBD by user. Vercel-provided default URL works for grant submission.
8. **Webhook secret rotation UX** — we provide a "rotate" button, but rotating mid-flight may break in-flight webhook deliveries. Document; do not auto-rotate.

---

## 9. Success Criteria

- `npm install @arc-fx/checkout` works from a fresh Node project.
- A demo merchant page integrates the SDK in ≤ 10 lines of code.
- A customer with EURC on Arc testnet can complete checkout in < 60 s (excluding wallet confirm time).
- Live demo URL anyone can hit; smoke-test transaction succeeds end-to-end on the deployed Plan 1.5 contracts.
- Webhook delivered to a test endpoint (RequestBin / webhook.site) within 60 s of payment.
- Test coverage targets met; CI green on every push (when GitHub Actions is unflagged).
- Loom video walking through the full flow for grant submission.

---

## 10. Roadmap (post-Plan 2)

- **Plan 3**: production hardening — rate-limit per merchant, anomaly detection, multi-region read replicas, observability (Sentry + tracing), alert routing.
- **Refunds / partial settlements**: contract change + UI flow.
- **Mobile SDK** (React Native + WalletConnect).
- **Multi-currency dashboard** — additional pools, FX corridor switcher.
- **Mainnet deployment** + audit + grant submission v2.
- **Localization** — Türkçe UI ilk öncelik (memory'de Türkiye odağı var).
