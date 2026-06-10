# UI v2 Redesign + New Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Arcorapay UI v2 design language (chartreuse accent, green-tinted neutrals, Hanken Grotesk/IBM Plex Mono, dark-default dual themes) and the new logo to every surface of `packages/app`, with zero behavior change.

**Architecture:** Hybrid approach — design tokens move into Tailwind v4 `@theme` (single source), shadcn semantics are remapped so existing components adopt the palette automatically, and selected component recipes are ported from the prototype CSS. Pages are then restyled per-surface against the prototype reference.

**Tech Stack:** Next.js 15 (App Router), Tailwind CSS v4, shadcn, next-themes, next/font, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-10-ui-v2-redesign-design.md`
**Branch:** `feat/ui-v2-redesign` (already created)
**Working dir for all commands:** repo root `arcorapay/`; app package is `packages/app`.

---

## Design reference (read-only, outside the repo)

The approved design prototype lives at `/Users/huseyinarslan/Desktop/arcorapay/arcorapay-ui2/`:

| File | What it is |
|---|---|
| `assets/tokens.css` | Token foundation — palettes, type scale, both theme blocks |
| `assets/arcora.css` | Component recipes — pills, cards, merchant shell, motion |
| `components/brand.jsx` | Wordmark ("Arcora" + sage "pay"), icon set, Coin, CountUp |
| `components/top.jsx` | Landing: nav + hero + marquee |
| `components/flow.jsx` | Landing: settlement replay section |
| `components/checkout.jsx` | Landing: checkout showcase / hosted-checkout visual |
| `components/lower.jsx` | Landing: pillars, SDK block, footer |
| `components/m-shell.jsx` | Merchant: sidebar, PageHead, StatusBadge, Modal, CopyField |
| `components/m-views1.jsx`, `m-views2.jsx` | Merchant: Overview/Invoices/Treasury/Compliance/Settings views |
| `screenshots/*.png` | Reference renders (e.g. `01-m.png` merchant overview dark, `light.png` settlement replay light, `m-login.png` login) |

The new logo (canonical files): `/Users/huseyinarslan/Desktop/arcorapay/arcora-logo/arcora-logo.svg` (square symbol — already copied to `packages/app/public/brand/arcora-logo.svg`) and `arcora-logo-1200x360.svg` (wide lockup with white arc).

**Key fact discovered during design:** the prototype's own `brand.jsx` still draws the OLD symbol (with gradient dot). The canonical NEW symbol is `arcora-logo.svg` — 3 paths, no dot. Always port from the SVG file, not from `brand.jsx`'s symbol.

## Shared restyle mapping (used by Tasks 5–9)

Old → new class/token mapping. Apply wherever old names appear:

| Old (current app) | New (UI v2) |
|---|---|
| `var(--ink)` / `var(--ink-2)` / `var(--ink-3)` | `var(--fg-1)` / `var(--fg-2)` / `var(--fg-3)` |
| `var(--line)` / `var(--line-strong)` | `var(--border)` / `var(--border-strong)` |
| `var(--bg-elev)` | `var(--surface-2)` |
| `var(--bg-elev-2)` | `var(--surface)` |
| `var(--accent-soft)` | `var(--acc-soft)` |
| `var(--accent-ink)` | `var(--fg-on-accent)` |
| `var(--warn)` | `var(--warning)` |
| class `.glass` | class `.card` (or `.card--glass` for floating panels) |
| class `.tag` / `.tag.muted` | class `.tagchip` / `.tagchip--mut` |
| class `.hairline` | class `.divider` |
| class `.btn-arcora-pill` | classes `.pill .pill--acc` |
| class `.btn-arcora-pill-light` | classes `.pill .pill--ghost` |
| `text-arcora-blue` etc. Tailwind utils | semantic: `text-[var(--action)]` for links, `text-[var(--acc)]`-family for accents |
| big numerals (any) | add `.mono` (IBM Plex Mono, tnum) |
| section labels | `.eyebrow` (auto-restyles) / `.eyebrow--acc` |

Transitional aliases (`--ink`, `--line`, `--bg-elev`…) are defined in Task 1 so unmigrated pages stay coherent mid-migration, then deleted in Task 9.

---

### Task 1: Token foundation — rewrite `globals.css`

**Files:**
- Modify: `packages/app/app/globals.css` (full rewrite, 159 lines → ~420)

- [ ] **Step 1: Replace the entire content of `packages/app/app/globals.css` with:**

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* ============================================================
   Arcorapay UI v2 — core palette (theme-independent)
   Ported from design prototype assets/tokens.css
   ============================================================ */
@theme {
  /* Brand greens */
  --color-ink-green: #293e40;
  --color-bright-green: #62d84e;
  --color-sage: #80b6a1;
  --color-sage-deep: #4e8c77;

  /* Chartreuse accent ramp (primary accent = 400) */
  --color-chartreuse-100: #f2fbd6;
  --color-chartreuse-200: #e4f7a8;
  --color-chartreuse-300: #d6f277;
  --color-chartreuse-400: #c8f24a;
  --color-chartreuse-500: #b4e034;
  --color-chartreuse-600: #97be20;
  --color-chartreuse-700: #6f8e14;

  /* Green-tinted neutral ramp */
  --color-green-50: #f6f8f6;
  --color-green-100: #ecf1ee;
  --color-green-150: #e2e8e4;
  --color-green-200: #d4dcd7;
  --color-green-300: #bcc7c1;
  --color-green-400: #9aa8a2;
  --color-green-500: #7c8b85;
  --color-green-600: #5e6e68;
  --color-green-700: #44524d;
  --color-green-800: #2c3835;
  --color-green-850: #1f2a27;
  --color-green-900: #14201e;
  --color-green-950: #0d1514;
  --color-green-990: #080e0d;

  /* Logo hues — ONLY for the brand mark, never for UI accents */
  --color-arcora-blue: #2563ff;
  --color-arcora-teal: #00c2a8;

  /* Radii */
  --radius: 0.75rem;
  --radius-card: 24px;
  --radius-field: 16px;
  --radius-pill: 999px;
  --radius-full: 100000px;
}

