# AFG-013 Validation: Refund remains callable after `claimableAt`

## Disposition

**Reportable, Low severity, High confidence (0.95).**

The candidate's code-level claim is confirmed. `refundInvoice()` has no
`claimableAt` check, so an authorized merchant, admin, or unexpired refund
delegate can refund a `Paid` invoice at or after the advertised refund-window
boundary until another transaction changes the invoice state. At
`block.timestamp == claimableAt`, both `refundInvoice()` and `claim()` are
valid; transaction ordering decides whether the payer is refunded or the
merchant is paid.

The issue is Low rather than Medium/High because callers are already trusted
refund principals, the transfer can only go to the recorded payer, and a
customer or arbitrary third party cannot invoke the refund path. The security
impact is an extended delegated-authority and settlement-finality window, not
unauthorized theft to an attacker-controlled address.

## Candidate identity

- Candidate ID: `AFG-013`
- Instance key: `ArcFXGateway.refundInvoice:post-claimableAt`
- Ledger row ID: not provided in the available scan artifacts
- Root control: `packages/contracts/src/ArcFXGateway.sol:316-325`
- Affected state transition: `packages/contracts/src/ArcFXGateway.sol:327-335`
- Competing finalization path: `packages/contracts/src/ArcFXGateway.sol:358-379`

## Validation rubric

- [x] Prove the exact state and timestamp guards on refund and claim.
- [x] Establish the intended custody/refund invariant from docs, tests, and UI.
- [x] Enumerate every reachable refund caller and delegation constraint.
- [x] Determine transaction-ordering, finality, and fund-flow impact.
- [x] Seek counterevidence that post-window refunds are intentional.

## Exact code behavior

`settleInvoice()` creates escrow with
`claimableAt = uint64(block.timestamp) + REFUND_WINDOW` and leaves the invoice
in `Paid` state (`ArcFXGateway.sol:281-288`).

`refundInvoice()` then checks only:

1. `inv.status == Paid`;
2. caller is the invoice merchant, a current `DEFAULT_ADMIN_ROLE` holder, or a
   delegate whose `expiresAt >= block.timestamp` and rights include
   `RIGHT_REFUND`.

It does not read `escrows[globalId].claimableAt`. It sets the invoice to
`Refunded`, deletes escrow, and transfers the full escrow amount to
`inv.paidBy`.

By contrast, `claim()` requires both `Paid` state and
`block.timestamp >= e.claimableAt`. It sets the invoice to `Claimed`, deletes
escrow, accrues the protocol fee, and transfers the net amount to the
merchant's current payout address.

Consequently:

- Before `claimableAt`: refund can succeed; claim reverts `ClaimTooEarly`.
- At and after `claimableAt`: refund and claim can both succeed from `Paid`.
- Refund first: state becomes `Refunded`; a later claim reverts
  `InvoiceNotClaimable`.
- Claim first: state becomes `Claimed`; a later refund reverts
  `InvoiceNotRefundable`.
- If neither path executes, the overlap is indefinite for the merchant and
  admin, and lasts until delegate expiry for a refund delegate.

Both functions are `nonReentrant`, use checks-effects-interactions, and the
chain's finality does not undo the winner. Finality therefore makes the first
included transition conclusive but does not remove mempool/sequencing risk.

## Reachable actors

| Actor | Can execute a late refund? | Conditions |
|---|---:|---|
| Invoice merchant | Yes | Always while invoice remains `Paid`; merchant active status is not checked |
| `DEFAULT_ADMIN_ROLE` holder | Yes | Role must still be held |
| Refund delegate | Yes | `RIGHT_REFUND` set and `expiresAt >= block.timestamp` |
| Relayer | No by role alone | Must separately be merchant, admin, or refund delegate |
| Recorded payer/customer | No | No payer authorization branch |
| Arbitrary third party | No | Reverts `NotAuthorized` |

The hosted dashboard's normal server authorization grants only
`RIGHT_CREATE_INVOICE` (`DelegateAuthCard.tsx:18-22,74-85`), which materially
limits default deployment exposure. A merchant can still grant
`RIGHT_REFUND` through the public contract interface.

## Intended invariant evidence

Most architecture and product surfaces define a hard timestamp boundary:

- Contract NatSpec says refunds are "within the 7-day window" and claims occur
  after it (`ArcFXGateway.sol:10-17`).
- README says refunds occur during the seven-day window and permissionless
  claims occur after it (`README.md:35-39`).
- Threat model says escrow is drained by refund within the window or claim
  after the window (`docs/audit/threat-model.md:42-45`).
- Litepaper defines custody escrow as refundable until the window closes and
  claimable afterward (`docs/LITEPAPER.md:149-155,354-359`).
- Quickstart repeats the same before/after split
  (`packages/app/app/docs/quickstart/page.tsx:97-102`).
