# UI Redesign Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `arcora-pay` redesign canvas onto the three public surfaces (landing, checkout, treasury), add a dark/light toggle to the merchant area, and strip every piece of fabricated content from the mockups.

**Architecture:** A re-skin, not a rewrite. All data flows, APIs, contracts, and component logic are unchanged — only presentation. Direction A (light, editorial) is the base for landing and checkout; Direction B (dense, dark-capable) is the base for the treasury dashboard. `next-themes` provides a toggle scoped to the merchant area; landing and checkout stay light-only and are provably immune to a stored dark preference.

**Tech Stack:** Next.js App Router, Tailwind CSS v4 (`@theme`), shadcn, `next-themes`, Vitest, Playwright. Source-of-truth mockups: `~/Downloads/arcora-pay/{a,b}/*.html`.

---

## Reference material

The redesign mockups live at `~/Downloads/arcora-pay/`. To view them rendered,
serve the folder and open in a browser:

```bash
cd ~/Downloads/arcora-pay && python3 -m http.server 8765 --bind 127.0.0.1
# then open http://127.0.0.1:8765/a/landing.html  etc.
```

Artboards: `a/landing.html`, `a/checkout.html`, `a/dashboard.html` (Direction A,
light); `b/landing.html`, `b/checkout.html`, `b/dashboard.html` (Direction B,
dark). The design spec is `docs/superpowers/specs/2026-05-18-ui-redesign-integration-design.md`
— read it before starting.

## Forbidden content (applies to every task)

These strings/concepts must never appear in shipped `app/` or `components/` code.
Task 1 builds an automated gate for them; every task must keep it green:

- "Stripe" (any comparison)
- "Trusted by" + the fake logo wall
- Fake company names: Lumen / Lumen Apparel, Northbound, Vela Studio / vela/studio,
  Cobalt / Cobalt Coffee, Meridian, Hexa
- Fake metrics: "App Kit Swap fill 99.97%", fake settled-invoice ticker rows
- Fake compliance badges: "SOC2", "TRM SCREENED", "verified merchant"
- B's "Public order book of every settlement" global feed

## Theme strategy (decided — implement exactly this)

`next-themes` applies the `.dark` class to `<html>`. The dark palette in
`globals.css` overrides **only the design-system tokens** (`--ink`, `--ink-2`,
`--ink-3`, `--line`, `--line-strong`, `--bg-elev`, `--bg-elev-2`, `--accent`,
`--accent-soft`) — never the `--color-arcora-*` tokens and never
`--color-background`. Landing and checkout are authored entirely with
`arcora-*` utilities and use no `dark:` variants, so a global `.dark` class
cannot change them. The merchant area uses the design-system tokens (directly
or via the `.glass/.eyebrow/.plate/.tag/.mono/.hairline` helper classes) plus
`dark:` Tailwind variants, and sets its own surface background — so it is the
only subtree that responds to the toggle.

---

## Task 1: Theme infrastructure + fabricated-content gate

**Files:**
- Create: `packages/app/components/ThemeProvider.tsx`
- Create: `packages/app/components/ui/ThemeToggle.tsx`
- Create: `packages/app/test/no-fabricated-content.test.ts`
- Modify: `packages/app/app/layout.tsx`
- Modify: `packages/app/app/globals.css`
- Modify: `packages/app/package.json` (via install)

- [ ] **Step 1: Install next-themes**

Run: `pnpm --filter app add next-themes`
Expected: `next-themes` appears in `packages/app/package.json` dependencies.

- [ ] **Step 2: Write the fabricated-content gate test**

Create `packages/app/test/no-fabricated-content.test.ts`. It walks `app/` and
`components/` with `node:fs` (no shell, no child process) and asserts no source
file contains a forbidden string:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN: Array<[label: string, re: RegExp]> = [
  ["Stripe comparison", /\bStripe\b/i],
  ["Trusted-by wall", /trusted by/i],
  ["fake SOC2 badge", /\bSOC2\b/i],
  ["fake TRM badge", /TRM\s*SCREENED/i],
  ["fake verified-merchant badge", /verified merchant/i],
  ["fake company Lumen", /\bLumen\b/i],
  ["fake company Northbound", /\bNorthbound\b/i],
  ["fake company Vela Studio", /vela[\s/]*studio/i],
  ["fake company Cobalt", /\bCobalt\b/i],
  ["fake company Meridian", /\bMeridian\b/i],
  ["fake company Hexa", /\bHexa\b/i],
  ["fake fill metric", /fill\s*99\.97/i],
];

