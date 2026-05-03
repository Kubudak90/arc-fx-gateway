# Plan 3 — Multi-stablecoin expansion (v0.8.1 era)

**Status:** rewritten 2026-05-02 to match shipped v0.8.1 reality. Original 2026-04-29 spec (StablePool + StablecoinRegistry singleton) is preserved in git history at commit before this rewrite — it was implemented as v0.7 then sidelined when v0.8 pivoted to App Kit Swap.
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Original Date:** 2026-04-29
**Rewrite Date:** 2026-05-02
**Depends on:** v0.8.1 (`ArcFXGatewayV8` + `ops/relayer` + Circle App Kit Swap)

---

## What changed since the original spec

The original Plan 3 designed an in-house `StablePool` (Saddle/Curve-style stableswap) plus `StablecoinRegistry` so the gateway could route any-pair swaps internally. That work shipped as **v0.7** (commits `6a688a2` token-agnostic gateway, `e66cbf4` test migration, `c54c5ca` per-token PriceGuard). It worked, but was an in-house liquidity surface we'd have to seed and oracle ourselves for every new stable.

Plan 6 (StableFX integration, 2026-05-01) replaced that path with **Circle's App Kit Swap** — Arc-native RFQ maker network already running on Arc with deep liquidity for USDC/EURC/USDT/USDe/DAI/PYUSD. v0.8 (`ArcFXGatewayV8`) dropped the registry dependency; the relayer now drives `kit.swap` off-chain and calls `settleInvoice` to deliver the merchant payout. The pool/registry contracts still exist in the tree but are no longer wired into the canonical flow.

**Result:** "Add a new stable" is no longer a contract-deploy + AMM-seed task. It's a whitelist call + a few config edits.

---

## Why we still need this plan

Today's canonical gateway (`ArcFXGatewayV8` at `0x6fAaD9…507a8`) only whitelists USDC and EURC (`supportedTokens` mapping). The relayer's `tokenSymbol(addr)` helper hardcodes those two as well. The killer-feature positioning ("merchant settles in their preferred stablecoin on Arc") still needs the supported set to actually be plural.

This is the v1.x #5 roadmap item. With v0.8.1 it's a 1-day job, not a 2-day refactor.

---

## Architecture — what's actually involved

```
┌──────────────────────────────────────────────────────────────────┐
│  ArcFXGatewayV8 (already deployed)                                │
│  ─ supportedTokens[token] → bool         (owner-managed)          │
│  ─ setTokenSupport(token, active) onlyRole(DEFAULT_ADMIN_ROLE)    │
│  ─ Used as a 2-sided whitelist:                                   │
│      • registerMerchant(payoutAddress, payoutToken)               │
│        → require supportedTokens[payoutToken]                     │
│      • createInvoice(...) for the advisory payIn token            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  ops/relayer/run.ts                                               │
│  ─ Permit2.permitTransferFrom (payer → relayer wallet)            │
│  ─ kit.swap (payIn → payoutToken) via @circle-fin/app-kit         │
│  ─ ERC20.approve(gateway, gross)                                  │
│  ─ gateway.settleInvoice (delivers amountOut − fee to merchant)   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  App Kit Swap (Arc-native, run by Circle)                         │
│  ─ RFQ maker network                                              │
│  ─ Pre-supports USDC, EURC, USDT, USDe, DAI, PYUSD on Arc         │
│  ─ Liquidity & oracle: Circle's problem, not ours                 │
└──────────────────────────────────────────────────────────────────┘
```

**Per added stable**, we touch four surfaces — none of them contract refactors:

| Surface | Change |
|---|---|
| Gateway | One owner tx: `setTokenSupport(token, true)` |
| Relayer | Extend `tokenSymbol(addr)` map + symbol type union |
| App config | Add address + decimals to `lib/chain/tokens.ts` |
| SDK | Re-export the supported-token enum so merchants see it |

App Kit Swap pair-availability is the real precondition, not anything we deploy.

---

## Out of scope (deferred or dropped)

| Item | Why |
|---|---|
| `StablePool` + `StablecoinRegistry` re-activation | App Kit Swap replaced the need; in-house pools become a liquidity-bootstrapping liability for every new stable. |
| Per-token Chainlink feed wiring | The v0.7 oracle path is unused in v0.8.1 — App Kit is the price source. Keepalive timer becomes mainnet cleanup work (separate ticket). |
| Multi-hop routing | App Kit handles routing internally on its own maker network. |
| LP token / external LP onboarding | Not our liquidity to underwrite. |
| Migration script v0.7 → v0.8 | Already done; merchants re-registered against `ArcFXGatewayV8`. |

