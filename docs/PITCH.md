---
marp: true
theme: default
paginate: true
size: 16:9
backgroundColor: "#ffffff"
color: "#0b1426"
style: |
  section {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 80px 96px;
    font-size: 28px;
    line-height: 1.5;
  }
  h1 { color: #0b1426; font-size: 64px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 16px; }
  h2 { color: #0b1426; font-size: 40px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 24px; }
  h3 { color: #2563ff; font-size: 24px; font-weight: 600; }
  strong { color: #2563ff; }
  em { color: #00c2a8; font-style: normal; font-weight: 600; }
  blockquote { border-left: 4px solid #00c2a8; padding-left: 24px; color: #5b6478; font-style: italic; }
  code { background: #e6ecf2; color: #0b1426; padding: 2px 8px; border-radius: 4px; font-size: 22px; }
  pre { background: #0b1426; color: #e6ecf2; padding: 20px 24px; border-radius: 12px; font-size: 18px; line-height: 1.6; }
  pre code { background: transparent; color: #e6ecf2; padding: 0; }
  table { font-size: 22px; border-collapse: collapse; }
  th { background: #e6ecf2; padding: 10px 16px; text-align: left; font-weight: 600; }
  td { padding: 10px 16px; border-bottom: 1px solid rgba(11, 20, 38, 0.08); }
  ul, ol { padding-left: 28px; }
  li { margin-bottom: 8px; }
  section.cover { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; }
  section.cover h1 { font-size: 96px; }
  section.cover h2 { font-size: 32px; color: #5b6478; font-weight: 400; margin-top: 8px; }
  footer, header { color: #5b6478; font-size: 16px; }
  .pill { display: inline-block; background: #2563ff; color: white; padding: 4px 14px; border-radius: 999px; font-size: 16px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
  .pill-teal { background: #00c2a8; }
  .pill-gray { background: #e6ecf2; color: #0b1426; }
header: "Arcora · Stablecoin Checkout & Settlement"
footer: "arcora · 2026"
---

<!-- _class: cover -->

<span class="pill pill-teal">Stablecoin checkout</span>

# Arcora

## The customer pays with one signature. The merchant settles in the stablecoin they want, deterministically. On Arc.

<br>

`v1.2.0` · live on Arc testnet · `arcorapay.xyz`

---

## The problem

Stablecoins moved **~$5T in 2025**. The holder-to-holder UX is fine. The merchant UX is not:

- The customer's chain is not the merchant's chain.
- The customer's token is not the merchant's token.
- Bridges, DEXes, approval clicks — each one is a place the customer abandons.
- The fallback is a custodial off-ramp that takes *days* and *1–2%*.

> "I have USDC on Arbitrum. The merchant wants EURC on Arc. Five clicks and twenty minutes later I'm not sure if my money got there."

---

## What Arcora is

**A Stripe-shaped checkout for stablecoin payments.**

The merchant invoices in their preferred stable. The customer signs once — a Permit2 EIP-712 message, no transaction, no native gas. Arcora's relayer pulls the funds, runs the swap on Circle's App Kit, and deposits the merchant's stable into a 7-day custody escrow that the merchant claims permissionlessly.

> Customer pays from where they are, with whatever they have.
> Merchant receives the stable they want, on Arc.

<br>

**No token. No custody. No FX gymnastics for the merchant.**

---

## Live, right now

<div style="font-size: 24px;">

**Hosted checkout + dashboard:** [`arcorapay.xyz`](https://arcorapay.xyz)

**Docs:** [`docs.arcorapay.xyz`](https://docs.arcorapay.xyz)

**npm:** `npm install @arcora/sdk @arcora/sdk-react`

**Gateway (V11, Arc testnet):**
[`0x07BAC123…aE3a3`](https://testnet.arcscan.app/address/0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3)

</div>

```bash
npm install @arcora/sdk
```

---

## How it works — three touch points

| | | |
|:---:|:---|:---|
| **01** | **Merchant creates an invoice** | One API call (or one click in `/m/dashboard`) |
| **02** | **Customer signs once at the checkout** | Permit2 EIP-712 — no transaction, no gas |
| **03** | **Relayer settles atomically** | Permit2 pull → App Kit Swap → `settleInvoice` → custody escrow |

```ts
import { Arcora } from "@arcora/sdk";

const arcora = new Arcora({ apiKey, environment: "testnet" });
const inv = await arcora.createInvoice({
  amountUsdc: 49.99,
  payInToken: "EURC",
  successUrl: "https://yoursite.com/orders/done",
});
arcora.openCheckout(inv);
```

---

## What ships in v1.2

- **Permit2-based settlement** — customer signs *once*, no on-chain approve, no gas
- **Custody-escrow gateway (V11)** — funds sit in the contract, not the merchant wallet, until the 7-day refund window closes
- **Atomic FX via Circle App Kit Swap** — RFQ-priced USDC ⇄ EURC on Arc's maker network
- **Same-token fast path** — no swap when payIn = payout
- **Refund within window** — merchant or refund-delegate returns the customer's exact `amountOut`
- **Admin recovery** — abandoned-merchant escrows sweepable after 14d (refund + recovery windows)
- **Compliance gate** — config-flip Elliptic / TRM Labs hooks (Noop on testnet today)
- **HMAC-signed webhooks** — `invoice.paid` / `refunded` / `failed` / `claimed` with SSRF re-validation
- **Two npm packages + WooCommerce plugin** — Shopify next
- **Audited surface (v1.2)** — per-IP rate limits, constant-time CRON auth, Permit2 verification unit-covered, accessible checkout countdown

---

## Architecture

```
Customer wallet ─(Permit2 EIP-712)──→ Arcora app  ──→ relayer queue
                                          (Vercel)        │
                                                          ▼
                                     ┌──── Relayer (VPS, Vault-backed key) ────┐
                                     │  pulls Permit2  →  App Kit Swap → settle│
                                     └──────────────────────┬──────────────────┘
                                                            ▼
                                            ArcFXGatewayV11 (Arc testnet)
                                              │
                                              ├─ escrow[globalId]  (7d refund window)
                                              ├─ protocolFeesAccrued
                                              └─ emit InvoicePaid + SettlementContext

Indexer (VPS)  ──→ reconciles chain → Neon Postgres
Webhooks (VPS) ──→ HMAC-sign + deliver to merchant endpoints
```

One repo. One team. One deploy graph. The contract is intentionally small — invoice lifecycle + escrow + fee accumulator.

---

## Arcora sits *above* Arc primitives

Arc itself ships first-party financial rails. Arcora is the **merchant abstraction layer** on top — the shape Stripe Checkout has on top of card networks.

| Concern | Arc primitive | Arcora |
|---|---|---|
| FX swap on Arc | App Kit Swap | — |
| Crosschain USDC bridge | App Kit Bridge | — |
| Server-side wallets | Circle DCW | — |
| Compliance adapters | App Kit hooks | — |
| Invoice lifecycle + custody escrow | — | **ArcFXGatewayV11** |
| Hosted checkout + Permit2 flow | — | `/i/[invoiceId]` |
| Merchant dashboard + treasury | — | `/m/*` |
| Refund / claim primitives | — | **`refundInvoice` · `claim`** |
| TypeScript SDK + React + WordPress | — | `@arcora/sdk` family |

We delegate to Arc primitives where they exist. v2.0 ships as an **App Kit Bridge** integration, not a re-implementation of CCTP.

---

## Where we are

<div style="font-size: 24px;">

| Surface | State |
|---|---|
| Contracts (Foundry) | **77 tests passing** — including a 256-run fuzz on protocol-fee invariant |
| App vitest suite | unit + route handlers for the full /api/* surface |
| SDK + React + WordPress plugin | published, in-tree, integrated |
| Live deployment | `arcorapay.xyz` aliased to Vercel, `arcora-shop.vercel.app` dogfooding the checkout |
| Custody-escrow contract | V11 live on Arc testnet (`0x07BAC123…aE3a3`) |
| Relayer + indexer + webhooks | running on a single host, Vault-isolated key |

</div>

Pre-revenue. Testnet. No volume claims — Arc itself is testnet, and so are we.

---

## Why Arc, why now

**Arc** is Circle's stablecoin-native L1, purpose-built for payment rails:

- **USDC as the gas token** — no native ETH friction for the merchant or the relayer
- **CCTP V2** for crosschain USDC, native to Arc
- **App Kit Swap + Bridge** as supported primitives, not third-party DEXes
- **Stablecoin-first economy** by design

**Now** because:

- Stablecoin payment volume crossed $50B/month in 2025
- Circle Gateway + CCTP V2 unlocked native unified balances across chains
- Arc testnet is open and stable; mainnet is on the horizon
- Which stablecoin checkout becomes the default on Arc is still up for grabs

---

## The roadmap that defines the moat

| | | |
|:---:|:---|:---|
| **v1.0** <span class="pill pill-teal">live</span> | Arc-only USDC / EURC | shipped 2026-04 |
| **v1.1** <span class="pill pill-teal">live</span> | Custody escrow, compliance hooks, Vault-isolated relayer key | shipped 2026-05 |
| **v1.2** <span class="pill pill-teal">live</span> | Production hardening — rate limits, Permit2 verification tests, SSRF guard, a11y | shipped 2026-05 |
| **v1.x** | Multi-stable (USDT, PYUSD, DAI, USDe) on Arc | in flight, mainnet-bound |
| **v2.0** | Crosschain USDC via Arc App Kit Bridge (Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, Linea, Codex) | spec'd |
| **v2.1** | Source-side aggregator — any token on the source chain (native ETH, any ERC-20) | following |
| **v2.2** | Solana / Sui / non-EVM | following |
| **v3.0** | One-signature intent solver — full Stripe-like UX | endgame |

**v2.0** — crosschain via App Kit Bridge — is the differentiator. Each row builds on the previous one *without* a rewrite.

---

## What stands between us and mainnet

1. **Arc Network mainnet launch** (out of our control — we follow)
2. **External audit** (Spearbit / Cantina / Sherlock RFP — trigger: first paying merchant or funding round)
3. **Multisig admin migration** (single EOA today → 2-of-3 or 3-of-5)
4. **KYB go-live** (`ManualKybProvider` + `PersonaProvider` adapters scaffolded)
5. **Vault hardening** (TLS listener, dedicated Unix user, HSM-isolated signer)
6. **Real Chainlink price feeds**
7. **Bug bounty** (Immunefi engagement with first paying merchant)

Each row is scoped. Items 5–6 are reversible single-host changes. Items 1–4 and 7 need external coordination.

---

## Ask

<div style="font-size: 28px;">

**For builders / partners:**
Try the demo, integrate the SDK, file issues.
[`npm install @arcora/sdk`](https://www.npmjs.com/package/@arcora/sdk) — it works today.
GitHub: [`Kubudak90/arc-fx-gateway`](https://github.com/Kubudak90/arc-fx-gateway)

**For investors / Arc ecosystem:**
v1 ships on testnet today. v2 (crosschain) is the wedge.
Looking for: ecosystem support on Arc mainnet, pre-seed for KYB + audit + branding, distribution partners.

**For everyone:**
The customer-side problem — *right token, wrong chain* — is real. Arcora's bet is one checkout, not five steps.

</div>

---

<!-- _class: cover -->

<span class="pill pill-teal">Demo · Q&A</span>

# Pay anywhere. Settle on Arc.

## `arcorapay.xyz` · `@arcora/sdk` · `arc-fx-gateway` (GitHub)

<br>

Hüseyin · 2026
