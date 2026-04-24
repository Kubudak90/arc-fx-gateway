# Arc FX Merchant Gateway — Design Spec

**Date:** 2026-04-24
**Status:** Design approved, pending implementation plan
**Target:** Arc Network public testnet (mainnet-ready code)
**Timeline:** 4–6 weeks, solo full-stack build
**Primary goal:** Portfolio / grant submission for Circle's Arc ecosystem

---

## 1. Overview

A two-layer product on Arc Network:

1. **FX Core (Protocol)** — A standalone stablecoin swap layer: a forked Curve StableSwap `USDC/EURC` pool plus an `ArcFXGateway` smart contract that performs atomic swap-and-settle for merchant invoices, guarded by a Chainlink EUR/USD oracle.
2. **Merchant Gateway (Product)** — A Stripe-style hosted checkout (`checkout.arc-fx.xyz`) plus a thin `@arc-fx/checkout` npm SDK, giving any website one-line USDC invoicing with automatic EURC acceptance.

The design deliberately splits protocol from product: the pool and gateway contract are permissionless primitives that any third-party dApp can integrate, while the hosted checkout is our go-to-market surface. This aligns with two of Arc's three stated pillars (P2P payments + stablecoin FX) and gives Circle a clean "ecosystem expansion" story for grant review.

**Out of scope for v1:** refund flows, multi-currency pools, fiat on/off-ramps, mobile SDK, merchant KYC enforcement, mainnet deployment.

---

## 2. Goals & Non-Goals

### Goals
- **One-line merchant integration**: a merchant adds `@arc-fx/checkout`, calls `openCheckout()`, receives a success callback with `txHash`.
- **Atomic swap-and-settle**: customer pays EURC, merchant receives USDC in a single transaction.
- **No silent loss**: every failure mode either reverts cleanly (customer keeps funds) or retries safely (no double-pay).
- **Oracle-guarded but AMM-priced**: Chainlink is a deviation guard, not a pricing source — AMM integrity preserved.
- **Demo-ready on Arc testnet**: live testnet deployment, bootstrapped liquidity, Loom video with 5 scripted paths.
- **Grant-worthy security posture**: Slither + Aderyn in CI (0 high/medium), fuzz + invariant tests, SWC checklist.

### Non-Goals
- Not a production-grade AMM (single pool, bootstrapped liquidity)
- Not a refund / chargeback system (merchant-side policy, out of scope v1)
- Not a compliance platform (merchant registry exposes an optional KYC hook but does not enforce)
- Not multi-chain (Arc-only, no bridges)

---

## 3. Architecture

Four layers with clean boundaries:

| Layer      | Responsibility                                                            | Owns                                    |
|------------|---------------------------------------------------------------------------|-----------------------------------------|
| Client     | Merchant site integration; customer wallet                                | Merchant codebase + user wallet         |
| Hosted     | Checkout UI, merchant dashboard, invoice API, webhook dispatch            | `checkout.arc-fx.xyz` (Next.js)         |
| Protocol   | `ArcFXGateway` + Curve `USDC/EURC` pool                                   | Onchain (Arc)                           |
| Oracle     | Chainlink EUR/USD feed — used as deviation guard only                     | External (Chainlink)                    |

**Key design decisions:**
- Gateway is **immutable** (no upgrade proxy). V2 will deploy a new address; existing invoices remain on v1 indefinitely.
- Curve pool is **standalone**; any other dApp can integrate it directly. Gateway has no special privilege over the pool beyond being a normal user.
- Hosted Postgres is a **mirror** for speed/dashboards; onchain state is the ground truth.
- Chainlink is **guard-only**: pool quote outside ±0.5% of oracle rate → tx reverts. Pricing remains AMM-determined.

---

## 4. Components

### 4.1 `@arc-fx/checkout` (npm SDK)
**Role:** Zero-wallet-dep client library that opens the hosted checkout.

```ts
ArcFX.init({ merchantId: string, environment: 'testnet' | 'mainnet' })
ArcFX.createInvoice({ amountUsdc: number, currency: 'EUR' })  // → { invoiceId, url }
ArcFX.openCheckout(invoice, { onSuccess, onCancel })
```

- Target size: <10 KB gzipped.
- No EVM libraries bundled. Only `fetch` + `window.open`.
- Framework-agnostic; a thin React wrapper ships as `@arc-fx/checkout-react`.

### 4.2 Hosted Checkout (Next.js 15)
**Role:** Customer payment UI + merchant dashboard + invoice API + webhook dispatch.

Routes:
- `GET /i/:invoiceId` — customer checkout page (wallet connect → approve → pay → success)
- `GET /m/dashboard` — merchant panel (API keys, invoice history, webhook config)
- `POST /api/invoices` — create invoice (authenticated via merchant API key)
- `GET /api/quote?from=EURC&to=USDC&amountOut=49.99` — live pool quote (read-only, no signer)