/* Fonts + shadcn semantics reference runtime-switched vars → must be inline */
@theme inline {
  --font-sans: var(--font-hanken), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: var(--font-hanken), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  /* shadcn semantic mapping — every shadcn component re-themes from here */
  --color-background: var(--bg);
  --color-foreground: var(--fg-1);
  --color-card: var(--surface);
  --color-card-foreground: var(--fg-1);
  --color-popover: var(--surface);
  --color-popover-foreground: var(--fg-1);
  --color-primary: var(--accent);
  --color-primary-foreground: var(--fg-on-accent);
  --color-secondary: var(--surface-3);
  --color-secondary-foreground: var(--fg-1);
  --color-muted: var(--surface-2);
  --color-muted-foreground: var(--fg-2);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--fg-on-accent);
  --color-border: var(--border);
  --color-input: var(--border);
  --color-ring: var(--focus-ring);
  --color-destructive: var(--danger);
  --color-destructive-foreground: #ffffff;
}

/* ============================================================
   Semantic tokens — LIGHT (default) and DARK
   Mirrors prototype tokens.css §7–8 exactly.
   ============================================================ */
:root,
[data-theme="light"] {
  color-scheme: light;

  --bg: var(--color-green-50);
  --bg-sunken: var(--color-green-100);
  --surface: #ffffff;
  --surface-2: var(--color-green-50);
  --surface-3: var(--color-green-100);

  --fg-1: #16201e;
  --fg-2: #4a5854;
  --fg-3: #7c8b85;
  --fg-on-accent: #16241a;
  --fg-on-brand: #ffffff;

  --border: var(--color-green-150);
  --border-strong: var(--color-green-200);
  --border-faint: var(--color-green-100);

  --brand: var(--color-ink-green);
  --brand-hover: #1e2f30;
  --accent: var(--color-chartreuse-400);
  --accent-hover: var(--color-chartreuse-500);
  --accent-press: var(--color-chartreuse-600);
  --action: #2c7a52;
  --action-hover: #246a46;
  --focus-ring: #62d84e;

  --success: #2fa866;  --success-bg: #dbf3e6;
  --info: #3b82c4;     --info-bg: #dbeaf7;
  --warning: #9a6b00;  --warning-bg: #fbefcc;
  --danger: #db4b4b;   --danger-bg: #f8dede;

  --elev-1: 0 1px 2px rgba(20, 40, 36, 0.06), 0 1px 1px rgba(20, 40, 36, 0.04);
  --elev-2: 0 2px 6px rgba(20, 40, 36, 0.08), 0 1px 2px rgba(20, 40, 36, 0.05);
  --elev-3: 0 8px 24px rgba(20, 40, 36, 0.1), 0 2px 6px rgba(20, 40, 36, 0.06);
  --elev-4: 0 18px 48px rgba(20, 40, 36, 0.16), 0 6px 16px rgba(20, 40, 36, 0.08);

  --glass-bg: rgba(255, 255, 255, 0.66);
  --glass-border: rgba(255, 255, 255, 0.6);
  --glass-blur: 18px;
}

[data-theme="dark"] {
  color-scheme: dark;

  --bg: var(--color-green-950);
  --bg-sunken: var(--color-green-990);
  --surface: var(--color-green-900);
  --surface-2: var(--color-green-850);
  --surface-3: var(--color-green-800);

  --fg-1: #ecf2ef;
  --fg-2: #a7b5b0;
  --fg-3: #6e7c78;
  --fg-on-accent: #16241a;
  --fg-on-brand: #ecf2ef;

  --border: var(--color-green-800);
  --border-strong: var(--color-green-700);
  --border-faint: var(--color-green-850);

  --brand: var(--color-sage);
  --brand-hover: #95c7b2;
  --accent: var(--color-chartreuse-400);
  --accent-hover: var(--color-chartreuse-300);
  --accent-press: var(--color-chartreuse-500);
  --action: #6fe05c;
  --action-hover: #87e977;
  --focus-ring: #62d84e;

  --success: #4fc084;  --success-bg: #11301f;
  --info: #6aa9e0;     --info-bg: #112538;
  --warning: #e6b53a;  --warning-bg: #322512;
  --danger: #ee7070;   --danger-bg: #381818;

  --elev-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --elev-2: 0 2px 8px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.3);
  --elev-3: 0 10px 28px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);
  --elev-4: 0 22px 56px rgba(0, 0, 0, 0.66), 0 8px 18px rgba(0, 0, 0, 0.45);

  --glass-bg: rgba(20, 32, 30, 0.6);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: 18px;
}

/* Accent knobs + motion + legacy aliases */
:root {
  --acc: var(--accent);
  --acc-soft: rgba(200, 242, 74, 0.12);
  --acc-line: rgba(200, 242, 74, 0.3);
  --acc-glow: rgba(200, 242, 74, 0.45);
  --acc-ink: #16241a;
  --sage: var(--color-sage);
  --teal: #21d4e6;
  --blue: #2563ff;

  --ease: cubic-bezier(0.2, 0, 0, 1);
  --ease-emph: cubic-bezier(0.3, 0, 0, 1);

  /* TRANSITIONAL aliases — keep unmigrated pages coherent.
     DELETE in the final sweep task once no consumers remain. */
  --ink: var(--fg-1);
  --ink-2: var(--fg-2);
  --ink-3: var(--fg-3);
  --line: var(--border);
  --line-strong: var(--border-strong);
  --bg-elev: var(--surface-2);
  --bg-elev-2: var(--surface);
  --accent-ink: var(--fg-on-accent);
  --accent-soft: var(--acc-soft);
  --warn: var(--warning);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  html {
    @apply font-sans;
    -webkit-text-size-adjust: 100%;
  }
  ::selection {
    background: var(--acc);
    color: var(--acc-ink);
  }
}

/* ============================================================
   UI v2 component recipes — ported from prototype arcora.css
   ============================================================ */

/* Ambient page background + grid texture (landing/checkout chrome) */
.page-bg {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(1100px 600px at 78% -8%, color-mix(in oklch, var(--acc) 11%, transparent), transparent 60%),
    radial-gradient(900px 700px at 8% 12%, color-mix(in oklch, var(--sage) 9%, transparent), transparent 58%),
    radial-gradient(1200px 800px at 50% 110%, color-mix(in oklch, var(--teal) 7%, transparent), transparent 60%);
  opacity: 0.9;
  transition: opacity 0.6s var(--ease);
}
[data-theme="light"] .page-bg { opacity: 0.5; }

.grid-tex {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, color-mix(in oklch, var(--fg-1) 5%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklch, var(--fg-1) 5%, transparent) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(120% 90% at 50% 0%, #000 0%, transparent 72%);
  opacity: 0.5;
}

/* Layout helpers */
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 32px; position: relative; z-index: 1; }
.section { padding: 104px 0; position: relative; z-index: 1; }
.section--tight { padding: 72px 0; }
.divider { height: 1px; background: var(--border); }

