# UI Redesign Integration — Landing, Checkout, Treasury

**Date:** 2026-05-18
**Branch:** `ui-redesign-2026-05-18`
**Status:** Approved design — ready for implementation planning

## Background

A redesign canvas was delivered at `~/Downloads/arcora-pay/` — 6 artboards across two
visual directions, covering the three public-facing surfaces of the app:

- **Direction A · Editorial Carbon** — light-first, large editorial typography,
  refined whitespace.
- **Direction B · Trading Desk** — dark-first, grid background, neon accents,
  dense real-time data.

Both directions are static HTML/CSS mockups. The real app
(`packages/app`) is Next.js App Router + Tailwind v4 + shadcn. This is a **re-skin**
(port the visual language), not a file copy.

The mockups target three real pages:

| Mockup artboard | Real page |
|---|---|
| `landing.html` | `app/page.tsx` |
| `checkout.html` | `app/i/[invoiceId]/page.tsx` |
| `dashboard.html` | `app/m/treasury/page.tsx` |

## Goals

1. Port the redesign's visual language onto the three real pages.
2. Use a **mix** of directions A and B (decided per surface below).
3. Add a **dark/light theme toggle** to the treasury dashboard.
4. **Strip all fabricated content** — the mockups contain fake social proof,
   fake metrics, and fake compliance claims. None of it ships.
5. Remove all "Stripe" comparisons from copy.

## Non-goals

- No backend, API, contract, or data-model changes. Data sources stay as-is.
- No change to checkout payment logic — `InvoiceCard`, `QuoteDisplay`,
  `PayButton`, `StatusScreens`, `CheckoutClient` keep their behavior; only their
  layout shell changes.
- No font swap. Mockups use IBM Plex; the app keeps Inter + JetBrains Mono
  (the editorial feel comes from layout and scale, not the typeface).
- Other merchant pages (`/m/dashboard`, `/m/settings`, `/m/compliance`, `/m/login`)
  and docs pages are out of scope for this redesign.

## Decisions (from brainstorming)

- **Direction:** a mix of A and B, with Stripe references removed.
- **Scope:** all three pages.
- **Dashboard theme:** dark/light toggle, user-selectable.
- **Process:** spec → implementation plan → implementation.

## Honest-content policy

The existing site is deliberately honest — it carries disclaimers throughout
(`"No fictional volumes"`, `"Illustrative · sample shapes"`,
`"only USDC and EURC have live oracles today"`). The redesign must preserve that
discipline. The following mockup content is **fabricated and will NOT be ported**:

| Fabricated item | Where it appears in mockup |
|---|---|
| All "Stripe" comparisons (hero headline, "Stripe gibi bir P&L" section, page `<title>`s) | A + B landing |
| "Trusted by stablecoin-native teams" logo wall — Lumen, Northbound, vela/studio, Cobalt, Meridian, Hexa & Co | A landing |
| Live ticker with fake settled invoices — `merchant Lumen Apparel / Vela Studio / Cobalt Coffee / Northbound` | A + B landing |
| "App Kit Swap fill 99.97%" metric | A + B |
| Checkout compliance badges — "SOC2 PIPELINE", "TRM SCREENED", "verified merchant" | A + B checkout |
| Fake checkout line items — "Cotton crewneck", "Recycled tote" etc. | A + B checkout |
| "Public order book of every settlement" — global cross-merchant settlement feed | B landing |
| Dashboard treasury figures shown without an "illustrative" qualifier | A + B dashboard |

**Why these are false:** the named companies do not exist; TRM screening is a
v1.x roadmap item, not live (compliance runs `noop` on prod); SOC2 is not held;
a global cross-merchant order book is both a privacy violation and would be empty
in reality.

**Honest replacements** — verifiable trust signals only:

- In place of the fake logo wall: a single line — `"<N> tests passing · audited · open-source"`
  where `<N>` is the **actual passing test count produced by running the suite**
  at implementation time (not a hardcoded guess), plus links to the GitHub repo
  and the live merchant demo.