Stack: Next.js 15 App Router, Tailwind, wagmi + viem for contract calls, thirdweb Connect for wallet, Postgres (invoice mirror + merchants + api_keys), Redis (webhook retry queue), Cloudflare WAF.

### 4.3 `ArcFXGateway.sol` (Foundry, Solidity 0.8.26)
**Role:** Merchant registry + invoice state + atomic swap-and-settle + protocol fee collection.

```solidity
function registerMerchant(address payoutToken) external;
function createInvoice(bytes32 id, uint256 amountOut, IERC20 payIn, uint64 expiresAt) external;
function pay(bytes32 id, uint256 maxAmountIn) external nonReentrant;
function withdrawFees(address to) external onlyOwner;
```

Constructor is immutable: pool address, oracle address, fee (10 bps). Emits `MerchantRegistered`, `InvoiceCreated`, `InvoicePaid`. Holds no permanent state for customers — invoice state machine is created/paid/expired only.

### 4.4 Curve StableSwap Pool (forked, N=2)
**Role:** `USDC ⇄ EURC` liquidity. Standard StableSwap invariant.

- `A = 200` (standard for stablecoin pairs)
- `LP fee = 4 bps`, admin fee = 50% of LP fee → protocol treasury
- Initial liquidity: ~$100k test-USDC + ~92k test-EURC (bootstrap from Arc testnet faucet + our own LP)
- Deployed as a direct fork of Curve's public contracts (BSD 3-clause); no code changes beyond constructor parameters and Solidity version bump.

### 4.5 `PriceGuard` (Solidity library)
**Role:** Chainlink-backed deviation check used inside `Gateway.pay()`.

```solidity
function check(uint256 poolRate, AggregatorV3Interface feed, uint256 maxDeviationBps) internal view;
```

- Reads `latestRoundData()`, reverts on `StaleOracle` if `updatedAt < block.timestamp - 1 hours`.
- Reverts on `OracleDeviation(poolRate, oracleRate)` if deviation > `maxDeviationBps` (50 = 0.5%).

---

## 5. Data Flow — Happy Path

1. **Merchant**: `ArcFX.createInvoice({ amountUsdc: 49.99, currency: 'EUR' })` → hosted API mints invoice, returns `{ invoiceId, url }`.
2. **Customer**: `ArcFX.openCheckout(invoice)` redirects/popups to `/i/:invoiceId`.
3. **Checkout UI**: wallet connect via thirdweb → reads Curve quote via `get_dy(EURC→USDC)` → renders "Pay 46.02 EURC".
4. **Customer**: approves EURC to Gateway address.
5. **Customer**: calls `Gateway.pay(invoiceId, maxAmountIn=46.25)` (slippage cushion applied).
6. **Inside `pay()` (atomic):**
   a. `PriceGuard` reads Chainlink EUR/USD.
   b. `EURC.transferFrom(customer, gateway, 46.02)`.
   c. `pool.exchange(EURC→USDC, 46.02, minOut=49.97)`.
   d. `PriceGuard.check(poolRate, oracleRate, 50)` — revert on deviation.
   e. Fee = `49.99 × 0.001 = 0.05 USDC` routed to protocol treasury.
   f. `USDC.transfer(merchant, 49.94)` + `emit InvoicePaid(...)`.
7. **Hosted**: indexer watches `InvoicePaid` → updates Postgres → dispatches signed webhook to merchant → SDK fires `onSuccess({ txHash, amountOut })`.

**State locations:**
- Onchain (ground truth): merchant registry, invoice state machine, event log.
- Offchain (mirror/index): Postgres invoice projection, merchant API keys, webhook retry queue (Redis).

---

## 6. Error Handling & Failure Modes

### 6.1 Smart contract layer (on-chain revert)

| Failure              | Trigger                                       | Error                                  | User sees                              |
|----------------------|-----------------------------------------------|----------------------------------------|----------------------------------------|
| Slippage exceeded    | Pool state shifted between quote and pay      | `SlippageExceeded()`                   | Auto-refresh quote, retry              |
| Oracle deviation     | Pool > ±0.5% of Chainlink                     | `OracleDeviation(pool, oracle)`        | "Market disrupted, retry in a moment"  |
| Stale oracle         | Feed not updated >1h                          | `StaleOracle(updatedAt)`               | "FX data unavailable" + support        |
| Invoice expired      | 30-minute default TTL                         | `InvoiceExpired(id)`                   | Regenerate from merchant               |
| Replay               | Second `pay()` on settled invoice             | `InvoiceAlreadyPaid(id)`               | Success page (idempotent)              |
| Insufficient allowance | Approve skipped or short                    | ERC-20 standard revert                 | UI pre-check + "Approve EURC first"    |
| Reentrancy           | Malicious token callback                      | `ReentrancyGuard: reentrant call`      | — (defense-in-depth)                   |