const SELF = "no-fabricated-content.test.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith(SELF)) out.push(p);
  }
  return out;
}

const files = ["app", "components"].flatMap((r) => walk(join(process.cwd(), r)));

describe("no fabricated content in shipped UI", () => {
  for (const file of files) {
    it(`${file.split("/packages/app/")[1] ?? file} is clean`, () => {
      const text = readFileSync(file, "utf8");
      for (const [label, re] of FORBIDDEN) {
        expect(re.test(text), `${file} contains ${label}`).toBe(false);
      }
    });
  }
});
```

- [ ] **Step 3: Run the gate — expect it to surface current Stripe usage**

Run: `pnpm --filter app exec vitest run test/no-fabricated-content.test.ts`
Expected: FAIL — `app/page.tsx` currently contains "Stripe-like" twice. This
confirms the gate works. It is fixed in Task 2; the gate stays red until then.

- [ ] **Step 4: Add the dark palette to globals.css**

In `packages/app/app/globals.css`, after the existing `:root { ... }`
design-system block (the one ending with `--danger: #dc2626;` and its closing
`}`), add:

```css
/* Dark palette — applies only when next-themes sets .dark on <html>.
   Overrides design-system tokens ONLY. The --color-arcora-* tokens and
   --color-background are deliberately left untouched so landing and checkout
   (authored with arcora-* utilities, no dark: variants) stay light. */
.dark {
  --ink:         #f4f4f4;
  --ink-2:       #a8a8a8;
  --ink-3:       #6f6f6f;
  --line:        #1f1f1f;
  --line-strong: #2a2a2a;
  --bg-elev:     #0a0a0a;
  --bg-elev-2:   #0e0e0e;
  --accent:      #4589ff;
  --accent-ink:  #ffffff;
  --accent-soft: rgba(69, 137, 255, 0.14);
  --warn:        #f1c21b;
  --danger:      #fa4d56;
}
```

- [ ] **Step 5: Create the ThemeProvider**

Create `packages/app/components/ThemeProvider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="arcora-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
```

- [ ] **Step 6: Wire the provider into the root layout**

In `packages/app/app/layout.tsx`: add `suppressHydrationWarning` to the `<html>`
tag, import `ThemeProvider`, and wrap the existing `<ChainProviders>` subtree.
Result:

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ChainProviders } from "@/lib/chain/wagmi-config";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const interDisplay = Inter({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["400", "500", "600", "700"] });
const jetMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Arcora",
  description: "Stablecoin checkout and FX settlement on Arc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${interDisplay.variable} ${jetMono.variable}`}>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <ChainProviders>{children}</ChainProviders>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Create the ThemeToggle**

Create `packages/app/components/ui/ThemeToggle.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Avoid a hydration mismatch — render a fixed-size placeholder until mounted.
  if (!mounted) return <span className="inline-block h-8 w-8" aria-hidden />;

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--bg-elev)] transition-colors"
    >
      {isDark ? "☀" : "☾"}
    </button>
  );
}
```

- [ ] **Step 8: Verify build + lint**

Run: `pnpm --filter app lint && pnpm --filter app build`
Expected: both pass. The toggle is not yet mounted anywhere — that happens in
Task 5 — so no visual change yet.

- [ ] **Step 9: Commit**

The fabricated-content gate (Step 3) is still red because of `app/page.tsx`.
Commit the infrastructure now; the gate goes green in Task 2.

