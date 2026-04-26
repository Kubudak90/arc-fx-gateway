# Plan 2b — Frontend (Customer + Merchant UI) + E2E + Vercel Deploy — Design Spec

**Date:** 2026-04-25
**Status:** Design approved, pending implementation plan
**Scope:** Plan 2b builds the UI surfaces, end-to-end tests, demo merchant, and production deployment on top of Plan 2a's backend (SDK + API + cron, all live).
**Timeline:** ~2 weeks solo full-stack
**Live backend:** Gateway v0.3 `0x54bDe75530984F4add34Ac14f3d6fd2a515E50AF`, OracleAMM `0xC2020098aF328ac9CBD274267F424822C400dD66`, all `/api/*` endpoints implemented locally; Postgres + cron ready to deploy.

**Design language:** Coinbase-inspired (Coinbase Blue `#0052ff` as singular accent, 56px pill CTAs, dark/light section alternation, Inter family substituting CoinbaseDisplay/Sans/Text, Lucide icons). Reference: `/Users/huseyinarslan/Downloads/DESIGN-coinbase.md`.

---

## 1. Overview

Plan 2b delivers the human-facing layer that turns the Plan 2a backend into a usable product:

1. **Customer checkout** at `/i/[invoiceId]` — Stripe-style hosted page with wallet connect, live FX quote, approve+pay flow, success/error states. Includes WalletConnect QR (free via thirdweb) plus a dedicated "Pay with mobile wallet" QR toggle that hands off the same URL to a phone.
2. **Merchant dashboard** under `/m/*` — SIWE-protected pages: login, dashboard (invoice list + create), settings (API key generation, webhook config, on-chain delegate authorization).
3. **End-to-end test suite** — Playwright + Synpress (MetaMask mock) covering 6 critical flows.
4. **Demo merchant** — separate Vite app at `packages/demo-merchant/` that integrates `@arc-fx/checkout` in 3 lines.
5. **Production deployment** — Vercel for the Next.js app, Vercel Postgres for state, server hot wallet provisioned and faucet-funded, optional custom domain.
6. **Documentation** — three READMEs (root, app, sdk) + Loom walkthrough script for grant submission.

**Out of scope for Plan 2b:** mainnet deployment, multi-currency UI, refunds, mobile-native SDK, full WCAG audit, internationalization (English-only).

---

## 2. Goals & Non-Goals

### Goals
- A customer with a wallet on Arc testnet can complete checkout in <60 s on desktop OR mobile.
- Cross-device handoff via QR works: desktop checkout → scan QR → finish on phone.
- Merchant onboarding (SIWE → settings → register on-chain → authorize delegate → API key) takes <3 minutes.
- All 6 E2E flows pass green in CI.
- Live demo URL works end-to-end on Arc testnet.
- Visual identity reads as "fintech infrastructure" and aligns with the Coinbase/Circle/Arc ecosystem.

### Non-Goals
- Not pixel-perfect Coinbase clone — we substitute open-source fonts for proprietary CoinbaseDisplay/Sans/Text. The design *language* matches; the *exact typeface* doesn't.
- Not multi-merchant SaaS UX (single tenant per deployment, no merchant team management).
- Not a customer wallet onboarding tutorial (we assume the customer has a wallet + EURC).
- Not analytics/observability (deferred to Plan 3).

---

## 3. Architecture

Single Next.js 15 app (`packages/app`) hosting both customer and merchant surfaces. No separate frontend service.