/* Type helpers */
.eyebrow {
  font-family: var(--font-mono); font-size: 11px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-3);
  display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
}
.eyebrow--acc { color: color-mix(in oklch, var(--acc) 70%, var(--fg-1)); }
.mono { font-family: var(--font-mono); font-feature-settings: "tnum" on; }
.plate { font-family: var(--font-mono); font-feature-settings: "tnum" on; letter-spacing: -0.01em; }
.disp {
  font-family: var(--font-display); font-weight: 300;
  letter-spacing: -0.03em; line-height: 1.02; text-wrap: balance;
}
.disp em { font-style: italic; font-weight: 500; color: var(--sage); }
.lead { color: var(--fg-2); line-height: 1.55; }
h2.disp { font-weight: 400; letter-spacing: -0.025em; line-height: 1.06; }

/* Pills / buttons */
.pill {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  height: 46px; padding: 0 24px; border-radius: var(--radius-pill);
  font-family: var(--font-sans); font-size: 15px; font-weight: 600;
  letter-spacing: 0.01em; cursor: pointer; border: 1px solid transparent;
  transition: transform 0.18s var(--ease), background 0.18s var(--ease),
    box-shadow 0.25s var(--ease), border-color 0.18s var(--ease), color 0.18s var(--ease);
  white-space: nowrap; text-decoration: none;
}
.pill:active { transform: translateY(1px) scale(0.99); }
.pill:disabled { opacity: 0.5; cursor: not-allowed; }
.pill svg { width: 18px; height: 18px; }
.pill--acc {
  background: var(--acc); color: var(--acc-ink);
  box-shadow: 0 0 0 0 var(--acc-glow), 0 8px 26px -10px var(--acc-glow);
}
.pill--acc:hover {
  background: var(--accent-hover);
  box-shadow: 0 0 0 4px var(--acc-soft), 0 14px 34px -10px var(--acc-glow);
  transform: translateY(-1px);
}
.pill--ghost {
  background: color-mix(in oklch, var(--fg-1) 6%, transparent);
  color: var(--fg-1); border-color: var(--border-strong);
}
.pill--ghost:hover { background: color-mix(in oklch, var(--fg-1) 11%, transparent); border-color: var(--fg-3); transform: translateY(-1px); }
.pill--sm { height: 38px; padding: 0 16px; font-size: 13px; }
.pill--lg { height: 54px; padding: 0 30px; font-size: 16px; }

/* Surfaces */
.card {
  background: color-mix(in oklch, var(--surface) 86%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  backdrop-filter: blur(10px);
}
.card--glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
}
.field {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-field);
}

.tagchip {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
  border-radius: var(--radius-pill); font-family: var(--font-mono);
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600;
  background: var(--acc-soft); color: color-mix(in oklch, var(--acc) 75%, var(--fg-1));
  border: 1px solid var(--acc-line); white-space: nowrap;
}
.tagchip--mut { background: color-mix(in oklch, var(--fg-1) 6%, transparent); color: var(--fg-3); border-color: var(--border); }
.tagchip--ok { background: var(--success-bg); color: var(--success); border-color: color-mix(in oklch, var(--success) 30%, transparent); }

.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--acc); display: inline-block; }
.dot--live { background: var(--success); box-shadow: 0 0 0 0 color-mix(in oklch, var(--success) 60%, transparent); animation: ping-soft 1.8s var(--ease) infinite; }
@keyframes ping-soft {
  0% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--success) 55%, transparent); }
  70%, 100% { box-shadow: 0 0 0 7px transparent; }
}

/* Scroll reveal */
.reveal { opacity: 0; transform: translateY(26px); transition: opacity 0.7s var(--ease), transform 0.7s var(--ease-emph); }
.reveal.in { opacity: 1; transform: none; }
.reveal.d1 { transition-delay: 0.07s; }
.reveal.d2 { transition-delay: 0.14s; }
.reveal.d3 { transition-delay: 0.21s; }
.reveal.d4 { transition-delay: 0.28s; }
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1 !important; transform: none !important; }
  html { scroll-behavior: auto; }
}

