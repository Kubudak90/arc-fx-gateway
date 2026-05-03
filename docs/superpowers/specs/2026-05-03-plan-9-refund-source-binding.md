# Plan 9 — V9 gateway · refund source binding

**Status:** spec; pre-mainnet bar after audit 2026-05-03 surfaced the V8 refund-source mismatch as a P1.
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-03
**Depends on:** v0.8.1 + Plan 5 Phase 0 + Plan 7 (audit prep — V8 already audit-ready)
**Blocks:** mainnet deployment

---

## Why this is required

V8's `refundInvoice` pulls the merchant's payout-token funds back from `inv.merchant` (the merchant identity wallet that called `registerMerchant`):

```solidity
// ArcFXGatewayV8.sol:400
IERC20(payoutToken).safeTransferFrom(merchant, refundTo, p.merchantPayout);
```

But settlement *delivered* those funds to `merchants[m].payoutAddress` — which can legitimately be a different wallet:

```solidity
// ArcFXGatewayV8.sol:328 + 347
address payoutAddress  = merchants[inv.merchant].payoutAddress;
IERC20(payoutToken).safeTransfer(payoutAddress, toMerchant);
```

Effect: when `payoutAddress != merchant`, refunds break unless the merchant manually moves funds back to the identity wallet *and* approves the gateway. Admin-driven refunds hit the same broken `transferFrom(merchant, ...)`.

This was always wrong; it just hadn't been triggered because every existing merchant happens to use the same wallet for both. Mainnet onboarding will inevitably split these — companies use a multisig for identity and a hot wallet for receivables, or vice versa — and the first such merchant who tries to refund will get `ERC20: transfer amount exceeds balance` (or, worse, an admin-sided force-refund using a manual reconcile workflow).

The audit (`memory/audit_2026-05-03.md`) flagged this as P1. The fix needs a contract change → V9 deploy.

---

## Decision space

Two designs surfaced at audit-review time:

### Option A — Store the actual payout source per invoice (RECOMMENDED)

At settle time, snapshot `merchants[inv.merchant].payoutAddress` into the per-invoice payment record. At refund time, pull from that snapshot.

```solidity
struct InvoicePayment {
    uint256 merchantPayout;
    uint256 fee;
    address payoutSource;   // NEW — frozen at settle time
}
```

```solidity
// settleInvoice
payments[globalId] = InvoicePayment({
    merchantPayout: toMerchant,
    fee:            fee,
    payoutSource:   payoutAddress
});
IERC20(payoutToken).safeTransfer(payoutAddress, toMerchant);

// refundInvoice
IERC20(payoutToken).safeTransferFrom(p.payoutSource, refundTo, p.merchantPayout);
```

**Pros:**
- Refunds work even after the merchant rotates `payoutAddress` post-settle (frozen at settle time).
- No constraint on the merchant identity vs. payout split.
- Per-invoice traceability — auditors can see exactly which wallet held the funds.

**Cons:**
- One extra storage slot per invoice (~20k gas at settle time, one-time).
- Cannot retrofit existing V8 invoices — they live on V8 with the broken refund path.

### Option B — Enforce `payoutAddress == merchant` for refundable merchants

Reject `registerMerchant` / `updatePayoutAddress` when the new payout address differs from the merchant identity. Optionally allow non-refundable merchants with split addresses.

**Pros:**
- Zero contract storage change; minor logic change.
- Cheaper.

**Cons:**
- Constrains every legitimate merchant model that wants split identity vs. operational wallets.
- "Non-refundable merchant" is awkward UX; refunds are a Stripe-baseline expectation.
- Doesn't solve the "merchant rotates payoutAddress mid-flight" edge case.

### Recommendation: Option A

Bake payout source into per-invoice state. The storage cost is trivial; the flexibility is worth it. Most fintech merchants will want the identity/operational split.

---

## V9 contract — diff from V8

`ArcFXGatewayV9.sol` is a near-clone of V8 with three localized changes:

### 1. `InvoicePayment` gains `payoutSource`

```solidity
struct InvoicePayment {
    uint256 merchantPayout;
    uint256 fee;
    address payoutSource;
}
```