```bash
git add packages/app/components/ThemeProvider.tsx \
        packages/app/components/ui/ThemeToggle.tsx \
        packages/app/test/no-fabricated-content.test.ts \
        packages/app/app/layout.tsx \
        packages/app/app/globals.css \
        packages/app/package.json ../../pnpm-lock.yaml
git commit -m "feat(app): theme infrastructure + fabricated-content gate

Adds next-themes provider, dark palette, theme toggle, and a vitest gate
that fails on Stripe/SOC2/fake-company strings. Gate is intentionally red
until landing copy is cleaned in the next task."
```

---

## Task 2: Landing page restyle (`app/page.tsx`)

**Files:**
- Modify: `packages/app/app/page.tsx`
- Modify: `packages/app/components/landing/LiveSettlement.tsx`
- Modify: `packages/app/components/landing/DashboardPreview.tsx`
- Modify: `packages/app/components/landing/SDKBlock.tsx`
- Modify: `packages/app/components/landing/CrosschainRouteDiagram.tsx`
- Modify: `packages/app/components/landing/SiteFooter.tsx`

**Base mockup:** `a/landing.html` (light, editorial). Port its visual
treatment — spacing scale, type scale, eyebrow labels, hairline dividers,
card styling — onto the existing section structure. **Do not** add the
"Trusted by" logo wall and **do not** add a fake ticker.

- [ ] **Step 1: Remove all Stripe copy**

In `packages/app/app/page.tsx`, the v3.0 endgame currently reads
"The Stripe-like UX endgame." (the `v3.0` entry in `ROADMAP_ITEMS`, its `body`)
and "The Stripe-like UX, on stablecoin rails." (the v3.0 section JSX). Rewrite
both without naming Stripe:

- `v3.0` roadmap `body`: `"User signs a single intent; an Arcora solver executes the full route. The one-signature endgame."`
- v3.0 section closing line: `"One signature, full route — checkout-grade UX on stablecoin rails."`

- [ ] **Step 2: Run the fabricated-content gate — expect green**

Run: `pnpm --filter app exec vitest run test/no-fabricated-content.test.ts`
Expected: PASS — no remaining forbidden strings.

- [ ] **Step 3: Get the real test count for the trust line**

Run: `pnpm --filter app exec vitest run 2>&1 | tail -5` and read the passing
total. Run `pnpm --filter contracts test 2>&1 | tail -5` and read its passing
total. The combined number is `<N>` for Step 4. If the two cannot be summed
cleanly, use the app count alone and label it "app tests passing".

- [ ] **Step 4: Restyle the landing sections**

Port the Direction A visual language onto `app/page.tsx`. Keep every existing
section and all honest copy/disclaimers: hero, `LiveSettlement` + its
"No fictional volumes" caption, pillars, "How it works" 3 steps,
`DashboardPreview` + its "Illustrative · sample shapes" caption, `SDKBlock`,
roadmap timeline, v2.0 crosschain diagram, v1.x token registry, v3.0 endgame,
CTA, `SiteFooter`. Apply `a/landing.html`'s spacing, type scale, eyebrow
labels, and card/hairline styling. Use only `arcora-*` utilities and the
helper classes — no `dark:` variants. Restyle the five landing components in
the same pass so they match.

Honest trust line — replaces the mockup's fake logo wall. Under the hero, add
one line: `"<N> tests passing · audited · open-source"` using the real `<N>`
from Step 3, with links to the GitHub repo
(`https://github.com/Kubudak90/arc-fx-gateway`) and the live merchant demo
(`https://arc-fx-demo.vercel.app`).

- [ ] **Step 5: Visual check**

Start the dev server (`pnpm --filter app dev`), then with the Playwright MCP
navigate to `http://localhost:3000` and take a full-page screenshot.
Expected: editorial light landing, no logo wall, no ticker, trust line shows
the real test count, all sections present.

- [ ] **Step 6: Verify lint + build + gate**

Run: `pnpm --filter app lint && pnpm --filter app build && pnpm --filter app exec vitest run test/no-fabricated-content.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/app/app/page.tsx packages/app/components/landing/
git commit -m "feat(app): editorial redesign of landing, Stripe copy removed

Ports Direction A visual language onto the landing page. Replaces the
mockup's fabricated 'Trusted by' logo wall with a verifiable trust line
(real test count, audit, open-source). Fabricated-content gate now green."
```

---