---

## Canonical token set (2026-05-03 — verified against Arc docs via arc-network MCP)

**App Kit Swap aliases** (the set Circle ships first-class support for):
USDC · EURC · USDT · USDe · DAI · PYUSD · NATIVE

**Arc-native stablecoins** with canonical contract addresses:
| Symbol | Address | Decimals | Notes |
|---|---|---|---|
| USDC | `0x3600000000000000000000000000000000000000` | 6 (ERC-20 iface) / 18 (native) | gas token; always read via the ERC-20 `decimals()` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | already live in v0.8.1 |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` | 6 | institutional yield-bearing; allowlist-gated, $100k min |

**Critical testnet limitation**: `Among testnets, only Arc Testnet supports Swap (USDC and EURC only).` Any new stable beyond USDC/EURC can only be exercised end-to-end on **mainnet**. Testnet deploy of e.g. USDT will go through whitelist + UI listing fine, but `kit.swap` will revert until Circle stands up testnet liquidity.

**Regional stables (TRYC/BRLC/MXNC) — not on Arc.** The previous plan listed these as v1.x #5d; they're not Circle-issued and don't appear in Arc docs. Drop until either Circle issues them or we decide to bridge external regional stables (out of scope for v1).

## Rollout sequence

### v1.x #5a — USDT first (highest demand) — mainnet-only

1. **Confirm App Kit USDT alias coverage on Arc mainnet**: `kit.quote({ tokenIn: "USDT", tokenOut: "USDC" })` and reverse — both directions should return rates with reasonable size.
2. **Mainnet readiness check**: this is the first stable that *cannot* be smoke-tested on Arc Testnet. Either gate v1.x #5a behind the mainnet deploy milestone, or accept that "smoke testing" for USDT means staging-on-mainnet with low-value invoices.
3. **Whitelist on gateway**: owner calls `setTokenSupport(usdtAddress, true)` on `ArcFXGatewayV8`.
4. **Relayer**: extend `tokenSymbol(addr)` map + symbol union (`"USDC" | "EURC" | "USDT"`). Audit other USDC/EURC-only branches.
5. **App config**: add USDT to `lib/chain/tokens.ts` (address, decimals 6, kit alias `"USDT"`).
6. **Dashboard / Checkout**: pickers read from `/api/tokens` (registry-driven, not enum).
7. **SDK**: export updated `SupportedToken` enum + runtime fetch helper.
8. **Live smoke (mainnet)**: USDC → USDT pay; USDT → USDC pay; refund flow; treasury display.

### v1.x #5b — PYUSD — mainnet-only

PayPal-issued, low political risk. Same playbook as USDT. App Kit alias `"PYUSD"`.

### v1.x #5c — DAI — mainnet-only, 18-decimal regression target

Decentralized rails. **DAI has 18 decimals** — first non-6-decimal stable we'd ship. Before whitelisting, run a vitest matrix against the app's amount math:
- Permit2 typed-data construction
- Treasury aggregations (`merchantPayout`, `protocolFee` numerics)
- Checkout TTL/quote display
- Refund branch `recordPayerRefund`

### v1.x #5d — USDe — mainnet-only, yield-bearing

Ethena's synthetic dollar. App Kit alias `"USDe"`. Yield accrual happens at the issuer level, not in our gateway — for our purposes USDe behaves like a regular ERC-20 stable. Decimals: 18 (same regression matrix as DAI).

### v1.x #5e — USYC track (separate, not part of #5a-d)

USYC is institutional-only (allowlist + $100k minimum). It's not interchangeable with retail stables in the dashboard picker. **Defer** to a future "institutional" merchant tier; the v1.x #5 track is about the App Kit Swap retail set.

---

## Database / indexer impact

`invoices.payInToken` and `payoutToken` are `text` (any address) — already token-agnostic. The dual-gateway indexer (`ops/indexer/run.ts`) handles `InvoicePaid`/`PayerRefunded` from `ArcFXGatewayV8` regardless of which stables are involved. **No schema change.**

What does change in the app:

- `/api/tokens` route: returns the on-chain `supportedTokens` set with metadata for UI use. Implement once; subsequent listings are zero-app-deploy.
- `CreateInvoiceDialog` payout picker: reads `/api/tokens`.
- `CheckoutClient` payIn picker: reads `/api/tokens` filtered by App Kit pair availability for the invoice's payout token.

---

## Testing plan

### Foundry
The v0.7 tests covering pool/registry math are no longer relevant to the canonical path. v0.8 contract tests already exercise `setTokenSupport`, the supported-token guard in `registerMerchant`, and the `settleInvoice` flow. No new Solidity tests needed for v1.x #5 — the contract is already token-agnostic.

### App
- `/api/tokens` route test (vitest): returns the on-chain whitelist, caches sensibly, refreshes on whitelist mutation.
- Picker components: snapshot test that they render whatever the API returns (no hardcoded enum).
- Decimals regression: a vitest spec that runs the Permit2/amount math against a 6-decimal and 18-decimal token side by side.

### Live smoke per added stable
1. Same-token pay (regression).
2. New-stable → USDC swap pay.
3. USDC → New-stable swap pay.
4. Refund on a new-stable invoice (uses `recordPayerRefund` path, decimal-sensitive).

---

## Effort

| Phase | Time |
|---|---|
| `/api/tokens` + UI picker rewire | 2 h |
| Relayer `tokenSymbol` extension + symbol-union audit | 1 h |
| SDK `SupportedToken` enum + runtime fetch helper | 2 h |
| USDT smoke (testnet whitelist + first end-to-end) | 1 h |
| Decimals regression sweep (for the eventual 18-decimal stable) | 2 h |
| **Per added stable after USDT** (whitelist tx + UI verify + smoke) | **~30 min** |
| **Total to ship USDT (v1.x #5a)** | **~1 day** |

The first stable does the legwork (token-list API, picker rewire, relayer audit). Each subsequent addition is a config + smoke pass.

---

## Resolved (2026-05-03 — verified against Arc docs)

1. **App Kit USDT testnet availability**: NOT supported. Only Arc Testnet supports Swap and only for USDC/EURC. Any stable beyond those is mainnet-only, period. v1.x #5a–d are gated on mainnet readiness.
2. **Decimals beyond 6**: DAI and USDe are 18. The 18-decimal regression matrix is a one-time lift in #5c; #5d inherits it.
3. **Regional stables (TRYC/BRLC/MXNC)**: dropped — not on Arc, not in App Kit's alias list.
4. **USYC**: separate institutional track, not part of #5.

## Open questions

1. **SDK whitelist source**: runtime fetch (`/api/tokens`) vs codegen-at-publish? **Lean runtime**, with a typed hard-coded fallback for same-day-as-listing UX.
2. **Token symbol collisions**: address-keyed everywhere keeps us collision-safe. Confirm `tokenSymbol(addr)` in the relayer is the only symbol→address lookup; if any caller reverses that, audit it before adding the third stable.

---

## Decision log (settled 2026-05-02 rewrite)

- ✅ Drop in-house pool/registry from the canonical path. Use `ArcFXGatewayV8.supportedTokens` + App Kit Swap.
- ✅ One token-list API serves dashboard + checkout + SDK.
- ✅ Per-stable rollout = whitelist tx + relayer map + UI verify + smoke. No contract changes per stable.
- ✅ Order: USDT → PYUSD → DAI → USDe. **All four mainnet-only** (App Kit Swap testnet limited to USDC/EURC).
- ❌ Regional stables (TRYC/BRLC/MXNC) — not on Arc, not in App Kit alias list.
- ❌ USYC — separate institutional track, not retail.
- ❌ Multi-hop / DEX-aggregator on Arc — App Kit handles internally; not our problem at this layer.
- ❌ External LP onboarding — not our liquidity to underwrite at v1.

---

## When picking this up

1. Re-read `roadmap_open_items.md` and the v0.8.1 brief — confirm the gateway address, supported set, and that no new architectural shift has happened since 2026-05-02.
2. Sanity-check App Kit Swap coverage for the next stable in line (`kit.quote` both directions on the testnet RPC).
3. Land the `/api/tokens` route + picker rewire before the first new whitelist tx — that's the high-leverage piece.
4. Then whitelist USDT, extend the relayer, ship the smoke, and the rest of the list becomes ~30 min per stable.