### 2. `settleInvoice` writes the snapshot

```solidity
// after the existing fee + payout calculation:
payments[globalId] = InvoicePayment({
    merchantPayout: toMerchant,
    fee:            fee,
    payoutSource:   payoutAddress
});
```

### 3. `refundInvoice` pulls from the snapshot, expanded auth

```solidity
function refundInvoice(bytes32 globalId) external nonReentrant {
    Invoice storage inv = invoices[globalId];
    if (inv.status != InvoiceStatus.Paid) revert InvoiceNotRefundable(globalId);

    InvoicePayment memory p = payments[globalId];

    // Either the merchant identity, the payout source (the wallet that
    // actually has the funds), or admin can refund.
    if (msg.sender != inv.merchant
        && msg.sender != p.payoutSource
        && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
        revert NotMerchant();
    }

    address payoutToken = inv.payoutToken;
    address refundTo    = inv.paidBy;

    if (protocolFeesAccrued[payoutToken] < p.fee) {
        revert InsufficientFeesForRefund(p.fee, protocolFeesAccrued[payoutToken]);
    }

    inv.status = InvoiceStatus.Refunded;
    protocolFeesAccrued[payoutToken] -= p.fee;
    delete payments[globalId];

    // Pull the merchant payout back from where it landed at settle.
    IERC20(payoutToken).safeTransferFrom(p.payoutSource, refundTo, p.merchantPayout);

    // Return the protocol fee to the merchant identity (preserves V8's
    // "merchant identity controls fee accrual" semantics).
    if (p.fee > 0) {
        IERC20(payoutToken).safeTransfer(inv.merchant, p.fee);
    }

    emit InvoiceRefunded(globalId, refundTo, payoutToken, p.merchantPayout, p.fee);
}
```

Everything else — token whitelist, merchant lifecycle, invoice lifecycle, permissions, `recordPayerRefund`, `withdrawFees`, delegate flow — copies V8 verbatim.

### Decisions baked in

- **Payout source is frozen at settle time, not invoice-create time.** Rationale: a merchant can rotate `payoutAddress` between create and settle (rare but possible); we want refund to go back to where the money actually landed.
- **Fee leg returns to `inv.merchant`, not `payoutSource`.** Rationale: matches V8 semantics. The merchant identity is the protocol-economics anchor; the payout address is just an operational receiver.
- **Auth expanded to include `payoutSource`.** Rationale: if merchant identity is a slow multisig, the operational payout wallet — which holds the funds — should be able to push a refund without round-tripping the multisig.

---

## Migration plan

Existing surface:
- **V6 gateway** (`0x7c1137…b7a3`) — legacy, indexed for read; no new traffic since v0.8 cutover.
- **V8 gateway** (`0x6fAaD9…507a8`) — current canonical. Fully audit-ready, 100% test coverage.
- **V9 gateway** — new canonical post-deploy.

### Step-by-step