## Task 3: Checkout page restyle (`app/i/[invoiceId]`)

**Files:**
- Modify: `packages/app/app/i/[invoiceId]/page.tsx`
- Modify: `packages/app/app/i/[invoiceId]/CheckoutClient.tsx`
- Modify: `packages/app/components/checkout/InvoiceCard.tsx`
- Modify: `packages/app/components/checkout/QuoteDisplay.tsx`
- Modify: `packages/app/components/checkout/PayButton.tsx`
- Modify: `packages/app/components/checkout/StatusScreens.tsx`

**Base mockup:** `a/checkout.html` (light, two-column). Left column = invoice /
order summary; right column = live FX quote + signing panel.

- [ ] **Step 1: Rebuild the checkout shell as two columns**

In `packages/app/app/i/[invoiceId]/page.tsx`, replace the current narrow
single-column `<main className="min-h-screen grid place-items-center px-6 py-10">`
+ `max-w-md` wrapper with a two-column layout: a centered `max-w-5xl` container,
`grid md:grid-cols-2` with a gap, left = `InvoiceCard` (order/invoice summary),
right = `CheckoutClient` (quote + sign). Columns stack on mobile. The
server-side data fetch and the props passed to both components are
**unchanged** — only the wrapping markup changes.

- [ ] **Step 2: Restyle InvoiceCard, QuoteDisplay, PayButton, StatusScreens**

Port `a/checkout.html`'s panel styling onto the four checkout components. Keep
all logic. Show only real invoice data: amount, pay-in token, payout token,
expiry, invoice id, merchant address. Render a line-items block **only if**
`invoices.metadata` carries them — otherwise omit that block entirely. Do NOT
add "SOC2", "TRM SCREENED", or "verified merchant" badges. Borrow the mockup's
compact monospace "what you're signing" panel (EIP-712 /
PermitWitnessTransferFrom) and feed it the real `invoiceId`.

- [ ] **Step 3: Verify existing checkout tests still pass**

Run: `pnpm --filter app exec vitest run components/checkout/StatusScreens.test.tsx`
Expected: PASS — the redesign must not change `StatusScreens` behavior.

- [ ] **Step 4: Visual check of all checkout states**

With the dev server running, use a known invoice id (or a seeded/test invoice).
Screenshot the checkout in `created`, `paid`, and `expired` states with the
Playwright MCP.
Expected: two-column light layout, no fake badges, no fake line items, real
data only.

- [ ] **Step 5: Verify lint + build + gate**

Run: `pnpm --filter app lint && pnpm --filter app build && pnpm --filter app exec vitest run test/no-fabricated-content.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/app/i/ packages/app/components/checkout/
git commit -m "feat(app): two-column checkout redesign

Ports Direction A two-column layout. Drops the mockup's fake compliance
badges and fake line items — checkout renders real invoice data only."
```

---

## Task 4: Treasury dashboard restyle (`app/m/treasury`)

**Files:**
- Modify: `packages/app/app/m/treasury/page.tsx`

**Base mockup:** `b/dashboard.html` (Direction B density). Must be legible in
both light and dark — the toggle is wired in Task 5.

- [ ] **Step 1: Make the page use theme-aware tokens**

In `packages/app/app/m/treasury/page.tsx`, replace hardcoded `arcora-*` surface
utilities (`bg-white`, `bg-arcora-gray`, `text-arcora-slate`,
`border-arcora-border`, etc.) with the design-system tokens so the page follows
the `.dark` class: `var(--bg-elev)` / `var(--bg-elev-2)` for surfaces,
`var(--ink)` / `var(--ink-2)` / `var(--ink-3)` for text, `var(--line)` for
borders — directly or via the `.glass/.eyebrow/.plate/.tag/.mono/.hairline`
helper classes. Text content and data flow stay identical. The amber error
panel and emerald/sky/violet status colors need dark-legible values too — keep
the hue, raise lightness for dark via `dark:` variants.

- [ ] **Step 2: Make the DailyChart SVG colors theme-aware**