```
packages/app/
├── app/
│   ├── globals.css                # Tailwind v4 @theme (Coinbase tokens)
│   ├── layout.tsx
│   ├── page.tsx                   # Landing (sade)
│   ├── i/[invoiceId]/
│   │   ├── page.tsx               # SSR fetch + initial render
│   │   └── CheckoutClient.tsx     # client-side wallet+pay
│   ├── m/
│   │   ├── layout.tsx             # auth wall + nav
│   │   ├── login/page.tsx         # SIWE
│   │   ├── dashboard/page.tsx     # invoice list + create
│   │   └── settings/page.tsx      # API key, webhook, delegate
│   └── api/...                    # (existing from Plan 2a — unchanged)
├── components/
│   ├── ui/                        # shadcn — overridden with Coinbase tokens
│   ├── checkout/
│   │   ├── InvoiceCard.tsx
│   │   ├── QuoteDisplay.tsx
│   │   ├── PayButton.tsx
│   │   ├── StatusScreens.tsx
│   │   └── MobileWalletQR.tsx
│   └── merchant/
│       ├── ApiKeyDialog.tsx
│       ├── InvoiceTable.tsx
│       ├── CreateInvoiceDialog.tsx
│       ├── DelegateAuthCard.tsx
│       ├── WebhookSettingsCard.tsx
│       └── InvoiceShareQRDialog.tsx
├── lib/
│   ├── chain/wallet-config.tsx    # wagmi config + thirdweb provider
│   ├── ui/format.ts               # currency, address, time formatters
│   ├── ui/coinbase-tokens.ts      # design token TS-side reference
│   └── chain/error-mapper.ts      # contract revert → human message
├── e2e/                           # Playwright + Synpress
├── scripts/
│   ├── provision-server-wallet.ts # one-time wallet provision
│   └── seed-demo-merchant.ts      # one-time demo seed
└── public/
    └── arc-fx-logo.svg

packages/demo-merchant/             # NEW — separate app
├── package.json                   # Vite + React + @arc-fx/checkout-react
├── src/App.tsx                    # one-page "buy this" demo
└── ...
```

**Key decisions:**
- **Tailwind v4 `@theme` blocks** carry the Coinbase token table; component classes never hard-code hex.
- **shadcn/ui** initialized with custom CSS variables overriding the default theme.
- **thirdweb Connect** is the customer-side wallet UI — gives WalletConnect QR for free.
- **wagmi + viem** is the merchant-side wallet UI — direct integration without thirdweb's modal.
- **Server components** do initial invoice fetch (`/i/[invoiceId]/page.tsx`) for fast LCP; **client components** handle wallet interactions.
- **iron-session** middleware on `/m/*` (already wired in Plan 2a `lib/auth/session.ts`).
- **Polling, not WebSocket** — checkout client polls `/api/invoices/:id` every 3 s for status updates.
- **Per-tenant config** — single Postgres tenant for the demo; multi-tenant deferred to Plan 3.

---

## 4. Components

### 4.1 Tailwind v4 theme — `app/globals.css`

```css
@import "tailwindcss";

@theme {
  --color-cb-blue:        #0052ff;
  --color-cb-hover:       #578bfa;
  --color-cb-link:        #0667d0;
  --color-cb-near-black:  #0a0b0d;
  --color-cb-dark-card:   #282b31;
  --color-cb-cool-gray:   #eef0f3;
  --color-cb-muted-blue:  rgba(91, 97, 110, 0.2);

  --font-display: "Inter Display", "Inter", sans-serif;
  --font-sans:    "Inter", sans-serif;
  --font-mono:    "JetBrains Mono", monospace;

  --radius-pill: 56px;
  --radius-full: 100000px;
}
```

Custom utility class for the signature pill button — bypasses shadcn's default radius scale.

### 4.2 Customer surface — `/i/[invoiceId]`

| State | UI |
|-------|----|
| Loading invoice | Skeleton card |
| Created (default) | Big amount, "You pay X EURC" card with auto-refresh quote, dark pill "Connect wallet" CTA, "Pay with mobile wallet" link |
| Connecting wallet | thirdweb modal (includes WalletConnect QR for mobile) |
| Quote stale (>30 s) | Border highlight + toast + "Refresh quote" inline |
| Approving | Pill button: "Approving EURC..." + spinner |
| Paying | Pill button: "Paying..." + explorer link |
| Pay reverted | Toast with mapped error + recovery CTA |
| Tx pending >5 min | Banner: "This is taking longer than usual" + manual check |
| Success | Full-page green checkmark + "Redirecting to merchant..." 3-s countdown |
| Already paid | Brief success → redirect with `?status=already-paid` |
| Expired | Full-page "Invoice expired" + "Return to merchant" → cancelUrl |
| QR mode | Same-URL QR + "Open this on your phone" copy + "Back to desktop" link |

