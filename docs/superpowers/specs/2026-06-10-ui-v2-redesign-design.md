# UI v2 Redesign + New Logo — Design Spec

**Date:** 2026-06-10
**Status:** Approved by user (scope, theme, wordmark, approach all confirmed)
**Scope owner:** `packages/app` (Next.js 15 + Tailwind v4 + shadcn)

## Context

A complete visual redesign was produced as a standalone React prototype at
`~/Desktop/arcorapay/arcorapay-ui2/` (outside this repo):

- `Arcorapay.html` — landing page (components: `top.jsx`, `brand.jsx`, `flow.jsx`,
  `checkout.jsx`, `lower.jsx`, `app.jsx`)
- `Merchant.html` — merchant dashboard (`m-app.jsx`, `m-shell.jsx`, `m-views1.jsx`,
  `m-views2.jsx`: Overview, Invoices, Treasury, Compliance, Settings, login)
- `assets/tokens.css` — full design-token foundation (light + dark themes)
- `assets/arcora.css` — component recipes (cards, pills, merchant shell, marquee, coins)
- `screenshots/` — reference captures of every view in both themes

An updated logo lives at `~/Desktop/arcorapay/arcora-logo/` (`arcora-logo.svg` +
`arcora-logo-1200x360.svg`). The SVG file was already copied to
`public/brand/arcora-logo.svg`, **but `components/brand/Logo.tsx` still renders the
old inline symbol** (gradient dot + white arc variant), so the app shows the outdated
logo everywhere.

## Goals