/* Token coins */
.coin {
  width: 28px; height: 28px; border-radius: 50%; display: inline-flex;
  align-items: center; justify-content: center; font-family: var(--font-mono);
  font-size: 9px; font-weight: 700; color: #fff; letter-spacing: 0.02em; flex: none;
}
.coin--usdc { background: linear-gradient(135deg, #2775ca, #2f8fe0); }
.coin--eurc { background: linear-gradient(135deg, #1a9c82, #22c2a0); }
.coin--usdt { background: linear-gradient(135deg, #1ba27a, #26c98f); }
.coin--dai { background: linear-gradient(135deg, #e0a100, #f5b820); color: #3a2b00; }
.coin--pyusd { background: linear-gradient(135deg, #3b5bff, #5b78ff); }

/* Motion */
@keyframes flow-dot {
  0% { left: 2%; opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { left: 98%; opacity: 0; }
}
@keyframes count-pop { 0% { transform: translateY(6px); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes floaty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes spin-slow { to { transform: rotate(360deg); } }
.spin { animation: spin-slow 1s linear infinite; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }

/* Nav link */
.navlink {
  font-size: 13.5px; color: var(--fg-2); text-decoration: none; position: relative;
  padding: 6px 2px; transition: color 0.18s var(--ease);
}
.navlink:hover { color: var(--fg-1); }
.navlink::after {
  content: ""; position: absolute; left: 0; right: 100%; bottom: -2px; height: 2px;
  background: var(--acc); border-radius: 2px; transition: right 0.25s var(--ease);
}
.navlink:hover::after, .navlink.active::after { right: 0; }

/* Topbar */
.topbar {
  position: sticky; top: 0; z-index: 60; height: 64px;
  background: color-mix(in oklch, var(--bg) 72%, transparent);
  backdrop-filter: blur(16px) saturate(150%);
  border-bottom: 1px solid var(--border);
}

/* Icon button */
.iconbtn {
  width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in oklch, var(--fg-1) 6%, transparent); border: 1px solid var(--border);
  color: var(--fg-2); cursor: pointer; transition: all 0.18s var(--ease);
}
.iconbtn:hover { color: var(--fg-1); border-color: var(--fg-3); }

/* Feature-card hover */
.lift { transition: transform 0.3s var(--ease), border-color 0.3s var(--ease), box-shadow 0.3s var(--ease); }
.lift:hover { transform: translateY(-4px); border-color: var(--acc-line); box-shadow: var(--elev-3); }

/* Code block */
.code-pane {
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.75;
  background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 16px;
  overflow: auto;
}
.code-pane .ln { color: color-mix(in oklch, var(--fg-3) 70%, transparent); user-select: none; }
.tok-kw { color: #c792ff; }
.tok-str { color: var(--sage); }
.tok-com { color: var(--fg-3); font-style: italic; }
.tok-fn { color: var(--teal); }
.tok-num { color: #ffb86b; }
[data-theme="light"] .tok-kw { color: #7c3aed; }
[data-theme="light"] .tok-fn { color: #0d8f9e; }

/* Segmented control */
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.seg button {
  font-family: var(--font-mono); font-size: 11px; padding: 7px 13px; background: transparent;
  color: var(--fg-3); border: none; cursor: pointer; border-right: 1px solid var(--border); transition: all 0.15s var(--ease);
}
.seg button:last-child { border-right: none; }
.seg button.on { background: var(--acc); color: var(--acc-ink); font-weight: 600; }
.seg button:not(.on):hover { color: var(--fg-1); background: color-mix(in oklch, var(--fg-1) 5%, transparent); }

/* Progress steps */
.steps-rail { display: flex; gap: 6px; }
.steps-rail i { height: 3px; flex: 1; border-radius: 3px; background: var(--border); overflow: hidden; position: relative; }
.steps-rail i.done { background: var(--acc); }
.steps-rail i.cur::after { content: ""; position: absolute; inset: 0; background: var(--acc); animation: rail-fill 1.2s var(--ease) forwards; }
@keyframes rail-fill { from { transform: translateX(-100%); } to { transform: none; } }

/* Table */
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--fg-3); text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--border); font-weight: 500; }
.tbl td { padding: 14px; border-bottom: 1px solid var(--border-faint); font-size: 13px; }
.tbl tr:last-child td { border-bottom: none; }
.tbl tbody tr { transition: background 0.15s var(--ease); }
.tbl tbody tr:hover { background: color-mix(in oklch, var(--fg-1) 4%, transparent); }

/* Marquee */
.marquee { display: flex; gap: 56px; width: max-content; animation: marq 26s linear infinite; }
@keyframes marq { to { transform: translateX(-50%); } }
.marquee:hover { animation-play-state: paused; }

/* Underline link */
.ulink { color: color-mix(in oklch, var(--acc) 72%, var(--fg-1)); text-decoration: none; border-bottom: 1px solid var(--acc-line); transition: border-color 0.2s; }
.ulink:hover { border-color: var(--acc); }

/* ════════ Merchant shell ════════ */
.m-navitem {
  display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: 10px;
  font-size: 13.5px; color: var(--fg-2); background: transparent; border: none; cursor: pointer;
  border-left: 2px solid transparent; transition: all 0.15s var(--ease); text-align: left; width: 100%;
}
.m-navitem:hover { background: color-mix(in oklch, var(--fg-1) 5%, transparent); color: var(--fg-1); }
.m-navitem.on { background: var(--acc-soft); color: color-mix(in oklch, var(--acc) 80%, var(--fg-1)); border-left-color: var(--acc); font-weight: 600; }
.m-link { background: none; border: none; cursor: pointer; color: color-mix(in oklch, var(--acc) 70%, var(--fg-1)); font-size: 13px; padding: 0; font-family: inherit; }
.m-link:hover { text-decoration: underline; }
.m-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 920px) {
  .m-kpis { grid-template-columns: repeat(2, 1fr); }
  .m-2col { grid-template-columns: 1fr !important; }
}

/* ════════ Landing responsive helpers (used by prototype-derived markup) ════════ */
@media (max-width: 1000px) {
  .hero-grid, .checkout-grid, .sdk-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
  .hero-grid > div:last-child { max-width: 460px; }
}
@media (max-width: 820px) {
  .nav-links { display: none !important; }
  .g3 { grid-template-columns: 1fr !important; }
  .settle-grid { grid-template-columns: 1fr !important; }
  .settle-mid { border-left: none !important; border-right: none !important; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .foot-grid { grid-template-columns: 1fr 1fr !important; gap: 28px !important; }
}
@media (max-width: 560px) {
  .wrap { padding: 0 20px; }
  .section { padding: 64px 0; }
  .hide-sm { display: none !important; }
  .foot-grid { grid-template-columns: 1fr !important; }
}

/* ============================================================
   LEGACY classes — restyled to v2 so unmigrated pages stay
   coherent. DELETE in the final sweep task.
   ============================================================ */
.glass { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; }
.tag {
  display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 4px;
  font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase;
  background: var(--acc-soft); color: color-mix(in oklch, var(--acc) 75%, var(--fg-1)); font-weight: 600;
}
.tag.muted { background: color-mix(in oklch, var(--fg-1) 6%, transparent); color: var(--fg-3); }
.hairline { height: 1px; background: var(--border); }
.btn-arcora-pill {
  border-radius: var(--radius-pill); background: var(--acc); color: var(--acc-ink);
  font: 600 16px/1.2 var(--font-sans); letter-spacing: 0.16px; padding: 14px 32px;
  transition: background 150ms ease; cursor: pointer;
}
.btn-arcora-pill:hover { background: var(--accent-hover); }
.btn-arcora-pill:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.btn-arcora-pill:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-arcora-pill-light {
  border-radius: var(--radius-pill); background: color-mix(in oklch, var(--fg-1) 6%, transparent);
  color: var(--fg-1); border: 1px solid var(--border-strong);
  font: 600 16px/1.2 var(--font-sans); letter-spacing: 0.16px; padding: 14px 32px;
  transition: background 150ms ease, color 150ms ease; cursor: pointer;
}
.btn-arcora-pill-light:hover { background: color-mix(in oklch, var(--fg-1) 11%, transparent); }
```

Notes on intentional differences from the prototype CSS:
- Keyframes `ping`, `spin`, `fill` renamed to `ping-soft`, `spin-slow`, `rail-fill` to avoid colliding with tw-animate-css.
- Prototype's `* { margin:0; padding:0 }` reset, `body` font block, and `.m-side`/`.m-sidewrap`/`.m-mobilebar` fixed-positioning block are NOT ported — Tailwind preflight handles resets and the app's merchant layout already has its own responsive grid (Task 5 styles it with utilities).
- Old `--color-arcora-slate/gray/deep/link/border/muted-fg/canvas` theme entries are dropped; `arcora-blue`/`arcora-teal` stay for the logo only.

- [ ] **Step 2: Verify the app builds and existing styles resolve**

Run: `pnpm --filter @arcora/app typecheck && pnpm --filter @arcora/app build`
Expected: both succeed. (Pages will look light-themed and partially restyled — fine at this stage.)

- [ ] **Step 3: Commit**

```bash
git add packages/app/app/globals.css
git commit -m "feat(app): port UI v2 design tokens and component recipes into Tailwind theme"
```

---

### Task 2: Theme mechanism — `data-theme`, dark default

**Files:**
- Modify: `packages/app/components/ThemeProvider.tsx`

- [ ] **Step 1: Switch next-themes to data-theme attribute with dark default**

Replace the `NextThemeProvider` props in `packages/app/components/ThemeProvider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="arcora-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
```

- [ ] **Step 2: Check for stray `.dark`-keyed logic**

Run: `grep -rn '"dark"\|\.dark' packages/app/components/ui/ThemeToggle.tsx packages/app/components/ui/sonner.tsx`
Expected: only `useTheme()`-based string comparisons (`theme === "dark"`), which keep working. If any CSS or class-based `.dark` keying appears, convert it to `[data-theme="dark"]`.

- [ ] **Step 3: Manual smoke test**

Run: `pnpm --filter @arcora/app dev` and open http://localhost:3000.
Expected: `<html data-theme="dark">` in devtools; page renders dark green (`#0D1514`-family) background; the merchant theme toggle at `/m/login` → after login flips light/dark.
Note: a previously stored `arcora-theme=light` localStorage value overrides the new default — that's correct behavior (user choice persists). Test the fresh-visitor default in a private window.

- [ ] **Step 4: Commit**

```bash
git add packages/app/components/ThemeProvider.tsx
git commit -m "feat(app): switch theming to data-theme attribute, dark by default"
```

---

### Task 3: Fonts — Hanken Grotesk + IBM Plex Mono

**Files:**
- Modify: `packages/app/app/layout.tsx`

- [ ] **Step 1: Replace font setup in `layout.tsx`**

Replace the imports and font constants (lines 1–10) and the `<html className>`:

```tsx
import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ChainProviders } from "@/lib/chain/wagmi-config";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});
```

and in the JSX:

```tsx
<html lang="en" suppressHydrationWarning className={`${hanken.variable} ${plexMono.variable}`}>
```

(The old `--font-sans`/`--font-display`/`--font-mono` next/font variables are gone; `@theme inline` in globals.css now derives them from `--font-hanken`/`--font-plex-mono`.)

- [ ] **Step 2: Verify**

Run: `pnpm --filter @arcora/app build`
Expected: success. Then in the dev server, body text renders in Hanken Grotesk (check computed `font-family` in devtools) and `.mono` elements in IBM Plex Mono.

- [ ] **Step 3: Commit**

```bash
git add packages/app/app/layout.tsx
git commit -m "feat(app): swap to Hanken Grotesk + IBM Plex Mono via next/font"
```

---

### Task 4: Brand — new logo symbol, Arcorapay wordmark, favicon, metadata

**Files:**
- Modify: `packages/app/components/brand/Logo.tsx`
- Create: `packages/app/components/brand/Logo.test.tsx`
- Modify: `packages/app/app/icon.svg`
- Modify: `packages/app/app/layout.tsx` (metadata only)
- Create: `packages/app/public/brand/arcora-logo-1200x360.svg` (copy)

- [ ] **Step 1: Write the failing wordmark test**

Create `packages/app/components/brand/Logo.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArcoraLogo, ArcoraSymbol } from "./Logo";

describe("ArcoraLogo", () => {
  it("renders the two-tone Arcorapay wordmark", () => {
    const { container } = render(<ArcoraLogo />);
    expect(container.textContent).toContain("Arcorapay");
  });

  it("symbol has no settlement dot (new mark = 3 paths)", () => {
    const { container } = render(<ArcoraSymbol />);
    expect(container.querySelectorAll("path").length).toBe(3);
  });
});
```

(Mirror the existing test conventions in `packages/app/components/merchant/ApiKeyCard.test.tsx` — same render/imports style; adjust imports only if that file differs.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arcora/app test -- Logo`
Expected: FAIL — wordmark text is "Arcora" (not "Arcorapay") and the old symbol has 6 paths.

- [ ] **Step 3: Rewrite `Logo.tsx` with the new symbol + wordmark**

Replace the entire file content:

```tsx
import type { SVGProps } from "react";
import { useId } from "react";

/**
 * Arcora "A" symbol — current brand mark. Matches the canonical SVG at
 * `public/brand/arcora-logo.svg` (June 2026 edit: no settlement dot).
 * Gradient ids are scoped via useId() so multiple instances don't collide.
 */
export function ArcoraSymbol({
  size = 32, title = "Arcorapay", ...rest
}: { size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "width" | "height">) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const gBlue = `${uid}-blue`;
  const gTeal = `${uid}-teal`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="48 43 321 306"
      width={size}
      height={size}
      role="img"
      aria-labelledby={titleId}
      {...rest}
    >
      <title id={titleId}>{title}</title>
      <defs>
        <linearGradient id={gBlue} x1="0.5414" y1="-0.2276" x2="1.2444" y2="0.6276">
          <stop offset="0" stopColor="#2563FF" />
          <stop offset="1" stopColor="#165DFF" />
        </linearGradient>
        <linearGradient id={gTeal} x1="0.1305" y1="0" x2="0.7023" y2="-1.1237">
          <stop offset="0" stopColor="#00C2A8" />
          <stop offset="1" stopColor="#21D4E6" />
        </linearGradient>
      </defs>
      <g transform="translate(90 54)">
        <path
          d="M119.999 7.483 C113.994 -2.494 99.983 -2.494 93.978 7.483 L1.901 191.06 C-4.104 203.032 4.903 217 17.914 217 L65.954 217 C72.96 217 78.965 213.009 81.968 207.023 L119.999 127.207 L158.031 207.023 C161.033 213.009 167.038 217 174.044 217 L224.086 217 C237.097 217 246.104 203.032 240.099 191.06 L119.999 7.483 Z"
          fill={`url(#${gBlue})`}
        />
      </g>
      <g transform="translate(172 129)">
        <path
          d="M29.263 3.75 L1.263 63.75 C-2.737 71.75 3.263 80.75 12.263 80.75 L56.263 80.75 C65.263 80.75 71.263 71.75 67.263 63.75 L39.263 3.75 C37.263 -1.25 31.263 -1.25 29.263 3.75 Z"
          fill="#ffffff"
          fillOpacity="0.98"
        />
      </g>
      <g transform="translate(59 204)">
        <path
          d="M63.147 72.276 C97.633 25.096 141.819 0 196.781 0 C231.268 0 258.21 8.031 285.153 24.092 C294.852 30.115 297.008 43.165 289.464 51.195 L262.521 81.31 C256.055 88.337 244.2 90.345 235.579 85.326 C220.491 77.295 202.17 72.276 180.616 72.276 C138.586 72.276 101.944 90.345 73.924 126.483 C67.457 134.513 54.525 136.521 45.903 130.498 L8.184 104.398 C-1.516 97.372 -2.593 84.322 4.951 75.287 C21.116 55.211 38.359 37.142 57.758 22.084 C68.535 14.054 83.623 21.08 83.623 34.13 L83.623 53.203 C83.623 60.23 79.312 67.257 73.924 72.276 L63.147 72.276 Z"
          fill={`url(#${gTeal})`}
        />
      </g>
    </svg>
  );
}

interface ArcoraLogoProps {
  size?: number;
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
}

/**
 * Full lockup: symbol + two-tone "Arcorapay" wordmark, optional tagline.
 * Use `showTagline` in hero / footer surfaces; leave it off in headers.
 */
export function ArcoraLogo({
  size = 32,
  showWordmark = true,
  showTagline = false,
  className,
}: ArcoraLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <ArcoraSymbol size={size} />
      {showWordmark && (
        <span className="inline-flex flex-col leading-none">
          <span
            className="font-[family-name:var(--font-display)] font-bold text-[var(--fg-1)]"
            style={{ fontSize: size * 0.7, letterSpacing: "-0.03em" }}
          >
            Arcora<span style={{ color: "var(--sage)" }}>pay</span>
          </span>
          {showTagline && (
            <span
              className="font-[family-name:var(--font-mono)] uppercase text-[var(--fg-3)] mt-1"
              style={{ fontSize: size * 0.22, letterSpacing: "0.18em" }}
            >
              Stablecoin checkout &amp; settlement
            </span>
          )}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @arcora/app test -- Logo`
Expected: PASS (2 tests).

- [ ] **Step 5: Update favicon and wide-lockup asset**

Replace `packages/app/app/icon.svg` content with the canonical square SVG (gradient ids are fine un-scoped in a standalone file):

```bash
cp "/Users/huseyinarslan/Desktop/arcorapay/arcora-logo/arcora-logo.svg" packages/app/app/icon.svg
cp "/Users/huseyinarslan/Desktop/arcorapay/arcora-logo/arcora-logo-1200x360.svg" packages/app/public/brand/arcora-logo-1200x360.svg
```

- [ ] **Step 6: Update metadata in `packages/app/app/layout.tsx`**

```tsx
export const metadata: Metadata = {
  title: "Arcorapay",
  description: "Stablecoin checkout & settlement on Arc",
};
```

Also grep for other hardcoded `title:` metadata across pages and align naming:
Run: `grep -rn 'title:' packages/app/app --include='*.tsx' | grep -vi arcorapay`
Update any "Arcora — …" titles to "Arcorapay — …".

- [ ] **Step 7: Verify build + visual**

Run: `pnpm --filter @arcora/app build`
Expected: success. Dev server: header/footer/sidebar logos show the new mark (no dot) with "Arcorapay" wordmark; browser tab shows the new favicon.

- [ ] **Step 8: Commit**

```bash
git add packages/app/components/brand/ packages/app/app/icon.svg packages/app/app/layout.tsx packages/app/public/brand/
git commit -m "feat(app): new Arcora symbol + two-tone Arcorapay wordmark, favicon, metadata"
```

---

### Task 5: Merchant shell — sidebar + layout chrome

**Files:**
- Modify: `packages/app/components/merchant/MerchantSidebar.tsx`
- Modify: `packages/app/app/m/layout.tsx`
- Reference: prototype `m-shell.jsx:56-100` (Sidebar), screenshot `01-m.png`

- [ ] **Step 1: Restyle `MerchantSidebar.tsx`**

Keep ALL existing logic (nav items, `usePathname` active state, `arcTestnet`-derived testnet flag, logout form, ThemeToggle). Apply these changes:

1. `<aside>` classes → `hidden md:flex flex-col w-[244px] shrink-0 px-4 py-[22px] gap-1 bg-[var(--surface-2)] border-r border-[var(--border)] min-h-screen sticky top-0 self-start`
2. Logo link: `<ArcoraLogo size={26} />` (wordmark now renders "Arcorapay").
3. Merchant block: keep structure; initials box →
   `w-8 h-8 rounded-[10px] bg-[var(--acc-soft)] border border-[var(--acc-line)] text-[color-mix(in_oklch,var(--acc)_80%,var(--fg-1))] flex items-center justify-center mono font-bold text-[12px]`
   address line → `text-[13px] font-semibold text-[var(--fg-1)]`, sub-line `mono text-[10.5px] text-[var(--fg-3)]`.
4. `<div className="hairline my-2" />` → `<div className="divider my-2 -mx-4" />`
5. Nav links: replace the conditional class string with the ported recipe classes:

```tsx
className={`m-navitem ${active ? "on" : ""}`}
```

   Keep the inline SVG icons (stroke icons already match the design's icon style; bump to `width=17 height=17 strokeWidth=1.75`).
6. Testnet card: outer div → `className="field p-3"`; the dot → `<span className="dot" />`; label `mono text-[10px] text-[var(--fg-3)] tracking-[.1em]`; body `text-[11.5px] text-[var(--fg-2)] leading-snug`.
7. Sign out button → `className="m-link inline-flex items-center gap-1.5 text-[12px]"`.

- [ ] **Step 2: Restyle `app/m/layout.tsx` chrome**

1. Root div: remove `theme-scope`; classes → `md:grid md:grid-cols-[244px_1fr] min-h-screen bg-[var(--bg)]`
2. Mobile top bar: `md:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--bg)_80%,transparent)] backdrop-blur-md sticky top-0 z-40`
3. Token swaps per the shared mapping table (`--ink-*`→`--fg-*`, `--line`→`--border`, `--accent`→`--action` for the hover-underline links).

- [ ] **Step 3: Verify against reference**

Dev server → `/m/login`, log in (dev credentials / seeded merchant from `packages/app/scripts` or e2e fixtures), compare sidebar with `arcorapay-ui2/screenshots/01-m.png`: dark-green sidebar, chartreuse active nav item with left accent bar, org card, testnet notice, both themes via toggle.

- [ ] **Step 4: Commit**

```bash
git add packages/app/components/merchant/MerchantSidebar.tsx packages/app/app/m/layout.tsx
git commit -m "feat(app): restyle merchant shell to UI v2 (sidebar, layout chrome)"
```

---

### Task 6: Merchant views — dashboard, treasury, compliance, settings, login

**Files:**
- Modify: `packages/app/app/m/dashboard/page.tsx`, `packages/app/app/m/treasury/page.tsx`, `packages/app/app/m/compliance/page.tsx`, `packages/app/app/m/settings/page.tsx`, `packages/app/app/m/login/page.tsx`
- Modify: every component in `packages/app/components/merchant/` and `packages/app/components/treasury/` (class/token swaps only)
- Reference: prototype `m-views1.jsx` (Overview, Invoices), `m-views2.jsx` (Treasury, Compliance, Settings), `m-shell.jsx:103-166` (PageHead, StatusBadge, Modal, CopyField patterns); screenshots `01-m.png` … `06-*.png`, `m-login.png`

Work page by page; after each page, view it in the dev server in both themes before moving on.

- [ ] **Step 1: Dashboard (`/m/dashboard`)**

Apply the shared mapping table to `dashboard/page.tsx` + the merchant components it renders (`MerchantActivationCard`, `InvoiceTable`, `CreateInvoiceDialog`, `InvoiceShareQRDialog`, `RefundButton`). Specific patterns from the prototype Overview (`m-views1.jsx`):
- Page header: title in `.disp` style (`text-[30px] font-medium`), eyebrow above (`.eyebrow .eyebrow--acc`), mono sub-line, bottom border `border-[var(--border)] pb-[18px] mb-[26px]`.
- KPI stats: wrap in `<div className="m-kpis">`, each cell `.card p-[18px]` with `.eyebrow` label + `.mono` value (`text-[26px]`).
- Status banner ("Merchant active · accepting payments"): `.card` with `border-[var(--acc-line)]`, leading `w-9 h-9 rounded-full bg-[var(--acc-soft)]` check icon, primary CTA `.pill .pill--acc .pill--sm`.
- Invoice table → `.tbl` classes; status badges follow the STATUS color map (`m-shell.jsx:116-124`): paid=success, created/pending=warning, expired=fg-3, refunded=info, failed=danger — implemented with the semantic vars, shape: pill `px-[9px] py-[3px] text-[11px] font-semibold` with 6px dot.
- Dialogs (shadcn) already re-themed by token remap; fix any hardcoded colors.

- [ ] **Step 2: Treasury (`/m/treasury`)**

Same mapping sweep over `treasury/page.tsx` + `components/treasury/*`. Prototype reference: treasury view in `m-views2.jsx` — per-token totals as `.card` rows with `.coin coin--eurc/usdc` badges, daily-net chart recolored to `var(--acc)` (area fill `color-mix(in oklch, var(--acc) 25%, transparent)` fading down, refund dips in `var(--danger)`), escrow counts as `.tagchip` chips. Remove the `useTheme`-conditional colors if the chart had any — semantic vars handle both themes.

- [ ] **Step 3: Compliance (`/m/compliance`)**

Mapping sweep. Screenings table → `.tbl`; risk/result chips → `.tagchip--ok` (pass), `.tagchip` (review), `.tagchip--mut` (n/a); provider names in `.mono`.

- [ ] **Step 4: Settings (`/m/settings`)**

Mapping sweep over page + `ApiKeyCard`, `WebhookSettingsCard`, `AllowedOriginsCard`, `PayoutTokenCard`, `DelegateAuthCard`, `ConnectMerchantButton`. Copy-field pattern per `m-shell.jsx:155-166`: `.field` row with `.mono` value + `.iconbtn` copy button. Run `pnpm --filter @arcora/app test` after — `ApiKeyCard.test.tsx` must stay green (adjust selectors only if they referenced classes, not behavior).

- [ ] **Step 5: Login (`/m/login`)**

Reference `m-login.png`: centered `.card` (max-w ~420px) on `var(--bg)` with `.page-bg` ambient glow behind, `ArcoraLogo` with tagline, SIWE connect button as `.pill .pill--acc` full-width. Keep all auth logic.

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @arcora/app typecheck && pnpm --filter @arcora/app test`
Expected: green. Visual check all 5 pages in both themes against screenshots.

```bash
git add packages/app/app/m packages/app/components/merchant packages/app/components/treasury
git commit -m "feat(app): restyle merchant views to UI v2"
```

---

### Task 7: Landing page

**Files:**
- Modify: `packages/app/app/page.tsx`
- Modify: `packages/app/components/landing/LiveSettlement.tsx`, `CrosschainRouteDiagram.tsx`, `DashboardPreview.tsx`, `SDKBlock.tsx`, `SiteFooter.tsx`
- Reference: prototype `top.jsx` (nav/hero/marquee), `flow.jsx` (settlement replay), `checkout.jsx` (checkout showcase), `lower.jsx` (pillars/SDK/footer); screenshots `hero.png`, `hero2.png`, `light.png`, `settle.png`, `cc2.png`, `pillars.png`, `pillars2.png`, `dex-bottom.png`

- [ ] **Step 1: Page chrome**

In `page.tsx`: add `<div className="page-bg" />` and `<div className="grid-tex" />` as the first children; switch the sticky nav to `.topbar` + `.wrap` with `.navlink` links and `.pill .pill--sm .pill--acc` CTA; `ArcoraLogo size={26}`.

- [ ] **Step 2: Hero**

Per `top.jsx` / `hero2.png`: two-column `hero-grid` (`grid grid-cols-[1.05fr_.95fr] gap-16 items-center`), left: `.eyebrow--acc` ("STABLECOIN CHECKOUT & SETTLEMENT" style label), `.disp` headline at `clamp(44px,6vw,76px)` with an `<em>` accent word, `.lead` paragraph, CTA row (`.pill .pill--lg .pill--acc` + `.pill .pill--lg .pill--ghost`), mono stat strip. Right: keep the existing live demo/preview component (`DashboardPreview` or settlement preview) inside `.card--glass p-6`. Below: logo/token `.marquee` strip inside a `.divider`-bounded band.

- [ ] **Step 3: Sections sweep**

For each remaining section of `page.tsx`, restyle in place using the shared mapping + these prototype patterns: section header = `.eyebrow--acc` + `h2.disp` (`clamp(30px,4vw,44px)`); `LiveSettlement` → 3-column `settle-grid` card per `light.png` (customer/gateway/merchant panes, `.mono` numbers, `.coin` badges, live `.dot--live` header row, `.steps-rail` progress); `CrosschainRouteDiagram` → recolor strokes/fills to `var(--acc)`/`var(--sage)`/`var(--border)`; pillars → `g3` grid of `.card .lift p-7` cards with stroke icons per `pillars.png`; `SDKBlock` → `.code-pane` with `tok-*` syntax classes per `lower.jsx`; `SiteFooter` → `foot-grid` columns, `ArcoraLogo showTagline`, `.divider` top border, `.mono` legal line per `dex-bottom.png`.

- [ ] **Step 4: Verify + commit**

Dev server: compare `/` against `hero2.png`/`pillars.png`/`dex-bottom.png` in dark, `light.png` section in light. Mobile width (390px): nav collapses (`nav-links` hidden), grids stack.

```bash
git add packages/app/app/page.tsx packages/app/components/landing
git commit -m "feat(app): restyle landing page to UI v2"
```

---

### Task 8: Hosted checkout + checkout-demo

**Files:**
- Modify: `packages/app/app/i/[invoiceId]/page.tsx`, `packages/app/app/i/[invoiceId]/CheckoutClient.tsx`
- Modify: `packages/app/components/checkout/*` (`InvoiceCard`, `QuoteDisplay`, `PayButton`, `StatusScreens`, others present)
- Modify: `packages/app/app/checkout-demo/page.tsx`
- Reference: prototype `checkout.jsx`, screenshots `cc2.png`, `02-modal2.png`, `02-modal3.png`, `modal.png`

- [ ] **Step 1: Hosted checkout (`/i/[invoiceId]`)**

Shared mapping sweep over page + `CheckoutClient` + `components/checkout/*`. Prototype patterns: centered `.card` checkout panel on `var(--bg)` with `.page-bg`; merchant header row with `ArcoraSymbol`; amount in `.mono` large (`text-[28px]`); token selector rows as `.field` items with `.coin` badges; quote breakdown rows `.mono text-[12.5px]` with `.eyebrow` labels; primary action `.pill .pill--acc` full-width; status screens (paid/expired/failed) use semantic `--success/--danger` vars + `.tagchip--ok`; progress rail `.steps-rail`. KEEP all payment logic (App Kit, wagmi, polling) untouched.

- [ ] **Step 2: `/checkout-demo`**

Same sweep; demo controls become `.seg` + `.pill--ghost` elements.

- [ ] **Step 3: Verify + commit**

Create an invoice via `/checkout-demo` (or e2e fixture flow) and walk the checkout in both themes; compare with `cc2.png`/`modal.png`.

```bash
git add packages/app/app/i packages/app/app/checkout-demo packages/app/components/checkout
git commit -m "feat(app): restyle hosted checkout + demo to UI v2"
```

---

### Task 9: Auxiliary surfaces + legacy sweep

**Files:**
- Modify: `packages/app/app/docs/**`, `packages/app/components/docs/DocsShell.tsx`, `FlowDiagram.tsx`
- Modify: `packages/app/app/quickstart/page.tsx`, `packages/app/components/quickstart/*`
- Modify: `packages/app/app/roadmap/**`, `packages/app/app/error.tsx`
- Modify: `packages/app/app/globals.css` (delete legacy block + aliases)

- [ ] **Step 1: Aux pages mapping sweep**

Apply the shared mapping table to docs/quickstart/roadmap/error surfaces. Code samples → `.code-pane`; section labels → `.eyebrow`; cards → `.card`; CTAs → `.pill` variants; `FlowDiagram`/`AddArcTestnetButton` accent colors → `var(--acc)`/`var(--action)`.

- [ ] **Step 2: Old-token elimination**

Run: `grep -rln "arcora-blue\|arcora-teal\|arcora-slate\|arcora-gray\|arcora-deep\|arcora-canvas\|arcora-link\|arcora-muted" packages/app/app packages/app/components --include='*.tsx'`
Expected after migration: empty (the logo uses literal hex inside the SVG, not utilities). Migrate any remaining hits with the mapping table.

Run: `grep -rln "btn-arcora-pill\|var(--ink\|var(--line\|var(--bg-elev\|\.glass\|hairline\|\"tag\"\|'tag'" packages/app/app packages/app/components --include='*.tsx'`
Expected: empty. Migrate stragglers.

- [ ] **Step 3: Delete the legacy compatibility layer**

In `globals.css`: delete the "LEGACY classes" block (`.glass`, `.tag`, `.hairline`, `.btn-arcora-pill`, `.btn-arcora-pill-light`) and the "TRANSITIONAL aliases" var block (`--ink` … `--warn`). Also delete `--color-arcora-blue`/`--color-arcora-teal` from `@theme` if Step 2's first grep shows no utility consumers.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @arcora/app typecheck && pnpm --filter @arcora/app build`
Expected: green; spot-check docs/quickstart/roadmap in both themes.

```bash
git add packages/app
git commit -m "feat(app): migrate aux surfaces to UI v2, remove legacy style layer"
```

---

### Task 10: Full validation — tests + dual-theme screenshot pass

**Files:** none created (verification only; selector fixes allowed in e2e specs under `packages/app/e2e/`)

- [ ] **Step 1: Static + unit**

Run: `pnpm --filter @arcora/app typecheck && pnpm --filter @arcora/app lint && pnpm --filter @arcora/app test`
Expected: all green.

- [ ] **Step 2: E2E**

Run: `pnpm --filter @arcora/app e2e`
Expected: green. If selectors broke due to markup changes, fix the selectors (behavior assertions must not change) and re-run.

- [ ] **Step 3: Dual-theme screenshot audit**

With the dev server running, capture (Playwright MCP browser or `page.screenshot` script) each surface in BOTH themes: `/`, `/m/login`, `/m/dashboard`, `/m/treasury`, `/m/compliance`, `/m/settings`, `/i/<invoice-id>`, `/checkout-demo`, `/docs`, `/quickstart`, `/roadmap`. Compare against `arcorapay-ui2/screenshots/`. Checklist per spec acceptance:
- New logo (3-path, no dot) + "Arcorapay" wordmark on every surface; new favicon.
- No blue `#2563ff` accent UI or slate buttons outside the logo.
- Light theme fully usable (no dark-on-dark text), dark is the fresh-visitor default.

- [ ] **Step 4: Fix-forward and commit**

Fix any findings, re-run the relevant checks, then:

```bash
git add -A
git commit -m "test(app): e2e selector updates + UI v2 validation fixes"
```

- [ ] **Step 5: Final review**

Run: `git log --oneline plan-1-protocol..HEAD` — confirm the task commits are present, then request code review per superpowers:requesting-code-review.
