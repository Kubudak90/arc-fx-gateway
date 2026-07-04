# Arcora threat model — ArcFXGateway (custody-escrow), Arc Testnet

Audit scope: `packages/contracts/src/ArcFXGateway.sol` plus the OpenZeppelin
libraries it imports. Adjacent off-chain components (relayer daemon, Vercel
app, Supabase DB, compliance gate) are listed here for context but reviewed
in a separate engagement.

This document is the audit-readiness artefact. It captures what the system
is, who can do what, what an attacker would aim at, and what we already do
about it. Anything explicitly out of scope is marked.

---

## System in one paragraph

A merchant invoice contract on Arc Testnet (mainnet target) lets customers
pay with one EIP-712 (Permit2) signature in any whitelisted stablecoin and
have the merchant settled in their preferred stable, deterministically.
The gateway does **not** swap; an off-chain relayer pulls the pay-in via
Permit2, runs Circle App Kit Swap to convert it, and then calls the
gateway's `settleInvoice` to deliver the payout into per-invoice escrow.
The gateway's role is invoice lifecycle, fee accrual, refund accounting,
and the 7-day custody window before funds become claimable by the merchant
payout address.

---

## Actors

| Actor | Trust | Capabilities |
|---|---|---|
| **Customer (payer)** | Untrusted | Connects an EOA, signs a Permit2 message authorising the relayer to pull `amountIn` of `payInToken` for a specific `invoiceId` |
| **Merchant** | Semi-trusted (KYB at mainnet, wallet-only on testnet) | Has API key + payout address. Calls `registerMerchant`, `updatePayoutToken`, creates invoices via `/api/invoices`. Can authorize a server delegate (bit-flag rights: `RIGHT_CREATE_INVOICE`, `RIGHT_REFUND`) via `authorizeDelegate(delegate, expiresAt, rights)` |
| **Relayer** | Trusted within scope | Holds `RELAYER_ROLE`. Calls `settleInvoice` and `recordPayerRefund`. Hot wallet on a single VPS |
| **Admin** | Fully trusted (single EOA today, multisig pre-mainnet) | Holds `DEFAULT_ADMIN_ROLE`. Can `pause/unpause`, `setTokenSupport`, `withdrawFees`, `deactivateMerchant`, `reactivateMerchant`, `adminRecoverEscrow`, manage roles |
| **Circle App Kit Swap** | Trusted as third party | Off-chain RFQ network used by the relayer to convert pay-in → payout. Not on the contract attack surface |

---

## Assets

| Asset | Where | Custody |
|---|---|---|
| Per-invoice escrow balances | `escrows[globalId]` inside the gateway | Drained on `refundInvoice` (within 7-day window) or `claim` (after window) |
| `protocolFeesAccrued[token]` | Gateway contract | Accrued on `claim` (no fee on refund); withdrawable by `DEFAULT_ADMIN_ROLE` only |
| Invoice records (immutable post-create) | Gateway storage | Merchant-scoped via `invoices[globalId].merchant` |
| Relayer hot wallet ETH/USDC for gas | EOA on VPS, secret-id rotated daily via Vault | Single key — single point of failure |
| Compliance audit log (`compliance_screenings`) | Supabase | Off-chain; out of contract audit scope |

---

## Trust boundaries

```
   ┌───────────────────────────────────────────────────────┐
   │  ON-CHAIN (audit scope)                               │
   │  ── ArcFXGateway + OZ libs                            │
   │  ── Permit2 (well-known, audited)                     │
   │  ── ERC-20 stable contracts (Circle / external)       │
   └─────────────────▲─────────────────────────────────────┘
                     │ settleInvoice / refundInvoice /
                     │ claim / recordPayerRefund
   ┌─────────────────┴─────────────────────────────────────┐
   │  OFF-CHAIN (separate review track — not audit scope)  │
   │  ── ops/relayer (drains queue, kit.swap, settles)     │
   │  ── packages/app  (invoice + checkout + dashboard)    │
   │  ── packages/app/lib/compliance (default `noop`)      │
   │  ── Supabase (Postgres)                               │
   └───────────────────────────────────────────────────────┘
```

The on-chain contract assumes the relayer obeys the protocol but does not
require it. Every relayer action is bounded by what the gateway lets it do
(single-shot settle/refund per invoice; escrow amount fixed at settle;
cannot drain protocol fees; cannot redirect payouts).

---

## Attack surface

### A. Customer-side