Components: `InvoiceCard`, `QuoteDisplay`, `PayButton` (state machine), `StatusScreens`, `MobileWalletQR`.

### 4.3 Merchant surface — `/m/*`

| Route | Components |
|-------|-----------|
| `/m/login` | Hero "Sign in to Arc FX" (Inter Display 52px), pill `Connect wallet` → SIWE flow |
| `/m/dashboard` | Top nav (logo, links, address chip), section heading "Invoices", `InvoiceTable` (shadcn Table with status badges), `CreateInvoiceDialog` triggered by `+ New invoice` pill button |
| `/m/settings` | Three section cards: `ApiKeyDialog` (generate-once + rotate), `WebhookSettingsCard` (URL input + secret rotate), `DelegateAuthCard` (status + on-chain authorize button) |

Status badges: `Paid` (green dot), `Pending` (yellow), `Expired` (gray). Created-but-tx-pending shows a small spinner inline.

### 4.4 QR flows

Three QR insertion points:

1. **WalletConnect QR** — automatic, lives inside the thirdweb Connect modal. No code from us beyond enabling WalletConnect in the thirdweb config.
2. **Customer "Pay with mobile wallet" toggle** — `MobileWalletQR.tsx` renders a 256×256 QR via `qrcode.react` encoding the same `/i/[invoiceId]` URL. "Copy link" + back button.
3. **Merchant invoice share** — `InvoiceShareQRDialog.tsx` (per row in `InvoiceTable`) shows the same QR plus "Copy URL" and "Print" actions. In-person POS use case.

Backend changes: **none**. QR encodes existing routes.

### 4.5 Demo merchant — `packages/demo-merchant`

Vite + React + Tailwind. One page with:

```tsx
import { CheckoutButton } from "@arc-fx/checkout-react";

export default function App() {
  return (
    <main className="grid place-items-center h-screen">
      <CheckoutButton
        apiKey={import.meta.env.VITE_ARC_API_KEY}
        environment="testnet"
        invoice={{
          amountUsdc: 49.99,
          payInToken: "EURC",
          successUrl: window.location.origin + "/?paid=1",
        }}
      >
        Pay €49.99
      </CheckoutButton>
    </main>
  );
}
```

Deployed as a separate Vercel project (own URL) — proves the SDK works from a fresh app.

---

## 5. Data Flow

### 5.1 Customer payment (desktop, browser-extension wallet)
1. Merchant calls SDK → SDK redirects to `/i/[invoiceId]`.
2. Server component fetches invoice from DB → renders SSR HTML with amount + status.
3. Client component hydrates → fetches `/api/quote` → renders "You pay X EURC" + 30 s timer.
4. Customer clicks "Connect wallet" → thirdweb Connect modal → choose extension wallet → connected.
5. Customer clicks "Pay" → wagmi sends `EURC.approve(Gateway, maxAmountIn)`, then `Gateway.pay(invoiceId, maxAmountIn)`.
6. Client polls `/api/invoices/:id` every 3 s; also subscribes to wagmi receipt for instant UX.
7. On `status='paid'` → success screen → 3 s countdown → redirect to `successUrl`.

### 5.2 Customer payment (mobile handoff via QR)
1. Customer on desktop clicks "Pay with mobile wallet" → `MobileWalletQR` renders QR of current URL.
2. Customer scans with phone → mobile browser opens `/i/[invoiceId]`.
3. Mobile UI runs the same flow, but "Connect wallet" uses thirdweb Connect's mobile auto-detect (deep links to MetaMask Mobile / Rainbow / Trust).
4. Customer signs on phone → cron indexer detects payment within 30 s → desktop polling sees `status='paid'` → desktop redirects to `successUrl`.

