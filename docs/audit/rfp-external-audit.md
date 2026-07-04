# RFP — external smart-contract security audit (Arcorapay)

**Status:** draft for issue. **Owner:** Huseyin Arslan. **Date:** 2026-07-05.
**Why now:** MAINNET-READINESS calls the external audit a hard blocker; no external
review has ever run. Internal review is mature (multiple in-house passes; latest
`docs/audit/audit-2026-07-04-full-sweep.md`) but is not a substitute.

## 1. What Arcorapay is

USDC-native payment rails. Two on-chain designs run in parallel behind a flag:

- **v1 — `ArcFXGateway`** (custodial escrow on Arc): merchant registration,
  delegated invoice creation, refund window, fee split, admin recovery. **LIVE**
  on testnet; the default path in production today (`V2_ENABLED` off).
- **v2 — chain-agnostic CCTP router** (no custody): the buyer locks USDC in
  `PaymentEscrow.deposit()` on their chosen chain; settlement routes via CCTP V2
  (burn → Iris attestation → `SettlementReceiver.receiveAndSettle` on the payout
  chain), with Li.Fi as a same-chain DEX swap only. Custody eliminated via CCTP
  hooks. Flag-gated OFF in prod; the target design for mainnet.

Off-chain: a Next.js API, a single-VPS relayer/keeper/indexer, Vault-held relayer
key. Those are in scope only where they define an on-chain trust boundary (who can
call privileged functions, what the keeper is trusted to submit).

## 2. Scope — contracts

| Contract | Lines | Repo location | Notes |
|---|---|---|---|
| `ArcFXGateway.sol` | 495 | `packages/contracts/src/` (this repo) | v1, live on testnet |
| `PaymentEscrow.sol` | 396 | **`agent-commerce-v2/packages/contracts/src/`** (sibling repo) | v2 fund-holder |
| `SettlementReceiver.sol` | 291 | same sibling repo | v2 CCTP dest |
| `libraries/CCTPMessageV2.sol`, `interfaces/*` | ~small | same | CCTP message parsing |

> **Repo consolidation gap (2026-07-05):** the v2 escrow contracts still live in
> the standalone `agent-commerce-v2` repo (last commit 2026-06-19), NOT the main
> monorepo — which carries only the compiled ABI (`packages/router/src/abi.ts`).
> Before the audit *starts*, these sources must be brought under one roof and
> pinned to a single commit so the auditors review exactly what is deployed.
> Tracked as a pre-audit action below.

Deployed testnet addresses: `packages/contracts/deployments/arc-testnet.json`
(v1) and `packages/router/src/chains.ts` (v2 escrow/receiver per domain).

## 3. Threat model to validate

The auditors should treat these as the load-bearing claims (our own analysis;
we want them broken, not confirmed):

1. **Escrow solvency** — `sum(escrowed) <= contract USDC balance` holds across
   every fund mover (deposit, settle, refund, claim, adminRecover) under
   reentrancy and out-of-order settlement. (Fee-on-transfer/rebasing tokens are
   admin-allowlist-gated and exact-transfer-only — verify that gate.)
2. **CCTP acceptance** — the v2 receiver settles ONLY on a mint that landed on the
   Vault-derived relayer address and clears the burn-amount floor; a DB- or
   MITM-supplied `mint_recipient` must not drain relayer float (this exact hole
   was closed 2026-07-04, commit `7612499` — verify the fix is complete).
3. **Authorization** — RELAYER_ROLE / keeper can move funds only along intended
   paths; a compromised relayer key's blast radius is bounded to refund-window
   misrouting (documented), not arbitrary theft.
4. **Refund window** — no settle before it closes, no refund after; no state where
   both merchant and buyer can be paid.
5. **Admin** — a single EOA today; the audit should assume the mainnet migration
   to a 2-of-3 Safe + timelock (runbook: `docs/runbooks/deployer-key-and-safe.md`)
   and flag anything that assumes an EOA admin (e.g. `renounceRole` bricking).

## 4. Honest coverage gaps (so bids are accurate)

Disclosed up front — these are known and on us to close, but the auditors should
know the current test suite's blind spots:

- Invariant fuzz under-covers: single merchant / single payout token;
  `adminRecoverEscrow` and `recordPayerRefund` are NOT exercised by the solvency
  invariant; multi-token solvency is currently trivial (`0==0`).
- Reentrancy tests arm only `refundInvoice`; `claim` / `adminRecoverEscrow` share
  the guard but are untested for reentry.
- v2 `SettlementReceiver` CCTP-message parsing has less differential testing than
  the escrow state machine.

Full internal finding history: `docs/audit/audit-2026-07-04-full-sweep.md` +
`docs/audit/low-triage-2026-07-04.md`. We will share these with the selected firm.

## 5. Engagement asks

- **Depth:** manual review + property/invariant testing (Foundry). Not a
  scanner-only pass — we run Slither/Aderyn in-house (`audit/preflight/`).
- **Deliverable:** severity-rated findings (Immunefi/OWASP-style), a re-test after
  fixes, and a public report we can link from the launch.
- **Timeline:** target kickoff within 2 weeks of selection; ~2–3 week review for
  ~1.2k Solidity SLOC + the CCTP integration.
- **Chain specifics:** familiarity with **CCTP V2** (hooks, fast-transfer fee,
  Iris attestation) and Arc (USDC-as-gas, 18-dp native vs 6-dp ERC-20) is
  strongly preferred — the cross-decimal and cross-domain seams are where our
  own review spent the most effort.

## 6. Candidate firms (shortlist to contact)

CCTP/cross-chain track record weighted highest: Trail of Bits, OpenZeppelin,
Spearbit/Cantina, Zellic, Ackee, Cyfrin. (Circle's own audit partners for CCTP
integrations are worth asking Circle about directly, given the Arc relationship.)

## 7. Pre-audit actions (ours, before kickoff)

1. **Consolidate v2 contracts into this repo** (see §2 gap) and tag the audited
   commit. — *blocks the audit from starting against the right source.*
2. Land the disclosed coverage gaps in §4 (2nd merchant/token in the invariant;
   reentry tests for `claim`/`adminRecover`) so the auditors start from honest
   green, not a false 100%.
3. Freeze the contract surface for the review window (no feature changes; security
   fixes only, communicated).
4. Provide `arc-mainnet.json` deploy params + the Safe migration plan so the audit
   covers the *mainnet* admin topology, not the testnet EOA.