| # | Threat | Mitigation |
|---|---|---|
| A1 | Replay an old Permit2 signature | Permit2 enforces nonce; gateway enforces `status == Created` (single-shot) |
| A2 | Front-run another customer's pay attempt for the same invoice | First successful `settleInvoice` flips status to `Paid`; later attempts revert with `InvoiceNotInCreatedState` |
| A3 | Pay with sanctioned wallet | **Off-chain** compliance gate at `/api/checkout/authorize` (pre-signature). Not on-chain |
| A4 | Manipulate `amountIn` to under-pay merchant | `settleInvoice` requires gross-received ≥ `amountOut`; reverts otherwise. Excess routes to `protocolFeesAccrued` (audit-fix #25: `excess` now emitted as the `fee` field in `InvoicePaid`) |
| A5 | DoS by submitting many bad Permit2 signatures | `/api/checkout/submit` shape-validates; per-IP rate limit; relayer claims one queue row at a time. Costs us DB rows but no funds |
| A6 | Customer wallet reverts during transfer | Pay-in token is transferred via `Permit2.permitTransferFrom` (relayer ↔ token contract); a revert means relayer doesn't proceed to swap |

### B. Merchant-side

| # | Threat | Mitigation |
|---|---|---|
| B1 | Reroute payouts mid-invoice (after customer signs) | `payoutAddress` and `payoutToken` are read at `createInvoice` time and snapshotted into the escrow; subsequent `updatePayoutToken` does not affect existing invoices |
| B2 | Merchant API key leaks → attacker creates fake invoices | API-key compromise is the primary off-chain risk. Mitigation: per-merchant rotation + IP allowlists (not yet shipped) |
| B3 | Merchant under sanction | Compliance gate at `/api/invoices` (pre-create) blocks `risk=sanctions/high`, queues `risk=medium` |
| B4 | Merchant tries to call `settleInvoice` directly | Function is `onlyRole(RELAYER_ROLE)`; reverts |
| B5 | Merchant withdraws fees | `withdrawFees` is `onlyRole(DEFAULT_ADMIN_ROLE)`; merchants don't have it |
| B6 | Compromised server delegate creates many fake invoices | Delegate rights are bit-flag (`authorizeDelegate(delegate, expiresAt, rights)`); merchant can revoke by setting `expiresAt = 0` or zeroing the rights mask. Server delegate cannot mint payouts — only enqueues invoices the customer must then pay against |

### C. Relayer-side

| # | Threat | Mitigation |
|---|---|---|
| C1 | Relayer key compromise → settle invoices to attacker | `settleInvoice` delivers payout into per-invoice escrow keyed by `merchant.payoutAddress` (locked at create) — attacker cannot redirect funds. Worst-case attacker can mark invoices `Paid` without actually delivering the pay-in, but the escrow balance must already match the swap inflow — no funds materialise from nothing. **Severity: medium** |
| C2 | Relayer compromise → drain protocol fees | `withdrawFees` is admin-only; relayer cannot |
| C3 | Relayer outage AFTER Permit2 pull but BEFORE swap | Customer funds sit in relayer hot wallet. Refund branch (manual ops) recovers. **Operational, not contract** |
| C4 | Relayer races with itself (parallel instances) | Single VPS, single instance. Queue claim uses `SELECT ... FOR UPDATE SKIP LOCKED` + stale-processing lease (audit-fix). Not a contract concern |
| C5 | Slow relayer → invoice expires before settle | `expiresAt` enforced in `settleInvoice`; reverts on expired. Customer's pay-in lives in relayer wallet → manual refund path |
| C6 | Relayer submits `recordPayerRefund` after settle | Reverts: `InvoiceNotInCreatedState`. `recordPayerRefund` itself is `nonReentrant` |
| C7 | Relayer-supplied `payInToken` disagrees with stored invoice | `settleInvoice` reverts `InvalidPayInToken` (audit-fix #6); off-chain accounting cannot diverge from the on-chain log |

### D. Admin-side

| # | Threat | Mitigation |
|---|---|---|
| D1 | Admin key compromise | Catastrophic — can pause, withdraw fees, whitelist a malicious token, transfer admin role, sweep an escrow via `adminRecoverEscrow`. **Mitigation: multisig migration before mainnet** (separate runbook, tracked) |
| D2 | Admin pauses to censor specific merchants | Pause is system-wide; cannot pause one merchant. Acceptable as emergency control |
| D3 | Admin whitelists a malicious token | `setTokenSupport(token, true)` is admin-only and intentional. New tokens reviewed before listing. Acceptable as a configuration risk |
| D4 | Admin abuses `adminRecoverEscrow` to sweep an active merchant's escrow | `adminRecoverEscrow` is gated on `merchant.deactivatedAt + 14 days`; cannot drain a healthy merchant |
| D5 | Admin sets a deploy fee > sane bound | Constructor and `setProtocolFeeBps` both `require(feeBps <= 1000)` (10% on-chain bound) |

### E. Token-side

| # | Threat | Mitigation |
|---|---|---|
| E1 | Whitelisted token has rebase / fee-on-transfer | Whitelist policy: only non-rebasing, non-fee-on-transfer tokens (USDC, EURC, USDT, USDe, DAI, PYUSD all qualify). Documented assumption — review on every new whitelist tx (Audit M3 adds an explicit gate to `deploy-checklist.md` §4 and a regression guard `test/gateway/FeeOnTransferPolicy.t.sol` proving why: the gateway records `grossPayout` without measuring the received balance). `withdrawFees` is `nonReentrant` (audit-fix #27) for future-proofing |
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
| G1 | Re-entrancy via ERC-20 hooks | `nonReentrant` on `settleInvoice`, `refundInvoice`, `recordPayerRefund`, `claim`, `withdrawFees`, `adminRecoverEscrow`. Standard CEI pattern in each |
| G2 | Integer overflow / underflow | Solidity 0.8 checked math throughout |
| G3 | Self-destruct or `DELEGATECALL` to attacker | Contract has neither; `using SafeERC20 for IERC20` only |
| G4 | Unbounded loops | `claim(bytes32[])` and `adminRecoverEscrow(bytes32[])` accept caller-bounded arrays; the caller's gas budget is the de-facto cap. No internal unbounded iteration |

### H. Denial of service

| # | Threat | Mitigation |
|---|---|---|
| H1 | Customer leaves invoice stuck in `Created` forever (never pays) | `expiresAt` lets the merchant or admin call `refundInvoice` after expiry. Indexer marks the row terminal |
| H2 | Push-payment to a contract that always reverts (merchant payout) | `claim` and `refundInvoice` use `safeTransfer`; a revert on the merchant payout reverts the call. Funds stay in escrow and the merchant can update `payoutToken` (with consequent re-claim path) |

---

## Existing mitigations summary

- **`AccessControl`** with separated `DEFAULT_ADMIN_ROLE` / `RELAYER_ROLE`. No EOA holds both roles in the canonical deploy.
- **`Pausable`** for emergency stop. All settle/refund/withdraw/claim paths gated.
- **`ReentrancyGuard`** on every function that moves tokens.
- **Single-shot invoice lifecycle**: `Created → Paid → (Refunded | Claimed | Recovered) | Failed | Expired` is terminal. Status checked at every state-mutating entry.
- **Locked-at-create**: payout address and payout token snapshot at `createInvoice`. Subsequent merchant edits don't reroute pending invoices.
- **Per-invoice escrow** (`escrows[globalId]`) used by refund + claim — refunds always return the exact amount the merchant received into escrow, not a re-derived value.
- **Permit2-based pay-in**: customer never approves the gateway directly; nonce-protected by Permit2.
- **Server-side Permit2 verification** in the API (`/api/checkout/submit`) before the queue row is even written — the relayer never sees a structurally-invalid signature.
- **Compliance gate at API layer**: default `noop`; production flip enforces sanctions screening pre-pay.
- **Constructor-bounded fee**: `require(feeBps <= 1000)` (10%) on deploy and `setProtocolFeeBps`.
- **Stale-processing lease** in the relayer queue — a crashed worker's row is reclaimable after `RELAYER_LEASE_SECONDS` instead of stuck forever.

---

## Known assumptions / accepted risks (call them out at kickoff)

1. **Single-instance relayer**. Documented as an ops constraint. Multi-relayer + queue-lock coordination tracked separately.
2. **Single-EOA admin today**. Multisig migration is a pre-mainnet bar; tracked in `docs/ROADMAP.md`.
3. **Whitelist policy is unenforced on-chain**. The contract trusts admin to only whitelist non-rebasing, non-FoT tokens. A future on-chain validation layer is out of v1 scope.
4. **Compliance is off-chain only**. No on-chain blocklist. Default provider is `noop` on testnet.
5. **No upgradability**. Gateway is non-upgradeable. Migration path = deploy-new + repoint clients (`GATEWAY_ADDRESS` env + `arc-testnet.json` manifest).
6. **Permit2 trust**. We rely on the canonical Permit2 deployment. If Permit2 is broken, every project that uses it is broken.
7. **Stable issuer trust**. USDC, EURC, etc. can pause / blacklist us at the issuer level. Inherent to the asset class.

---

## Out-of-audit-scope items (separate engagements)

- Off-chain relayer / app / SDK security review (web2 firms — Cure53 / Doyensec / NCC).
- Operational runbook (incident response, key rotation cadence, multisig migration sequencing).
- Bug bounty post-launch (Immunefi, set up at mainnet T-0).
- Compliance provider integration calibration (Elliptic / TRM Labs request shapes verified against their actual OpenAPI specs at provider-onboarding time).

---

## Reporting a finding

Off-protocol disclosure: `compliance@arcorapay.xyz`. We respond within 24h.
For a live mainnet deployment a public Immunefi program will be the canonical channel; until then please email.