### 5.3 Merchant onboarding
1. Visit `/m/login` → connect wallet → SIWE sign → cookie set → land on `/m/dashboard`.
2. On first visit (no merchant row in DB), banner pushes user to `/m/settings`.
3. `/m/settings` opens with `ApiKeyDialog` and `DelegateAuthCard` both showing "Required" badges.
4. Click "Generate API key" → modal shows key once + webhook secret once → user copies.
5. Click "Authorize delegate" → wagmi sends `Gateway.authorizeDelegate(serverWallet, type(uint64).max)`.
6. After both txs confirm, server backfills `merchants` row with `address`, `apiKeyHash`, `webhookSecretEnc`, etc.
7. Webhook URL field is editable any time; saving issues a PATCH to a settings endpoint (added in Plan 2b).

### 5.4 Merchant invoice creation
1. `/m/dashboard` → click "+ New invoice".
2. `CreateInvoiceDialog` form: amount, currency (USDC/EURC), successUrl, optional metadata.
3. Submit → `POST /api/invoices` (uses merchant's existing API key, fetched once after first generation and stored in iron-session).
4. New row appears in `InvoiceTable`. "QR" action shows `InvoiceShareQRDialog` immediately for in-person scenarios.

---

## 6. Error Handling

### 6.1 Customer-facing UI

| Scenario | UX |
|----------|----|
| Invoice not found | Full-page "Invoice not found or expired" + "Contact merchant" |
| Invoice expired | Auto-redirect to `cancelUrl` after 3 s with `?reason=expired` |
| Invoice already paid | Redirect to `successUrl?status=already-paid` |
| Wallet disconnect | Banner: "Wallet disconnected — reconnect to continue" |
| Quote stale | Border highlight + toast + "Refresh quote" |
| Approval rejected | Toast: "Approval rejected. Try again." |
| Pay reverted (`SlippageExceeded`) | Toast: "Rate moved — refreshing quote" + auto-refresh + reset to ready |
| Pay reverted (`OracleDeviation`) | Toast: "Market disrupted — try again in a moment" |
| Pay reverted (`InvoiceExpired`) | Banner: "Invoice expired" + redirect to `cancelUrl` |
| Pay reverted (allowance short) | Toast: "Approval insufficient — re-approve" + reset to approve step |
| Tx stuck >5 min | Banner with explorer link + "Check status" manual button |
| Network error | Inline retry button + last-known state preserved |

### 6.2 Merchant-facing UI

| Scenario | UX |
|----------|----|
| API key dialog dismissed before copy | Cannot reveal again — must rotate; old key still works server-side |
| Webhook URL save fails | Inline error under input, save button stays enabled |
| Delegate auth tx rejected | Toast + retry button persists |
| Indexer lag (status='created' but tx visible on-chain) | Tx hash chip + "Confirming..." spinner; polling every 3 s |
| Webhook URL responding 5xx | Settings page shows "Last 10 attempts" with status; merchant sees retry counter |

### 6.3 Cross-cutting
- **All form inputs** have inline `zod` validation (display message under field on blur).
- **All async actions** disable their trigger and show loading states.
- **Error boundary** at `app/error.tsx` catches unhandled exceptions and shows "Something went wrong — refresh" with optional retry.
- **Toasts** via `sonner` (shadcn-recommended).

---

## 7. Testing

### 7.1 Playwright E2E (6 flows, runs against local dev + test DB)

| # | Flow | Setup | Assert |
|---|------|-------|--------|
| 1 | **Happy path** | seed merchant + API key + delegate auth in DB; mock chain RPC | invoice created, status='paid' after pay sim, webhook delivered to local server |
| 2 | **Expired invoice** | seed expired invoice | `/i/[id]` shows expired UI + redirects to cancelUrl |
| 3 | **Replay** | seed paid invoice | `/i/[id]` redirects to successUrl with `already-paid` |
| 4 | **Rate refresh** | seed invoice; advance system time 30 s mid-test | "Refresh quote" CTA appears, click triggers new quote |
| 5 | **SIWE auth** | none | connect → sign → dashboard, reload → still authenticated, logout |
| 6 | **Webhook retry** | merchant webhook URL set to local 500-returning server | webhook_attempts table shows 3+ attempts with backoff |

Synpress runs MetaMask in a controlled browser context with a deterministic dev mnemonic seeded with testnet USDC + EURC.

### 7.2 Vitest UI tests (Testing Library + happy-dom)

- `InvoiceCard.test.tsx` — renders amount, currency, status badge variants
- `QuoteDisplay.test.tsx` — auto-refresh interval, stale state, refresh button
- `PayButton.test.tsx` — state machine transitions (idle → approving → paying → success/error)
- `useCheckoutPolling.test.tsx` — 3 s interval, stops on `paid`, error backoff
- `ApiKeyDialog.test.tsx` — generate, copy-to-clipboard, can't show twice
- `MobileWalletQR.test.tsx` — QR encodes current URL, copy works
- `format.test.ts` — currency, address abbreviation, time-ago

### 7.3 Coverage targets
- Components: ≥85% line, ≥75% branch
- Lib utilities: ≥95% line
- E2E: 6/6 flows green in CI

### 7.4 CI
GitHub Actions workflow `app-ci.yml` runs:
1. `pnpm install`
2. `pnpm --filter @arc-fx/app lint && pnpm --filter @arc-fx/app typecheck`
3. `pnpm --filter @arc-fx/app test` (vitest)
4. Spin up Postgres service + run migrations
5. Spin up Anvil fork of Arc testnet
6. `pnpm --filter @arc-fx/app exec playwright test`
7. Upload coverage to Codecov

---

## 8. Deploy

### 8.1 Vercel — `packages/app`
- `vercel link` from `packages/app/`
- Vercel project type: Next.js
- Build command: default (`next build`)
- Output: default
- Install command: `pnpm install` (Vercel auto-detects pnpm workspace)
- Root directory: `packages/app`

### 8.2 Vercel Postgres
- Provision via Vercel dashboard → Storage → Postgres → Create
- Auto-injects `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, etc.
- Run `pnpm db:push` against prod DB once after first deploy (manual step)

### 8.3 Environment variables (set in Vercel UI)
- `MASTER_KEY` — `openssl rand -base64 32`
- `IRON_SESSION_PASSWORD` — `openssl rand -base64 32`
- `CRON_SECRET` — random string
- `GATEWAY_ADDRESS=0x54bDe75530984F4add34Ac14f3d6fd2a515E50AF`
- `OracleAMM`, `MockChainlink`, USDC, EURC addresses
- `ARC_TESTNET_RPC=https://rpc.testnet.arc.network`
- `PUBLIC_BASE_URL` — Vercel deployment URL (e.g. `https://arc-fx.vercel.app`)
- `THIRDWEB_CLIENT_ID` — provisioned at thirdweb.com (free tier)
- `WALLETCONNECT_PROJECT_ID` — provisioned at cloud.walletconnect.com (free)

### 8.4 Server hot wallet provision (one-time)
Local script:
```bash
pnpm --filter @arc-fx/app exec tsx scripts/provision-server-wallet.ts
```
- Generates a wallet, encrypts with `MASTER_KEY`, inserts into prod `server_wallets`.
- Outputs the address.
- Operator funds it from the Arc testnet faucet (~5 USDC for invoice creation gas).

### 8.5 Cron registration
`vercel.json` (already in Plan 2a) registers `/api/cron/index-events` and `/api/cron/dispatch-webhooks` at 1-minute granularity. Vercel Hobby plan supports 2 crons at minute granularity.

### 8.6 Demo merchant — separate Vercel project
- Path: `packages/demo-merchant/`
- Type: Vite
- Build: `pnpm build`
- Env: `VITE_ARC_API_KEY` (the API key generated against the demo merchant in the live app)
- URL: e.g. `https://arc-fx-demo.vercel.app`

### 8.7 Custom domain (optional)
- `checkout.arc-fx.xyz` → Vercel project alias (requires DNS access for `arc-fx.xyz`)
- Skippable for grant submission — `*.vercel.app` URLs are fine for v0.1.

### 8.8 Smoke test on prod
1. Visit demo merchant URL, click "Pay €49.99".
2. Land on prod `/i/[invoiceId]`.
3. Connect wallet (testnet account with EURC).
4. Approve + pay.
5. Cron picks up `InvoicePaid` within 60 s.
6. Webhook delivered to webhook.site.
7. Redirect to `successUrl`.
8. Record tx hashes + screenshots into `deployments/`.

---

## 9. Documentation

### 9.1 `packages/app/README.md`
Overview, local dev quickstart (`docker compose up`, `pnpm db:push`, `pnpm dev`), env table, deploy steps, link to Plan 2 spec.

### 9.2 `packages/sdk/README.md`
3-line install + usage example. API table for the three exported functions. Link to live demo URL. Bundle size badge.

### 9.3 Root `README.md`
Update the existing project README to reflect Plan 2 deliverables. Add badges (CI, coverage, npm, Slither). Add a quickstart linking to demo merchant + checkout.

### 9.4 Loom video script
Five-minute walkthrough recorded after smoke test passes. Beats:
1. SDK install + 3-line integration
2. Customer journey on desktop (extension wallet)
3. Customer journey via QR handoff (desktop → phone)
4. Merchant dashboard tour (login, create invoice, settings, delegate auth)
5. Webhook delivery to webhook.site
6. On-chain transaction on Arc testnet explorer

---

## 10. Open Questions / Risks

1. **Vercel Hobby plan cron limit** — 2 crons at 1-min granularity. We need exactly 2. Tight but workable. If a third cron emerges (expiry sweeper), bundle into one of the existing handlers.
2. **WalletConnect Project ID** — required for thirdweb's WalletConnect QR. Free tier covers our demo volume; need to register an account.
3. **thirdweb Client ID** — also required. Both signups before deploy.
4. **Synpress + MetaMask snapshot** — Synpress version pinning is finicky; if upstream changes break our setup, fallback to a manual mock wallet. Document in plan.
5. **Inter Display vs Inter** — Inter v4 distinguishes Display and Sans variants via OpenType features rather than separate files. Verify that `next/font/google` exposes both, otherwise use `Inter` everywhere with manually tighter line-height for headlines.
6. **shadcn/ui defaults vs Coinbase tokens** — shadcn ships with semantic tokens (`--primary`, `--background`); we override these to map to `--color-cb-blue`, `--color-cb-near-black`, etc. Risk: a future shadcn update changes the contract. Pin shadcn CLI version in `package.json`.
7. **Mobile Safari WalletConnect deep links** — known issue with iOS background tab restrictions. Test thoroughly on Safari before grant submission; fallback is "open this in a wallet's in-app browser" instructions.
8. **Demo merchant API key** — committed nowhere. Either set as Vercel env var on the demo project (recommended) or `.env` not pushed.

---

## 11. Success Criteria

- Live demo URL hits Arc testnet and completes a full payment in <60 s.
- All 6 Playwright flows green in CI.
- All UI Vitest tests green.
- SDK works from `packages/demo-merchant` deployed to its own Vercel project.
- README updated, Loom video recorded.
- One screenshot of each: customer success state, merchant dashboard, webhook delivery, on-chain tx.
- Lighthouse score ≥ 80 on `/i/[invoiceId]` (mobile + desktop).

---

## 12. Roadmap (post-Plan 2b)

- **Plan 3**: production hardening — Sentry, anomaly detection, per-tenant rate limits, multi-region.
- **Refunds + dispute resolution** — contract change + UI flow.
- **Mobile-native SDK** (React Native + WalletConnect 2).
- **Multi-currency** — additional pools, FX corridor switcher in dashboard.
- **i18n** — Türkçe önce.
- **Mainnet deploy + audit** — Sherlock micro-audit recommended.
