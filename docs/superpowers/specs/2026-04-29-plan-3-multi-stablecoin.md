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

## Rollout sequence

### v1.x #5a — USDT first (highest demand)

1. **Verify App Kit pair coverage**: confirm `kit.swap(USDC, USDT)` and `kit.swap(USDT, USDC)` both quote on Arc. If a maker isn't quoting one direction, hold off on listing.
2. **Find / mint testnet USDT on Arc**: prefer Circle's testnet USDT if they publish one; else mint a `MintableERC20` we control for app testing.
3. **Whitelist on gateway**: owner calls `setTokenSupport(usdtAddress, true)`.
4. **Relayer**: extend `tokenSymbol(addr)` and the symbol union (`"USDC" | "EURC" | "USDT"`). Audit any other USDC/EURC-only branches.
5. **App config**: add USDT to `lib/chain/tokens.ts` (address, decimals — likely 6, App Kit pair flags).
6. **Dashboard**: `CreateInvoiceDialog` payout-token picker re-reads the `supportedTokens` set instead of hardcoding USDC/EURC.
7. **Checkout**: payIn picker likewise. Hosted checkout's Permit2 helper is token-agnostic; sanity-check decimal handling.
8. **SDK**: export an updated `SupportedToken` enum + a runtime helper that fetches the on-chain whitelist (so SDK consumers don't go stale every time we list a new stable).
9. **Live smoke**: USDC → USDT pay (regression: USDC → USDC, USDC → EURC still work).

### v1.x #5b — PYUSD

PayPal-blessed, low political risk. Same playbook as USDT. Verify App Kit coverage first.

### v1.x #5c — DAI / USDS

Decentralized stable rails. DAI has 18 decimals — verify the app's `Number(formatUnits())` paths handle that cleanly (USDC/EURC are both 6, so this is the first non-6 we ship). Treasury aggregations, Permit2 amount conversion, checkout TTL display all need a regression sweep.

### v1.x #5d — Regional fiat-pegged (TRYC, BRLC, MXNC)

Big unlock for emerging-market merchants. Gating factor: App Kit support. If Circle hasn't onboarded a regional stable's makers, this is a Circle conversation, not an Arcora one. Document the dependency and revisit per-token.

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

## Open questions

1. **App Kit USDT availability on Arc testnet**: confirm with Circle / Arc team before starting v1.x #5a. If only mainnet has USDT makers, this becomes a mainnet-only unlock and we focus pre-mainnet effort elsewhere.
2. **Should the SDK fetch the whitelist at runtime or codegen it at publish time?** Runtime fetch = no SDK release needed per listing, but adds a network round-trip on first SDK use. Codegen = friction per listing, but offline-compatible. Lean **runtime** with a typed hard-coded fallback for the same-day-as-listing case.
3. **Decimals beyond 6**: DAI (18) is the first; do we add `mxnt`/regional stables that may use 2 or 4? Pin a regression matrix once the first 18-dec stable lands.
4. **Token symbol collisions**: what if Circle issues a "USDT" on Arc that has a different address than we whitelisted? Our `tokenSymbol()` helper is address→symbol — collision-safe as long as we stay address-keyed everywhere.

---

## Decision log (settled 2026-05-02 rewrite)

- ✅ Drop in-house pool/registry from the canonical path. Use `ArcFXGatewayV8.supportedTokens` + App Kit Swap.
- ✅ One token-list API serves dashboard + checkout + SDK.
- ✅ Per-stable rollout = whitelist tx + relayer map + UI verify + smoke. No contract changes per stable.
- ✅ Order: USDT → PYUSD → DAI/USDS → regional. Regional gated on App Kit maker availability.
- ❌ Multi-hop / DEX-aggregator on Arc — App Kit handles internally; not our problem at this layer.
- ❌ External LP onboarding — not our liquidity to underwrite at v1.

---

## When picking this up

1. Re-read `roadmap_open_items.md` and the v0.8.1 brief — confirm the gateway address, supported set, and that no new architectural shift has happened since 2026-05-02.
2. Sanity-check App Kit Swap coverage for the next stable in line (`kit.quote` both directions on the testnet RPC).
3. Land the `/api/tokens` route + picker rewire before the first new whitelist tx — that's the high-leverage piece.
4. Then whitelist USDT, extend the relayer, ship the smoke, and the rest of the list becomes ~30 min per stable.