1. **Spec audit** of V9 diff against V8. The diff is small (~20 lines) — Slither + Mythril CI catches the regression candidates; new `payoutSource` storage and auth check get unit + invariant tests.
2. **Deploy V9** via `script/DeployV9.s.sol` against Arc Testnet. Verify on Arcscan with `--verify`. Capture `cast receipt` + `cast code` ground truth.
3. **Whitelist tokens** on V9 — owner calls `setTokenSupport(USDC)`, `setTokenSupport(EURC)` to seed the active set.
4. **Indexer**: extend `GATEWAYS` array in `ops/indexer/run.ts` to triple-watch (V6 + V8 + V9). Existing pattern; one env var + array push.
5. **App env**: add `GATEWAY_ADDRESS_V9`. `/api/invoices?engine=v9` becomes the default for new invoices. v8 stays available as `?engine=v8` for testing.
6. **Dashboard prompt**: existing merchants see "Activate V9" CTA at `/m/dashboard` until they call `registerMerchant` on V9. Card explains: "V9 fixes refund support for merchants whose payout wallet differs from their identity wallet."
7. **Smoke**: full pay + refund cycle on V9 with a deliberate `payoutAddress != merchant` configuration. Compare against the same scenario on V8 (which should fail at refund time, demonstrating the fix's necessity).
8. **Mark V8 deprecated** for new traffic — landing brief + footer + docs/migration.mdx updated. V8 invoices in flight (paid but not refunded) stay refundable on V8; we accept the existing limitation for that legacy set.

### Existing V8 invoices — what happens to their refunds?

Two cohorts:

- **Refundable on V8 (no audit issue triggered)**: merchant identity == payout address. V8 `refundInvoice` works as-is. No migration needed.
- **Refundable on V8 (audit issue triggered)**: merchant identity != payout address. V8 refund will revert. Workaround: admin-driven manual reconcile — admin grants the merchant a temporary allowance against the gateway, merchant transfers funds from payout wallet to merchant identity wallet, then the merchant approves the gateway, then `refundInvoice` works. Document this in `docs/audit/legacy-refund-procedure.md` if any such case arises.

In practice on testnet today: every merchant uses identity == payout (we haven't onboarded a split case yet), so V8 in-flight invoices stay refundable cleanly.

---

## App + indexer surface changes

### `ops/indexer/run.ts`

```ts
const GATEWAY_V6 = process.env.GATEWAY_ADDRESS;
const GATEWAY_V8 = process.env.GATEWAY_ADDRESS_V8;
const GATEWAY_V9 = process.env.GATEWAY_ADDRESS_V9;
const GATEWAYS = [GATEWAY_V6, GATEWAY_V8, GATEWAY_V9].filter(Boolean);
```

Event ABI compatibility: `InvoicePaid` and `InvoiceRefunded` shapes are unchanged in V9, so the indexer's existing decoder works. The new `payoutSource` lives in storage — readable via direct contract call when needed, not emitted in any new event. (We could add a `SettlementSource` event for forensic clarity; cheap to add at settle time.)

### `packages/app/app/api/invoices/route.ts`

```ts
const engine = new URL(req.url).searchParams.get("engine") ?? "v9";
const targetGateway: Address =
  engine === "v9" ? GATEWAY_V9 :
  engine === "v8" ? GATEWAY_V8 :
  GATEWAY;
```

Default `v9`. Older `engine=v8` and `engine=v6` paths preserved for testing + legacy traffic.

### `packages/app/components/merchant/CreateInvoiceDialog.tsx`

Already uses `?engine=v8` after audit-fix commit. Bump to `?engine=v9` once V9 is live.

### Dashboard

New `<MerchantV9ActivationCard />` shown when:
- Merchant exists on V8
- Merchant does NOT exist on V9

Card calls `registerMerchant` on V9 contract via the user's wallet. Once successful, card disappears.

### Relayer

`ops/relayer/run.ts` needs to know which gateway to call `settleInvoice` against per row. Add `gateway` column to `relayer_queue` (which gateway address); or look it up from `invoices.metadata.engine`.

The simpler path: store `gatewayAddress` on the invoice row at create time, and the relayer reads it. Migration: add `invoices.gateway_address` column; backfill existing rows from `metadata.engine`.

---

## Testing plan

### Foundry

Port `test/ArcFXGatewayV8.t.sol` → `test/ArcFXGatewayV9.t.sol`. Most cases unchanged. New cases that need to be added:

1. `test_RefundInvoice_PullsFromPayoutSource_NotMerchant` — happy path with `payoutAddress != merchant`. Settle → fund the *payout* wallet (not merchant) → approve → refund → assert the customer received funds and the merchant payout was debited from the payout wallet.
2. `test_RefundInvoice_AuthorizedByPayoutSource` — payoutSource wallet (not merchant) calls `refundInvoice`. Should succeed.
3. `test_RefundInvoice_FrozenAfterPayoutAddressRotation` — settle with payoutAddress=A. Merchant rotates to payoutAddress=B. Refund must still pull from A (frozen at settle).
4. `test_SettleInvoice_StoresPayoutSource` — assert `payments[globalId].payoutSource == merchants[m].payoutAddress` after settle.
5. Full V8 test suite carries over with `payoutAddress == merchant` baseline.

Target: ≥ 49 tests (V8 baseline) + 4 new = 53. Coverage gate floor stays at 95/90; expect 100/100 on V9 like V8.

### Vitest

`/api/invoices` route test gets a new `engine=v9` happy path. Existing `engine=v8` and unparameterized cases preserved.

### Live smoke (Arc testnet)

1. Deploy V9 + verify on Arcscan.
2. Whitelist USDC + EURC.
3. Register merchant on V9 with `payoutAddress = different wallet from identity`.
4. Create invoice (engine=v9), pay via Permit2.
5. Verify settle delivered funds to payout wallet.
6. Approve gateway from payout wallet, call `refundInvoice` from merchant identity wallet.
7. Verify customer received refund, fee returned to merchant identity, payout wallet was debited.
8. Repeat (3-7) on V8 with the same split — refund should revert. This is the "demonstrate the bug fixed" pass.

---

## Effort

| Phase | Time |
|---|---|
| Spec review + open-question pin-down | 0.5 day |
| `ArcFXGatewayV9.sol` (diff from V8) + ports | 0.5 day |
| Foundry tests (port + 4 new) | 0.5 day |
| `script/DeployV9.s.sol` + verify | 0.5 day |
| Indexer triple-watch + `invoices.gateway_address` migration | 0.5 day |
| App: `?engine=v9` default + `<MerchantV9ActivationCard />` | 0.5 day |
| Smoke (positive + V8-fails comparison) | 0.5 day |
| Brief + docs/migration update | 0.5 day |
| **Total** | **~3.5 days, $0 dev cost** |

External audit pass on the V9 diff is a nice-to-have but not blocking — the diff is small enough that the existing audit-prep work (Plan 7) plus diff-focused review is reasonable. If the firm engagement on Plan 7's trigger has lit by the time V9 ships, fold the V9 review into the same engagement.

---

## Open questions

1. **Should `payoutSource` be settable post-settle by the merchant?** E.g., merchant says "I want to refund from a different wallet now." Answer: no, frozen at settle. Refunds undo settlement; the source must be where settle deposited.
2. **Add a `SettlementSource` event for forensic clarity?** Worth ~5k gas at settle. Probably yes — indexer can write it to the `invoices` row for explicit auditability rather than reading storage at refund time.
3. **Should we sunset V8 forcibly at some point?** Once mainnet ramps and no in-flight V8 invoices exist (DB query: `count(*) where status='paid' and gateway='V8'`), revoke V8 admin role + pause it permanently. Until then, dual-watch indefinitely.
4. **Migration timing relative to mainnet T-0?** Best done before — V9 is a contract change, easier to coordinate testnet first with audited diff, then carry to mainnet as the canonical.

---

## Decision log (settled 2026-05-03)

- ✅ Option A (store actual payout source per invoice). Storage cost trivial, flexibility worth it.
- ✅ Frozen at settle time, not invoice-create time.
- ✅ Fee leg returns to `inv.merchant` (preserves V8 semantics).
- ✅ Auth expanded to include `p.payoutSource` so operational wallets can refund without merchant identity round-trip.
- ✅ Indexer triple-watches V6 + V8 + V9.
- ✅ V8 stays alive for legacy invoice reads + in-flight refunds; deprecated for new traffic.
- ❌ Option B (enforce `payoutAddress == merchant`) — too restrictive for real merchant models.
- ❌ Retrofitting V8 invoices — not possible without a contract change to V8 (which is also a redeploy); cleaner to draw the line at V9.

---

## When picking this up

1. Re-read `memory/audit_2026-05-03.md` and the current state of V8 deployment + V8 in-flight refund cohort (DB query `select count(*) from invoices where status='paid' and gateway_address = ${V8}`).
2. Verify nothing's drifted in `ArcFXGatewayV8.sol` since the spec was written; the diff for V9 is from V8 as it currently stands.
3. Start in `packages/contracts/src/ArcFXGatewayV9.sol`. Copy V8, apply the three localized changes documented above.
4. Foundry tests next. `test/ArcFXGatewayV9.t.sol` ports V8 + adds 4 new cases.
5. Then deploy script, indexer wiring, app changes. Smoke last.
6. Before flipping the dashboard default to `?engine=v9`, confirm Arcscan verification + 24h of dual-watch indexer with no event-decoding errors.