- The refund UI hides the button when `Date.now() >= claimableAt`
  (`packages/app/components/merchant/RefundButton.tsx:17-19,34-43`).
- The escrow API classifies `claimableAt <= now` invoices as matured and ready
  to claim (`packages/app/app/api/merchant/escrows/route.ts:8-14,87-97`).

This supports the externally visible invariant:

> Refund authority ends when the custody window closes; from that timestamp,
> the escrow is a matured merchant receivable claimable by anyone.

## Counterevidence and ambiguity

The migration page explicitly and accurately documents the implementation:
there is "no on-chain time check," the window is enforced only when someone
claims, and merchants effectively have until the first claim transaction
(`packages/app/app/docs/migration/page.tsx:68-75`).

An existing test also encodes the behavior. It warps to
`REFUND_WINDOW + 1`, refunds one invoice as the merchant, and then verifies
that a batch claim containing that invoice reverts
(`packages/contracts/test/gateway/Claim.t.sol:59-75`).

This is substantial counterevidence against treating the missing check as an
unknown coding accident. It shows the behavior was known and preserved.
However, it does not reconcile the contract NatSpec, threat model, public
quickstart, README, API state model, and UI cutoff. The repository therefore
contains two incompatible invariants: a product-level timestamp cutoff and an
implementation-level first-transaction-wins cutoff.

## Race and impact

The realistic adverse case is a stale or compromised refund delegate whose
authorization outlives the seven-day custody period. When a merchant or any
third party submits the matured permissionless claim, the delegate can submit
a refund for the same invoice. If the refund is ordered first, the complete
escrow returns to the original payer and the merchant claim fails.

Additional observations:

- The attacker cannot redirect funds; `refundTo` is fixed to `inv.paidBy`.
- A malicious customer cannot trigger this without control of an authorized
  refund principal.
- Merchant and admin calls are trusted/privileged behavior; their ability to
  choose a refund is not independently an authorization bypass.
- The delegate's explicit expiry and merchant revocation remain effective
  controls.
- `claim()` is permissionless and the treasury UI exposes matured invoices,
  reducing the practical overlap when operators claim promptly.
- Atomic batch claims can amplify disruption: one invoice refunded first
  causes the entire batch to revert, leaving otherwise valid invoices
  unclaimed until retried without the bad ID.
- No protocol fee is accrued on the winning refund path, matching the designed
  refund accounting.

## Dynamic validation

Executed from `packages/contracts` without source edits:

```text
forge test --match-contract ClaimTest \
  --match-test test_Claim_BatchAtomic_OneBadIdRevertsAll -vvv
Result: 1 passed, 0 failed.
```

This existing regression compiles the production contract, warps beyond
`REFUND_WINDOW`, successfully executes `refundInvoice()`, and proves the
refunded invoice defeats the subsequent claim.

```text
forge test --match-contract RefundTest -vv
Result: 12 passed, 0 failed across matched Refund/PayerRefund suites.
```

The bounded authorization coverage confirms merchant, admin, and a delegate
with `RIGHT_REFUND` can refund, while strangers and delegates lacking the
right revert. Foundry reported a nightly-build warning only; compilation with
Solc 0.8.26 succeeded.

## Severity rationale

**Low.** The finding violates the advertised temporal-finality boundary and
extends the useful lifetime of a privileged refund credential. Exploitation
can deny a merchant an expected matured payout and force the original payer
to receive the escrow. Severity is constrained by the need for a merchant,
admin, or explicitly authorized refund-delegate transaction, the fixed refund
recipient, permissionless claim availability, UI-side cutoff, and explicit
migration documentation of the current behavior.

## Remaining uncertainty

The repository does not state which of the conflicting invariants is
authoritative for mainnet:

1. a hard on-chain refund cutoff at `claimableAt`; or
2. a deliberately soft window where refunds remain possible until claim.

That product decision changes remediation: enforce the timestamp in
`refundInvoice()`, or update all public docs/UI/state naming to describe
claim-driven finality and treat `claimableAt` only as the earliest claim time.

## Validation closure

| ledger row id | instance key | advisory/source | seed anchor | root control | entrypoint/source | sink/control | disposition | counterevidence or proof gap | survives |
|---|---|---|---|---|---|---|---|---|---|
| not provided | `ArcFXGateway.refundInvoice:post-claimableAt` | local discovery candidate AFG-013 | `ArcFXGateway.sol:316` | `ArcFXGateway.sol:316-325` | authorized direct call to `refundInvoice(globalId)` | state change and escrow transfer at `ArcFXGateway.sol:327-335` without `claimableAt` guard | reportable | Migration docs explicitly acknowledge claim-driven enforcement; this lowers severity but conflicts with broader contract/product invariant | yes |