- In place of the fake ticker: the existing real `LiveSettlement` component
  (a replay of the v0.8 pay-flow on Arc testnet — real data, already disclaimered).
- Landing's `DashboardPreview` keeps its existing `"Illustrative · sample shapes"`
  disclaimer.
- The real treasury dashboard is fed by `/api/merchant/treasury` — genuine
  per-merchant data — so it needs no disclaimer; it shows the signed-in
  merchant's own numbers.

## Architecture

### Theming infrastructure

Tailwind v4 is already configured with `@custom-variant dark (&:is(.dark *))` in
`globals.css`, but no dark palette is defined and `next-themes` is not installed.

- Install `next-themes`.
- Add a `ThemeProvider` in `app/layout.tsx` wrapping existing providers, with
  `attribute="class"`, `defaultTheme="light"`, `enableSystem={false}`.
- Define a dark palette in `globals.css` under a `.dark` selector — dark
  equivalents of the `arcora-*` tokens and the design-system tokens
  (`--ink`, `--ink-2`, `--ink-3`, `--line`, `--bg-elev`, `--bg-elev-2`, `--accent`, etc.).
- The toggle control lives in the **merchant area only** (rendered in
  `app/m/layout.tsx` / `MerchantSidebar`). Landing and checkout render
  light-only — they do not expose the toggle and are unaffected by a stored
  dark preference (force `light` on those routes, or scope the `.dark` class so
  it only applies under `/m`).

**Open implementation detail for the plan:** decide between (a) a route-scoped
theme — `.dark` only ever applied to the `/m` subtree — versus (b) a global
`next-themes` class with landing/checkout overriding to light. Route-scoped is
preferred for predictability; the plan picks one explicitly.

### Surface 1 — Landing (`app/page.tsx`)

- **Base:** Direction A (light, editorial).
- **Borrowed from B:** monospace data-strip treatment, applied to the existing
  real `LiveSettlement` component — not a fake ticker.
- **Kept from current page:** the hero structure, "How it works" 3-step section,
  pillars, roadmap timeline, v2.0 crosschain diagram, v1.x token registry,
  v3.0 endgame section, CTA, `SiteFooter`. All current honest copy and
  disclaimers are retained.
- **Removed:** any Stripe comparison; no "Trusted by" logo wall is added.
- The existing landing components (`LiveSettlement`, `DashboardPreview`,
  `SDKBlock`, `CrosschainRouteDiagram`, `SiteFooter`) are restyled in place,
  not replaced.

### Surface 2 — Checkout (`app/i/[invoiceId]/page.tsx`)

- **Base:** Direction A (light), two-column layout.
- Current layout is a narrow single column (`max-w-md`). New layout: a wide
  two-column shell — left = invoice / order summary, right = live FX quote +
  signing panel.
- **Behavior unchanged:** the server component still fetches the invoice and
  renders `InvoiceCard` + `CheckoutClient`; `QuoteDisplay`, `PayButton`,
  `StatusScreens` keep their logic. Only the surrounding shell and the
  arrangement of these components change.
- **Borrowed from B:** the compact monospace "what you're signing" panel
  (EIP-712 / PermitWitnessTransferFrom detail), rendered from real invoice data.
- **Real data only:** show amount, pay-in token, payout token, expiry, invoice
  id, merchant address. Line items render **only if** `invoices.metadata`
  actually carries them; otherwise that block is omitted. No fake products.
- **Removed:** "SOC2 PIPELINE", "TRM SCREENED", "verified merchant" badges.

### Surface 3 — Treasury dashboard (`app/m/treasury/page.tsx`)

- **Base:** Direction B data density, available in both dark and light via the
  toggle.
- **Behavior unchanged:** still a client component fetching
  `/api/merchant/treasury` and `/api/merchant/escrows`. `TokenSection`,
  `DailyChart`, `Kpi`, `ActivityItem`, `ClaimAllButton` keep their logic.
