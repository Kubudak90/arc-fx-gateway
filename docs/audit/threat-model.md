# Arcora threat model — v0.8.1 (2026-05-03)

Audit scope per Plan 7: `packages/contracts/src/ArcFXGatewayV8.sol` plus the OpenZeppelin libraries it imports. Adjacent off-chain components (relayer daemon, Vercel app, Neon DB, Plan-5 compliance gate) are listed here for context but reviewed in a separate engagement.

This document is the audit-readiness artefact. It captures what the system is, who can do what, what an attacker would aim at, and what we already do about it. Anything explicitly out of scope is marked.

---

## System in one paragraph

A merchant invoice contract on Arc Testnet (mainnet target) lets customers pay with one EIP-712 (Permit2) signature in any whitelisted stablecoin and have the merchant settled in their preferred stable, deterministically. The gateway does **not** swap; an off-chain relayer pulls the pay-in via Permit2, runs Circle App Kit Swap to convert it, and then calls the gateway's `settleInvoice` to deliver the payout. The gateway's role is invoice lifecycle, fee accrual, and refund accounting.

---

## Actors

| Actor | Trust | Capabilities |
|---|---|---|
| **Customer (payer)** | Untrusted | Connects an EOA, signs a Permit2 message authorising the relayer to pull `amountIn` of `payInToken` for a specific `invoiceId` |
| **Merchant** | Semi-trusted (KYB at mainnet, wallet-only on testnet) | Has API key + payout address. Calls `registerMerchant`, `updatePayoutToken`, creates invoices via `/api/invoices` |
| **Relayer** | Trusted within scope | Holds `RELAYER_ROLE`. Calls `settleInvoice` and `recordPayerRefund`. Hot wallet on a single VPS |
| **Admin** | Fully trusted (single EOA today, multisig pre-mainnet) | Holds `DEFAULT_ADMIN_ROLE`. Can `pause/unpause`, `setTokenSupport`, `withdrawFees`, manage roles |
| **Circle App Kit Swap** | Trusted as third party | Off-chain RFQ network used by the relayer to convert pay-in → payout. Not on the contract attack surface |

---

## Assets

| Asset | Where | Custody |
|---|---|---|
| Whitelisted stable balances | Gateway contract, between `settleInvoice` accounting and merchant transfer | Gateway's `address(this)` balance |
| `protocolFeesAccrued[token]` | Gateway contract | Withdrawable by `DEFAULT_ADMIN_ROLE` only |
| Invoice records (immutable post-create) | Gateway storage | Merchant-scoped via `invoices[globalId].merchant` |
| Relayer hot wallet ETH/USDC for gas | EOA on VPS | Single key — single point of failure |
| Compliance audit log (`compliance_screenings`) | Neon DB | Off-chain; out of contract audit scope |

---

## Trust boundaries

```
   ┌───────────────────────────────────────────────────────┐
   │  ON-CHAIN (audit scope)                               │
   │  ── ArcFXGatewayV8 + OZ libs                          │
   │  ── Permit2 (well-known, audited)                     │
   │  ── ERC-20 stable contracts (Circle / external)       │
   └─────────────────▲─────────────────────────────────────┘
                     │ settleInvoice / recordPayerRefund
   ┌─────────────────┴─────────────────────────────────────┐
   │  OFF-CHAIN (separate review track — not audit scope)  │
   │  ── ops/relayer (drains queue, kit.swap, settles)     │
   │  ── packages/app  (invoice + checkout + dashboard)    │
   │  ── packages/app/lib/compliance (Plan-5 Phase 0)      │
   │  ── Neon DB                                           │
   └───────────────────────────────────────────────────────┘
```

The on-chain contract assumes the relayer obeys the protocol but does not require it. Every relayer action is bounded by what the gateway lets it do (single-shot settle/refund per invoice; payout amount fixed at invoice creation; cannot drain protocol fees).

---

## Attack surface

### A. Customer-side