### 6.2 Infrastructure (off-chain, graceful degrade)

- **Postgres down** → UI reads state from chain directly with a degrade banner; writes queued.
- **RPC rate limit** → Round-robin between Alchemy, Arc public RPC, thirdweb.
- **Webhook delivery fail** → Redis retry queue, exponential backoff, 24-hour ceiling.
- **Indexer lag** → UI polls event log directly as fallback.
- **Merchant API key leak** → Rotate endpoint + audit log.
- **Hosted DDoS** → Cloudflare WAF + per-IP rate limits.

### 6.3 UX recovery patterns

- **Retry-safe**: quote expires every 30s; single-click re-sign with fresh quote.
- **Idempotent**: post-error, UI re-reads invoice state from chain — already-paid invoices show success, unpaid retry.
- **Terminal**: expired invoices route back to merchant; insufficient EURC shows on-ramp CTA.

**Guarantee:** no failure mode loses customer funds. Approve-then-revert leaves EURC in customer wallet. Pay-succeed-webhook-fail leaves on-chain settlement intact; retry queue handles merchant callback.

---

## 7. Testing Strategy

Testing pyramid (base → tip):

| Level       | Tool                                 | Target                                                   |
|-------------|--------------------------------------|----------------------------------------------------------|
| Unit        | Foundry + Vitest                     | >95% line, >90% branch coverage                          |
| Fuzz        | Foundry `forge fuzz`                 | 10k runs/property: fee math, slippage, deviation         |
| Invariant   | Foundry `forge invariant`            | 5 invariants: no stuck funds, payout ≤ input − fee, etc. |
| Integration | Foundry `--fork-url` Arc testnet     | 15 scenarios (1 happy + 7 reverts + 7 edges)             |
| E2E         | Playwright + Synpress (MetaMask mock) | 8 critical user flows                                   |
| Demo        | Manual + Loom                         | 5 scripted paths in testnet                             |

### Security posture
- **Static**: Slither + Aderyn in CI; PR fails on any high/medium.
- **Manual**: full SWC registry checklist; upstream Curve fork reviewed patch-by-patch.
- **Optional**: Sherlock micro-audit if grant budget covers it.

### Scope guard (YAGNI)
- Invariant tests + manual audit kick in only after contract freeze (end of week 2). Gas benchmarking, cross-chain replay, multi-version fork — roadmap, not v1.

---

## 8. Open Questions / Risks

1. **Curve testnet availability on Arc** — no existing Curve deployment on Arc testnet; we will deploy our own fork. Need to verify Curve's BSD-3 license terms permit this (they do, but confirm with Circle before grant submission if attribution matters).
2. **Chainlink EUR/USD feed on Arc testnet** — to be verified; if unavailable we fall back to a mock with a clear README disclosure (acceptable for testnet, blocking for mainnet).
3. **Liquidity bootstrap** — we provide initial LP from testnet faucet. At real transaction sizes slippage could exceed 0.5% guard; demo must stay within reasonable amounts (<$1k per tx).
4. **MEV on Arc** — sub-second finality reduces window, but not verified. Demo currently does not use private mempool or commit-reveal. Worth a paragraph in the grant submission acknowledging the limitation.
5. **Merchant invoice spam** — anyone can call `createInvoice`. Mitigation: hosted API rate-limits unauthenticated create calls, and on-chain `createInvoice` is callable only by the registered merchant.
6. **Grant-specific compliance posture** — merchant registry exposes an optional KYC verifier hook (unused in v1) to signal compliance-readiness without blocking testnet demo.

---

## 9. Success Criteria

- Live on Arc testnet with bootstrapped USDC/EURC liquidity
- Merchant onboarding in <5 minutes from empty wallet to first invoice paid
- SDK integration in ≤3 lines of code (init, createInvoice, openCheckout)
- Test coverage ≥95% unit, all CI green
- Grant submission package: Loom video, README, deployed demo link, test coverage badge, Slither report

---

## 10. Future Roadmap (post-v1)

1. Multi-pool hub (USDC/EURC + USDC/USDT + EURC/GBP stablecoin)
2. Refund / dispute resolution flow
3. Localized off-ramp partnerships (Türkiye corridor first — BTCTurk / Paribu)
4. Merchant-side KYC verifier enforcement
5. Agent-to-agent payment rail (Arc's "Agentic Economy" pillar)
6. Mainnet deployment + audit