- **Restyle:** dense, monospace-forward treatment; the existing "Recent activity"
  list gets the B-style live-feed look. `DailyChart` SVG colors become
  theme-aware (the hardcoded `#00c2a8`, `rgba(11,20,38,0.06)`, `#5b6478`,
  `#fff` values must read from CSS variables or branch on theme).
- **Removed:** no global cross-merchant feed; the dashboard shows only the
  signed-in merchant's own data, exactly as today.

## Component / file inventory

**New:**
- `components/ui/ThemeToggle.tsx` — dark/light switch for the merchant area.
- A `ThemeProvider` wrapper (either a small `components/ThemeProvider.tsx` or
  inline in `layout.tsx`).

**Modified:**
- `app/layout.tsx` — add theme provider.
- `app/globals.css` — dark palette under `.dark`.
- `app/page.tsx` — landing restyle, Stripe copy removed.
- `app/i/[invoiceId]/page.tsx` — two-column checkout shell.
- `app/i/[invoiceId]/CheckoutClient.tsx` — adjust to the new shell if needed.
- `app/m/treasury/page.tsx` — dense restyle, theme-aware chart colors.
- `app/m/layout.tsx` and/or `components/merchant/MerchantSidebar.tsx` —
  mount the theme toggle.
- `components/checkout/*` — restyle `InvoiceCard`, `QuoteDisplay`, `PayButton`,
  `StatusScreens` to fit the new shell.
- `components/landing/*` — restyle `LiveSettlement`, `DashboardPreview`,
  `SDKBlock`, `CrosschainRouteDiagram`, `SiteFooter`.
- Package `package.json` — add `next-themes`.

**Unchanged:** all `app/api/*`, `lib/*`, `lib/db/*`, contracts, the indexer,
and all data flows.

## Data flow

No change. Landing is static. Checkout server-fetches one invoice via Drizzle.
Treasury client-fetches `/api/merchant/treasury` + `/api/merchant/escrows`. The
redesign touches presentation only.

## Error handling

Existing states are preserved and restyled, not removed:

- Checkout: `created` / `paid` / `expired` / `failed` status screens.
- Treasury: loading skeleton, `auth_expired`, network error + retry,
  no-merchant, no-paid-invoices empty states.
- Dark mode must be legible in every one of these states — error/amber and
  success/emerald surfaces need dark-palette equivalents.

## Build sequence

1. **Theme infrastructure** — install `next-themes`, add provider, define dark
   palette, add the toggle to the merchant area. Verify the toggle flips the
   dashboard and that landing/checkout stay light.
2. **Landing** — restyle `app/page.tsx` + landing components; remove Stripe
   copy; wire the honest trust line with the real test count.
3. **Checkout** — two-column shell; re-place existing checkout components;
   drop fake badges and fake line items.
4. **Treasury dashboard** — dense restyle; theme-aware `DailyChart`; live-feed
   activity list.

Each step ends with a visual check (Playwright screenshot) and the relevant
test/lint/build run.

## Testing & verification

- `pnpm --filter app lint` and `pnpm --filter app build` pass after each step.
- Existing component tests (`StatusScreens.test.tsx`, `ApiKeyCard.test.tsx`,
  and the rest of the suite) still pass — the redesign must not break them.
- Existing e2e tests still pass.
- Playwright screenshots of all three pages (checkout in `created`/`paid`/
  `expired` states; treasury in dark and light) confirm the visual result.
- Manual grep gate before completion: no occurrence of "Stripe", "SOC2",
  "TRM SCREENED", "verified merchant", "Trusted by", or the fake company names
  (Lumen, Northbound, Vela Studio / vela/studio, Cobalt, Meridian, Hexa)
  anywhere in `app/` or `components/`.
- The honest trust line's test count matches the actual `pnpm test` passing
  count at implementation time.