| # | Threat | Mitigation |
|---|---|---|
| A1 | Replay an old Permit2 signature | Permit2 enforces nonce; gateway enforces `status == Created` (single-shot) |
| A2 | Front-run another customer's pay attempt for the same invoice | First successful `settleInvoice` flips status to `Paid`; later attempts revert with `InvoiceNotInCreatedState` |
| A3 | Pay with sanctioned wallet | **Off-chain** Plan-5 gate at `/api/checkout/authorize` (pre-signature). Not on-chain |
| A4 | Manipulate `amountIn` to under-pay merchant | `settleInvoice` requires gross-received ≥ `amountOut`; reverts otherwise. Excess routes to `protocolFeesAccrued` |
| A5 | DoS by submitting many bad Permit2 signatures | `/api/checkout/submit` shape-validates; relayer claims one queue row at a time. Costs us DB rows but no funds |
| A6 | Customer wallet reverts during transfer | Pay-in token is transferred via `Permit2.permitTransferFrom` (relayer ↔ token contract); a revert means relayer doesn't proceed to swap |

### B. Merchant-side

| # | Threat | Mitigation |
|---|---|---|
| B1 | Reroute payouts mid-invoice (after customer signs) | `payoutAddress` and `payoutToken` are read at `createInvoice` time; subsequent `updatePayoutToken` does not affect existing invoices |
| B2 | Merchant API key leaks → attacker creates fake invoices | API-key compromise is the primary off-chain risk. Mitigation: per-merchant rotation + IP allowlists (not yet shipped — flagged for v1.x) |
| B3 | Merchant under sanction | Plan-5 gate at `/api/invoices` (pre-create) blocks `risk=sanctions/high`, queues `risk=medium` |
| B4 | Merchant tries to call `settleInvoice` directly | Function is `onlyRole(RELAYER_ROLE)`; reverts |
| B5 | Merchant withdraws fees | `withdrawFees` is `onlyRole(DEFAULT_ADMIN_ROLE)`; merchants don't have it |

### C. Relayer-side

| # | Threat | Mitigation |
|---|---|---|
| C1 | Relayer key compromise → settle invoices to attacker | `settleInvoice` delivers payout to `merchant.payoutAddress` (locked at create) — attacker cannot redirect funds. Worst-case attacker can mark invoices `Paid` without delivering, but funds are still locked in the gateway and recoverable via admin. **Severity: medium** |
| C2 | Relayer compromise → drain protocol fees | `withdrawFees` is admin-only; relayer cannot |
| C3 | Relayer outage AFTER Permit2 pull but BEFORE swap | Customer funds sit in relayer hot wallet. Refund branch (manual ops) recovers. **Operational, not contract** |
| C4 | Relayer races with itself (parallel instances) | Single VPS, single instance. Queue claim uses `SELECT ... FOR UPDATE SKIP LOCKED`. Not a contract concern |
| C5 | Slow relayer → invoice expires before settle | `expiresAt` enforced in `settleInvoice`; reverts on expired. Customer's pay-in lives in relayer wallet → manual refund path |
| C6 | Relayer submits `recordPayerRefund` after settle | Reverts: `InvoiceNotInCreatedState` |

### D. Admin-side

| # | Threat | Mitigation |
|---|---|---|
| D1 | Admin key compromise | Catastrophic — can pause, withdraw fees, whitelist a malicious token, transfer admin role. **Mitigation: multisig migration before mainnet** (separate runbook, tracked) |
| D2 | Admin pauses to censor specific merchants | Pause is system-wide; cannot pause one merchant. Acceptable as emergency control |
| D3 | Admin whitelists a malicious token | `setTokenSupport(token, true)` is admin-only and intentional. New tokens are reviewed before listing per Plan 3. Acceptable as a configuration risk |

### E. Token-side

| # | Threat | Mitigation |
|---|---|---|
| E1 | Whitelisted token has rebase / fee-on-transfer | Whitelist policy: only non-rebasing, non-fee-on-transfer tokens (USDC, EURC, USDT, USDe, DAI, PYUSD all qualify). Documented assumption — review on every new whitelist tx |
| E2 | Token blacklists the gateway | Funds frozen for that token. Out of contract scope; admin runbook responds with pause + investigation |
| E3 | Token contract upgraded to malicious behaviour | Inherent to most stables (USDC included). Documented assumption |

### F. App Kit (Circle) side