In the `DailyChart` component inside the same file, the SVG hardcodes
`#00c2a8`, `rgba(11,20,38,0.06)`, `#5b6478`, `#fff`, and `#0284c7`. Read the
theme via `useTheme()` from `next-themes` (the file is already `"use client"`)
and branch each color: the area/line accent stays teal in both modes; the
zero-baseline stroke becomes `rgba(255,255,255,0.08)` in dark; the empty-state
text fill uses `var(--ink-3)`; the tooltip background uses `var(--bg-elev-2)`
with `var(--ink)` text instead of the hardcoded slate/white.

- [ ] **Step 3: Apply Direction B density to the layout**

Port `b/dashboard.html`'s dense, monospace-forward treatment: tighter KPI
cards, the "Recent activity" list restyled as a B-style live feed. Do NOT add
a global cross-merchant feed — the page shows only the signed-in merchant's own
data, exactly as today. Keep `TokenSection`, `Kpi`, `ActivityItem`,
`ClaimAllButton` logic intact.

- [ ] **Step 4: Verify lint + build**

Run: `pnpm --filter app lint && pnpm --filter app build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/app/m/treasury/page.tsx
git commit -m "feat(app): dense theme-aware treasury dashboard

Ports Direction B data density; treasury surfaces and the DailyChart SVG
now follow the .dark class. No cross-merchant data — own merchant only."
```

---

## Task 5: Wire the theme toggle into the merchant area

**Files:**
- Modify: `packages/app/app/m/layout.tsx`
- Modify: `packages/app/components/merchant/MerchantSidebar.tsx`

- [ ] **Step 1: Make the merchant layout theme-aware**

In `packages/app/app/m/layout.tsx`, the outer container has `bg-[#fafafb]` and
the mobile bar has `bg-white` / `border-arcora-border`. Replace these with
theme-aware tokens: outer container `bg-[var(--bg-elev)]`, mobile bar
`bg-[var(--bg-elev-2)]` with `border-[var(--line)]`. Add `<ThemeToggle />`
(import from `@/components/ui/ThemeToggle`) to the mobile top bar next to the
address / sign-out controls.

- [ ] **Step 2: Mount the toggle in the sidebar**

In `packages/app/components/merchant/MerchantSidebar.tsx`, add `<ThemeToggle />`
near the account / sign-out area so it is reachable on every merchant page.
Restyle the sidebar surfaces with theme-aware tokens so the sidebar itself
follows the toggle.

- [ ] **Step 3: Visual check — toggle behavior**

With the dev server running and a signed-in merchant session, navigate to
`/m/treasury`. Screenshot in light, click the toggle, screenshot in dark. Then
navigate to `/` (landing) and `/i/<invoiceId>` (checkout) **with the dark
preference still stored** and screenshot both.
Expected: treasury flips dark/light; landing and checkout remain light
regardless of the stored preference (proves the Task 1 scoping works).

- [ ] **Step 4: Verify the full suite + gate**

Run: `pnpm --filter app lint && pnpm --filter app build && pnpm --filter app exec vitest run`
Expected: all pass — existing component/e2e tests unaffected, fabricated-content
gate green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/app/m/layout.tsx packages/app/components/merchant/MerchantSidebar.tsx
git commit -m "feat(app): merchant-area dark/light toggle

Mounts ThemeToggle in the merchant sidebar and mobile bar; merchant
surfaces follow the .dark class. Landing and checkout stay light-only."
```

---

## Final verification

- [ ] `pnpm --filter app lint` — clean
- [ ] `pnpm --filter app build` — succeeds
- [ ] `pnpm --filter app exec vitest run` — all tests pass, including
  `test/no-fabricated-content.test.ts`
- [ ] `pnpm --filter app exec playwright test` (if e2e present) — passes
- [ ] Manual grep: `git grep -nEi 'stripe|soc2|trm screened|verified merchant|trusted by|lumen|northbound|vela|cobalt|meridian|hexa' -- packages/app/app packages/app/components`
  returns nothing (the gate covers this, but confirm by hand once)
- [ ] Playwright screenshots: landing (light), checkout (created/paid/expired,
  light), treasury (light + dark) — all match the intended redesign
- [ ] The landing trust line shows the real current test count