1. Apply the new design language to **every surface** of `packages/app` — landing,
   merchant panel, hosted checkout, and auxiliary pages (docs, quickstart, roadmap).
   No surface may remain on the old look ("eksik bir şey varsa onu da yeni UI'ye
   uyarla" — explicit user instruction).
2. Replace the rendered logo with the new symbol and adopt the two-tone
   **"Arcorapay"** wordmark (Arcora in foreground color + "pay" accented).
3. Ship **both dark and light themes**, dark as default.
4. Zero behavior change: APIs, routes, data flow, auth, wagmi/react-query untouched.

## Non-goals

- `packages/shop` and `packages/demo-merchant` are out of scope for this spec
  (separate follow-up if desired).
- No copy/content rewrite beyond what the prototype dictates.
- No component-library swap; shadcn stays.

## Design decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Scope | Everything at once: tokens + logo + landing + merchant + checkout |
| Hosted checkout (`/i`, `/checkout-demo`) | Included, full redesign |
| Themes | Dark **and** light, dark default, toggle preserved |
| Wordmark | "Arcorapay" two-tone, everywhere; metadata/title updated |
| Approach | **Hybrid**: tokens into Tailwind `@theme` (single source), shadcn semantic remap, selected CSS recipes ported from `arcora.css` |

## Architecture

### 1. Design-system layer (`app/globals.css`)

- Port the core palette from `tokens.css` into Tailwind v4 `@theme`:
  chartreuse ramp (`--color-chartreuse-100…700`, primary accent `#C8F24A`),
  green-tinted neutral ramp (`--color-green-50…990`), functional hues
  (success/info/warning/danger + soft variants).
- Define semantic tokens for **both themes** keyed off `[data-theme]`, mirroring
  the prototype's taxonomy (surface, ink, line, accent, glass…).
- Remap the shadcn semantic block (`--color-background`, `--color-foreground`,
  `--color-primary`, `--color-accent`, `--color-border`, `--color-ring`,
  `--color-muted`, destructive…) onto the new palette so every existing shadcn
  component adopts the new look automatically.
- Port selected component recipes from `arcora.css` under `@layer components`:
  `.card` / `.card--glass`, `.pill` family, `.eyebrow`, `.dot--live`, `.grid-tex`,
  `.marquee`, `.coin` badges, `.m-shell` merchant chrome, `.reveal` motion.
  Everything else is expressed with Tailwind utilities.
- Old brand tokens (`--color-arcora-blue`, `-teal`, `-slate`, …) survive **only**
  for the logo gradients; all UI accent usage moves to the new semantics. A grep
  sweep migrates remaining consumers.

### 2. Theme mechanism

- `next-themes` switches from class strategy to `attribute="data-theme"`,
  `defaultTheme="dark"` (matches the prototype's `<html data-theme="dark">`).
- Tailwind dark variant is redefined in one place:
  `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`
  so all existing `dark:` utilities keep working unchanged.
- Theme toggle in the merchant shell (and wherever else it exists) is preserved.

### 3. Typography

- `next/font/google`: **Hanken Grotesk** → `--font-sans` and `--font-display`;
  **IBM Plex Mono** → `--font-mono`. Replaces Inter / JetBrains Mono in
  `app/layout.tsx`. No CDN `@import` (self-hosted via next/font, no FOUC).

### 4. Brand / logo

- Rewrite `ArcoraSymbol` in `components/brand/Logo.tsx` with the new SVG paths
  (canonical: `public/brand/arcora-logo.svg`, viewBox `48 43 321 306` normalized).
  Keep `useId()`-scoped gradient ids.
- New two-tone wordmark per prototype `brand.jsx`: "Arcora" in foreground +
  "pay" in muted/accent tone. `ArcoraLogo` API (size/showWordmark/showTagline)
  preserved so call sites need minimal changes.
- Update favicon `app/icon.svg` to the new symbol.
- Metadata: `title: "Arcorapay"`, description aligned with prototype tagline.
- Add `public/brand/arcora-logo-1200x360.svg` (wide lockup for OG/social).

### 5. Merchant panel (`/m/*`)

- `MerchantSidebar` rebuilt to the prototype `m-shell`: dark-green chrome, org
  card, nav items with icons, testnet notice, theme toggle, sign-out, mobile bar
  + scrim behavior.
- Views restyled per `m-views1/2.jsx` reference: KPI stat cards (mono numerals),
  area chart treatment, status banner with CTA, quick-actions card.
- **Functional components keep their logic** (InvoiceTable, ApiKeyCard,
  CreateInvoiceDialog, WebhookSettingsCard, RefundButton, …) — only markup/classes
  change.
- `/m/login` restyled per `m-login` screenshot.

### 6. Landing (`/`)

- Rebuild section structure per prototype: nav + hero (+ marquee), settlement
  replay ("Real flow. Real math. Arc testnet."), checkout showcase, pillars,
  SDK block, footer.
- Existing functional landing components (LiveSettlement, CrosschainRouteDiagram,
  DashboardPreview, SDKBlock, SiteFooter) are retained and restyled, not rewritten.

### 7. Hosted checkout + auxiliary surfaces

- `/i/*` (hosted invoice/checkout) and `/checkout-demo` adopt the new theme;
  prototype `checkout.jsx` is the visual reference.
- `/docs`, `/quickstart`, `/roadmap`, error page: inherit new tokens/typography
  automatically; each gets a manual pass to fix page-specific styling so nothing
  is left half-themed.

## Data flow / behavior

None changed. This is strictly a presentation-layer effort. Any diff touching
`lib/` (other than `lib/ui` style helpers), `app/api`, or db code is out of scope.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| class→data-theme switch breaks `dark:` styles | Single `@custom-variant` redefinition; grep for `.dark` selectors in CSS and any `resolvedTheme === "dark"` logic |
| Old brand tokens linger in odd corners | Repo-wide grep for `arcora-blue/teal/slate/...` after remap; migrate or whitelist (logo only) |
| Logo gradient id collisions | Already solved via `useId()`; keep pattern |
| E2E selectors break with new markup | Run Playwright after each phase; fix selectors alongside markup changes |
| Light theme under-tested (prototype is dark-first) | Screenshot pass in **both** themes for every surface |

## Testing & acceptance

1. `pnpm --filter @arcora/app typecheck && lint && test` green.
2. Playwright e2e suite green.
3. Playwright screenshots of: landing, merchant (all 5 views + login), hosted
   checkout, docs/quickstart/roadmap — in dark **and** light — visually compared
   against `arcorapay-ui2/screenshots/`.
4. Logo rendered by the app matches `public/brand/arcora-logo.svg` exactly;
   favicon updated; wordmark reads "Arcorapay" on all surfaces.
5. No old palette (blue `#2563ff` accent UI, slate buttons) visible anywhere
   outside the logo itself.

## Implementation order

1. Design-system layer: tokens → `@theme`, semantic remap, theme mechanism, fonts
2. Brand: `Logo.tsx`, favicon, metadata, wordmark
3. Merchant shell + views + login
4. Landing
5. Hosted checkout + checkout-demo
6. Auxiliary pages sweep (docs, quickstart, roadmap, error)
7. Test pass + dual-theme screenshot verification