| # | Threat | Mitigation |
|---|---|---|
| F1 | App Kit outage | Relayer's `kit.swap` fails → refund branch. Not on the contract |
| F2 | App Kit returns a worse rate than expected | If gross-received < `amountOut`, `settleInvoice` reverts. Refund branch |
| F3 | App Kit is malicious / quote-griefs | Same as F2 — gateway's invariant (`grossReceived >= amountOut`) catches it |

### G. Re-entrancy + standard EVM hazards

| # | Threat | Mitigation |
|---|---|---|
| G1 | Re-entrancy via ERC-20 hooks | `nonReentrant` on `settleInvoice`, `refundInvoice`, `recordPayerRefund`. Standard CEI pattern in each. Verify during audit |
| G2 | Integer overflow / underflow | Solidity 0.8 checked math throughout |
| G3 | Self-destruct or `DELEGATECALL` to attacker | Contract has neither; `using SafeERC20 for IERC20` only |
| G4 | Unbounded loops | No loops over user-controlled arrays in any external function |

### H. Denial of service

| # | Threat | Mitigation |
|---|---|---|
| H1 | Customer leaves invoice stuck in `Created` forever (never pays) | `expiresAt` lets the merchant or admin call `refundInvoice` after expiry. Indexer marks the row terminal |
| H2 | Push-payment to a contract that always reverts (merchant payout) | `safeTransfer` reverts; entire `settleInvoice` reverts; queue row goes to retry/refund branch |

---

## Existing mitigations summary

- **`AccessControl`** with separated `DEFAULT_ADMIN_ROLE` / `RELAYER_ROLE`. No EOA holds both roles in the canonical deploy.
- **`Pausable`** for emergency stop. All settle/refund/withdraw paths gated.
- **`ReentrancyGuard`** on every function that moves tokens.
- **Single-shot invoice lifecycle**: `Created → Paid | Refunded | Failed` is terminal. Status checked at every state-mutating entry.
- **Locked-at-create**: payout address and payout token snapshot at `createInvoice`. Subsequent merchant edits don't reroute pending invoices.
- **Per-invoice payment record** (`InvoicePayment`) used by refund — refunds always pay the exact amount the merchant received, not a re-derived value.
- **Permit2-based pay-in**: customer never approves the gateway directly; nonce-protected by Permit2.
- **Compliance gate at API layer**: Plan-5 Phase 0 default = Noop; production flip enforces sanctions screening pre-pay (Plan 5).

---

## Known assumptions / accepted risks (call them out at kickoff)

1. **Single-instance relayer**. Documented as a v1 ops constraint. Multi-relayer + queue-lock coordination tracked separately.
2. **Single-EOA admin today**. Multisig migration is a pre-mainnet bar; tracked outside this audit.
3. **Whitelist policy is unenforced on-chain**. The contract trusts admin to only whitelist non-rebasing, non-FoT tokens. A future on-chain validation layer is out of v1 scope.
4. **Compliance is off-chain only**. No on-chain blocklist. Plan-5 spec documents this trade-off explicitly.
5. **No upgradability**. V8 is non-upgradeable. Migration path = deploy-new + repoint clients (DNS / app envs / indexer GATEWAY_ADDRESS).
6. **Permit2 trust**. We rely on the canonical Permit2 deployment. If Permit2 is broken, every project that uses it is broken.
7. **Stable issuer trust**. USDC, EURC, etc. can pause / blacklist us at the issuer level. Inherent to the asset class.

---

## Out-of-audit-scope items (separate engagements)

- Off-chain relayer / app / SDK security review (web2 firms — Cure53 / Doyensec / NCC, Plan 8 if commissioned).
- Operational runbook (incident response, key rotation cadence, multisig migration sequencing).
- Bug bounty post-launch (Immunefi, set up at mainnet T-0).
- Compliance provider integration calibration (Elliptic / TRM Labs request shapes verified against their actual OpenAPI specs at provider-onboarding time).

---

## Reporting a finding

Off-protocol disclosure: `compliance@arcora.dev`. We respond within 24h.
For a live mainnet deployment a public Immunefi program will be the canonical channel; until then please email.
