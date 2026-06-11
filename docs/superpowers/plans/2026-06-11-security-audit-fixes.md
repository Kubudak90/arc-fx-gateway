# Security Audit Fixes (2026-06-11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-06-11 pre-public-launch security audit: identity/secret leaks around the public repo, the V12 contract fee/refund flaws (ships as V13), app API hardening, SDK key-safety + webhook verification, and ops/VPS drift.

**Architecture:** Six independent phases. Phase 0 is manual/identity surgery (no code). Phase 1 redeploys the gateway as V13 with the decided fee model. Phases 2–5 are TypeScript/Solidity/shell fixes in-repo. Phase 6 re-publishes everything. Each phase is independently executable and shippable.

**Tech Stack:** Foundry (forge) for contracts, Next.js App Router + Drizzle + Supabase for the app, tsup-built npm SDKs, systemd + Vault + cron on the VPS (194.163.136.1), Vercel for deploy.

**Decisions locked in (user, 2026-06-11):**
1. **Fee model:** protocol fee is ONLY the 0.30% taken at `claim`. Settlement excess (`grossPayout − amountOut`) goes INTO escrow (merchant-favoring); `protocolFeesAccrued += excess` at settle is removed. Escrow holds `grossPayout`; claim fee is computed on the full escrow amount. Refund returns the full escrow (gross) to the payer.
2. **Refund window:** enforced on-chain. `refundInvoice` reverts with `RefundWindowExpired` once `block.timestamp > escrow.claimableAt`.

**Repo root for all paths below:** `/Users/huseyinarslan/Desktop/arcorapay/arcorapay`

**Conventions:**
- Run contract tests from `packages/contracts`: `forge test --match-path 'test/gateway/*'`
- Trunk branch is `plan-1-protocol` on `origin` (private). NEVER push to `public` from this clone (Task 0.3 removes that remote).
- Commit after every green step: `git add <files> && git commit -m "<type>: <msg>"`

---

## Phase 0 — Identity & secret surgery (manual, no code)

### Task 0.1: Rotate the VPS root password

Password-based SSH is already disabled (verified 2026-06-11: `Permission denied (publickey)` when forcing password auth), but the old password sits in git history of `origin` (commit `253ff6a`) and may be reused on the hosting provider's console.

- [ ] **Step 1: Rotate on the box** (key auth still works):

```bash
ssh root@194.163.136.1 'passwd'   # interactive — user types the new password twice
```

Expected: `passwd: password updated successfully`

- [ ] **Step 2: Verify password SSH is still refused:**

```bash
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password root@194.163.136.1 'echo x'
```

Expected: `Permission denied (publickey).`

- [ ] **Step 3: Rotate the hosting-provider panel password too** (Contabo/whatever console the box came from) — the old VPS password must not match the panel.

- [ ] **Step 4: Remove the plaintext password from `~/.claude/CLAUDE.md`** (replace the credentials block with "key-based auth; password retired 2026-06-11"). User file — edit by hand or let Claude do it on request.

### Task 0.2: Re-author the public snapshot commit (kills the Kubudak90 identity leak)

`public/main` (`8e7773f`) has author+committer `Arcora Labs <95706654+Kubudak90@users.noreply.github.com>`. The email leaks the personal account. Recreate the orphan snapshot with a neutral identity. **Do this AFTER Phases 1–5 land so the refreshed snapshot also carries the fixes** (this task is written here because it pairs with 0.3; execute it as part of Phase 6).

- [ ] **Step 1: Create a clean export** (never reuse this working clone):

```bash
cd /Users/huseyinarslan/Desktop/arcorapay/arcorapay
git archive plan-1-protocol | (mkdir -p /tmp/arcorapay-public && tar -x -C /tmp/arcorapay-public)
```

- [ ] **Step 2: Strip the private paths** (canonical list — must match `docs/superpowers/public-exclusions.txt`; re-read that file first and mirror any additions):

```bash
cd /tmp/arcorapay-public
while IFS= read -r p; do [ -n "$p" ] && rm -rf "./$p"; done < /Users/huseyinarslan/Desktop/arcorapay/arcorapay/docs/superpowers/public-exclusions.txt
ls docs/   # Expected: LITEPAPER.md ROADMAP.md runbooks (crosschain-v2-demo.md only) — NO superpowers/, NO audit/
```

- [ ] **Step 3: Commit with a neutral org identity and force-push from an ORG-authorized credential** (user action — needs org token/account, NOT the Kubudak90 token):

```bash
cd /tmp/arcorapay-public
git init -b main
git add -A
GIT_AUTHOR_NAME="Arcora Labs" GIT_AUTHOR_EMAIL="dev@arcoralabs.xyz" \
GIT_COMMITTER_NAME="Arcora Labs" GIT_COMMITTER_EMAIL="dev@arcoralabs.xyz" \
git commit -m "Initial commit"
git remote add public https://github.com/arcoralabs/arcorapay.git
git push --force public main
```

(If `dev@arcoralabs.xyz` doesn't exist, create an org bot account and use ITS GitHub noreply address — any address NOT containing `Kubudak90`.)

- [ ] **Step 4: Verify on GitHub:**

```bash
git ls-remote public main
git log public/main -1 --format='%an <%ae> / %cn <%ce>'   # must NOT contain Kubudak90
```

### Task 0.3: Remove the `public` remote from the working clone

One reflexive `git push public <branch>` from this clone publishes the full private history (personal email on every commit, the old VPS password in blobs, `docs/audit/` open findings).

- [ ] **Step 1:**

```bash
cd /Users/huseyinarslan/Desktop/arcorapay/arcorapay
git remote remove public
git remote -v   # Expected: only `origin` lines
```

- [ ] **Step 2: Belt-and-suspenders pre-push hook** (blocks any future re-add):

Create `.git/hooks/pre-push` (mode 755):

```bash
#!/usr/bin/env bash
# Refuse pushing private history to the public repo.
if [[ "$2" == *"arcoralabs/arcorapay"* ]]; then
  echo "BLOCKED: publish via the orphan-snapshot flow (docs/superpowers/plans/2026-06-11-security-audit-fixes.md Task 0.2), never from this clone." >&2
  exit 1
fi
exit 0
```

```bash
chmod 755 .git/hooks/pre-push
```

### Task 0.4: Verify/rotate runtime secrets

- [ ] **Step 1: Compare local vs Vercel prod values** (user has Vercel access):

```bash
cd /Users/huseyinarslan/Desktop/arcorapay/arcorapay/packages/app
vercel env pull /tmp/prod-env --environment=production --yes
for k in MASTER_KEY IRON_SESSION_PASSWORD CRON_SECRET; do
  l=$(grep "^$k=" .env | cut -d= -f2); p=$(grep "^$k=" /tmp/prod-env | cut -d= -f2)
  [ "$l" = "$p" ] && echo "$k: SAME (rotate!)" || echo "$k: different (ok)"
done
rm /tmp/prod-env
```

- [ ] **Step 2: If any printed `SAME`:** generate replacements (`openssl rand -base64 32`), set them in Vercel (`vercel env rm <K> production && vercel env add <K> production`), then **re-encrypt DB secrets** that were encrypted under the old `MASTER_KEY` — run the existing re-encryption path (see `packages/app/lib/crypto/secret.ts` callers; webhook secrets and server-wallet keys must be decrypted with the old key and re-encrypted with the new one BEFORE flipping the env var — write a one-off script modeled on `packages/app/scripts/seed-prod-merchant.ts` if none exists). Skip entirely if Step 1 printed all `different`.

- [ ] **Step 3: Rotate the Circle KIT_KEYs** (both `./.env.local` and `ops/relayer/.env` hold live ones) in the Circle developer console; update `ops/relayer/.env` on the VPS (`/opt/arcora-ops/relayer/.env`) and locally; `systemctl restart arcora-relayer`.

- [ ] **Step 4: Defense-in-depth gitignore.** Root `.gitignore` already covers `.env` (verified untracked), but add an explicit line locally too:

```bash
echo ".env" >> packages/app/.gitignore
git -C . check-ignore packages/app/.env && echo OK
```

- [ ] **Step 5: Move the live admin key out of plaintext.** `packages/contracts/.env:17` holds the V12/V13 admin `DEPLOYER_PRIVATE_KEY` unencrypted:

```bash
cast wallet import arcora-admin --interactive   # paste the key once, set a passphrase
```

Then replace `--broadcast` usage with `--account arcora-admin` in deploy commands (Task 1.5 Step 1 becomes `forge script script/Deploy.s.sol --rpc-url "$ARC_TESTNET_RPC_URL" --account arcora-admin --broadcast -vv`), and delete the `DEPLOYER_PRIVATE_KEY` line from `packages/contracts/.env` after the V13 deploy succeeds.

---

## Phase 1 — Contract V13 (fee model + refund window)

**Files:**
- Modify: `packages/contracts/src/ArcFXGateway.sol`
- Modify: `packages/contracts/test/gateway/Settle.t.sol`, `Claim.t.sol`, `Refund.t.sol`, `Fees.t.sol`, `Delegate.t.sol`, `PayerRefund.t.sol`, `AuditCoverage.t.sol`
- Use: `packages/contracts/script/Deploy.s.sol`

### Task 1.1: Settle — excess goes to escrow, not protocol fees

- [ ] **Step 1: Write the failing tests.** In `test/gateway/Settle.t.sol`, replace the existing excess-accrual test (`test_Settle_ExcessAccruesAtSettle` or equivalent — find it with `grep -n "Excess" test/gateway/Settle.t.sol`) with:

```solidity
function test_Settle_ExcessGoesToEscrow_NotFees() public {
    bytes32 g = _settle(bytes32("inv-x1"), 100e6, 105e6);

    (uint256 amt, , ) = gw.escrows(g);
    assertEq(amt, 105e6, "escrow holds the FULL grossPayout (V13 fee model)");
    assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "no fee accrual at settle");
}

function test_Settle_ZeroExcess_EscrowEqualsAmountOut() public {
    bytes32 g = _settle(bytes32("inv-x2"), 100e6, 100e6);
    (uint256 amt, , ) = gw.escrows(g);
    assertEq(amt, 100e6);
    assertEq(gw.protocolFeesAccrued(address(eurc)), 0);
}
```

- [ ] **Step 2: Run to verify failure:**

```bash
cd packages/contracts && forge test --match-test "test_Settle_Excess|test_Settle_ZeroExcess" -vv
```

Expected: FAIL (escrow currently stores `amountOut` and fees accrue).

- [ ] **Step 3: Implement.** In `src/ArcFXGateway.sol` `settleInvoice` (currently ~lines 276–297), change:

```solidity
        address payoutToken = inv.payoutToken;
        IERC20(payoutToken).safeTransferFrom(msg.sender, address(this), grossPayout);

        // V13 fee model: the protocol fee is taken ONLY at claim (PROTOCOL_FEE_BPS
        // on the escrowed amount). Any settlement excess (grossPayout - amountOut)
        // stays in escrow and flows to the merchant at claim / to the payer on
        // refund. Audit 2026-06-11 H1 (double fee accrual).
        uint256 excessToEscrow = grossPayout - inv.amountOut;
        uint64  claimableAt    = uint64(block.timestamp) + REFUND_WINDOW;

        escrows[globalId] = Escrow({
            amount:      grossPayout,
            payoutToken: payoutToken,
            claimableAt: claimableAt
        });

        inv.status = InvoiceStatus.Paid;
        inv.paidBy = payer;

        // Last event arg historically carried the settle-time protocol fee; in
        // V13 it reports the excess routed to escrow (param renamed — same ABI).
        emit InvoicePaid(globalId, payer, amountIn, grossPayout, inv.amountOut, excessToEscrow);
        emit SettlementContext(globalId, payInToken, swapTxHash);
        emit EscrowCreated(globalId, payoutToken, grossPayout, claimableAt);
```

(Removes `protocolFeesAccrued[payoutToken] += excess;`, stores `grossPayout`, caches `claimableAt` — also fixes the audit's M3 re-read note.) Rename the last `InvoicePaid` event parameter from `fee` to `excessToEscrow` in the event declaration (parameter names don't change the event topic — ABI-compatible).

- [ ] **Step 4: Run the two tests again — expect PASS.** The rest of the suite will be red until Tasks 1.2–1.3 — that's expected; don't commit yet.

### Task 1.2: Claim — single 0.30% fee on the full escrow

- [ ] **Step 1: Update/extend claim tests.** In `test/gateway/Claim.t.sol`, fix the split test to the V13 numbers and add the excess case:

```solidity
function test_Claim_PermissionlessAfterWindow_SplitsCorrectly() public {
    bytes32 g = _settle(bytes32("inv-2"), 100e6, 100e6);
    vm.warp(block.timestamp + REFUND_WINDOW + 1);

    bytes32[] memory ids = new bytes32[](1);
    ids[0] = g;
    vm.prank(makeAddr("anyone"));
    gw.claim(ids);

    uint256 fee = (100e6 * FEE_BPS) / 10_000;             // 0.30 EURC
    assertEq(eurc.balanceOf(payee), 100e6 - fee, "merchant gets gross - 0.3%");
    assertEq(gw.protocolFeesAccrued(address(eurc)), fee, "exactly ONE fee accrued");
}

function test_Claim_WithExcess_FeeOnGross_NoDoubleDip() public {
    bytes32 g = _settle(bytes32("inv-2b"), 100e6, 105e6);
    vm.warp(block.timestamp + REFUND_WINDOW + 1);

    bytes32[] memory ids = new bytes32[](1);
    ids[0] = g;
    gw.claim(ids);

    uint256 fee = (105e6 * FEE_BPS) / 10_000;
    assertEq(eurc.balanceOf(payee), 105e6 - fee, "merchant gets full gross minus one fee");
    assertEq(gw.protocolFeesAccrued(address(eurc)), fee, "total protocol take == one bps fee, nothing from settle");
}
```

- [ ] **Step 2: Run:** `forge test --match-path test/gateway/Claim.t.sol -vv` — the `claim()` body needs NO change (`fee = (e.amount * PROTOCOL_FEE_BPS) / 10_000` is already computed on the escrow amount, which now holds gross). Expected: PASS after Task 1.1's contract change. If `Fees.t.sol` asserts settle-time accrual, update those assertions to claim-time-only now (`grep -n "protocolFeesAccrued" test/gateway/Fees.t.sol`).

### Task 1.3: Refund — enforce the window, return the full pot

- [ ] **Step 1: Tests.** In `test/gateway/Refund.t.sol`, update `test_Refund_DoesNotTouchExcess` and add the window tests:

```solidity
function test_Refund_ReturnsFullGross_IncludingExcess() public {
    bytes32 g = _settle(bytes32("inv-2"), 100e6, 105e6);

    vm.prank(merchant);
    gw.refundInvoice(g);

    assertEq(eurc.balanceOf(customer), 105e6, "payer gets the full escrowed gross");
    assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "protocol takes nothing on refund");
}

function test_Refund_AfterWindow_Reverts() public {
    bytes32 g = _settle(bytes32("inv-w1"), 100e6, 100e6);
    vm.warp(block.timestamp + REFUND_WINDOW + 1);

    vm.prank(merchant);
    vm.expectRevert(abi.encodeWithSignature("RefundWindowExpired(bytes32)", g));
    gw.refundInvoice(g);
}

function test_Refund_AtWindowBoundary_Succeeds() public {
    bytes32 g = _settle(bytes32("inv-w2"), 100e6, 100e6);
    (, , uint64 claimableAt) = gw.escrows(g);
    vm.warp(claimableAt);   // last second of the window

    vm.prank(merchant);
    gw.refundInvoice(g);
    assertEq(eurc.balanceOf(customer), 100e6);
}
```

- [ ] **Step 2: Run — expect the two new window tests to FAIL** (no such error yet):

```bash
forge test --match-test "test_Refund_AfterWindow|test_Refund_AtWindowBoundary|test_Refund_ReturnsFullGross" -vv
```

- [ ] **Step 3: Implement.** In `refundInvoice` (~line 316), add the error and the check:

```solidity
    error RefundWindowExpired(bytes32 globalId);
```

(next to `InvoiceNotRefundable` — find with `grep -n "InvoiceNotRefundable" src/ArcFXGateway.sol`), and inside the function after the auth block:

```solidity
        Escrow memory e = escrows[globalId];
        // V13: the 7-day refund guarantee is enforced on-chain. After the
        // window the escrow belongs to the claim path; late refunds happen
        // off-chain from the merchant's own wallet. Audit 2026-06-11 H2.
        if (block.timestamp > e.claimableAt) revert RefundWindowExpired(globalId);
        address refundTo = inv.paidBy;
```

- [ ] **Step 4: Run the Refund suite — expect PASS:** `forge test --match-path test/gateway/Refund.t.sol -vv`

- [ ] **Step 5: Commit Tasks 1.1–1.3 together** (they form one coherent fee-model change):

```bash
git add src/ArcFXGateway.sol test/gateway/Settle.t.sol test/gateway/Claim.t.sol test/gateway/Refund.t.sol test/gateway/Fees.t.sol
git commit -m "fix(contracts)!: V13 fee model — single claim-time fee, escrow holds gross, refund window enforced"
```

### Task 1.4: Small contract hardening (audit L1, L3, L4, M1)

- [ ] **Step 1: Tests** (append to the matching suites):

```solidity
// Delegate.t.sol
function test_AuthorizeDelegate_PastExpiry_Reverts() public {
    vm.prank(merchant);
    vm.expectRevert(abi.encodeWithSignature("InvalidDelegateExpiry()"));
    gw.authorizeDelegate(makeAddr("d"), uint64(block.timestamp - 1), RIGHT_R);
}

function test_CreateInvoiceFor_ExpiredDelegate_Reverts() public {
    address d = makeAddr("d2");
    vm.prank(merchant);
    gw.authorizeDelegate(d, uint64(block.timestamp + 10), RIGHT_CI);
    vm.warp(block.timestamp + 11);   // strictly past expiresAt
    vm.prank(d);
    vm.expectRevert(abi.encodeWithSignature("DelegateNotAuthorized()"));
    gw.createInvoiceFor(merchant, bytes32("d-inv"), address(usdc), 1e6, uint64(block.timestamp + 1 hours));
}

// Settle.t.sol (zero amount now rejected at creation)
function test_CreateInvoice_ZeroAmount_Reverts() public {
    vm.prank(merchant);
    vm.expectRevert(abi.encodeWithSignature("InvalidAmount()"));
    gw.createInvoice(bytes32("z"), address(usdc), 0, uint64(block.timestamp + 1 hours));
}

// PayerRefund.t.sol
function test_RecordPayerRefund_WrongPayInToken_Reverts() public {
    bytes32 g = _createInvoice(bytes32("pr-1"), 100e6, 1 hours);
    vm.prank(relayer);
    vm.expectRevert(abi.encodeWithSignature("InvalidPayInToken()"));
    gw.recordPayerRefund(g, customer, address(eurc), 100e6, bytes32("r"));
}
```

- [ ] **Step 2: Run — expect 4 FAILs.** `forge test --match-test "PastExpiry|ExpiredDelegate|ZeroAmount|WrongPayInToken" -vv`

- [ ] **Step 3: Implement** in `src/ArcFXGateway.sol`:

```solidity
    error InvalidDelegateExpiry();
    error InvalidAmount();
```

In `authorizeDelegate` (~line 226), after the rights check:

```solidity
        if (expiresAt <= block.timestamp) revert InvalidDelegateExpiry();
```

In `createInvoiceFor` (~line 195), standardize the boundary to match `refundInvoice` (M1):

```solidity
        if (d.expiresAt < block.timestamp)  revert DelegateNotAuthorized();
```
becomes
```solidity
        if (block.timestamp > d.expiresAt)  revert DelegateNotAuthorized();
```
(equivalent at runtime; while here, confirm both paths treat `expiresAt == block.timestamp` as VALID — refund uses `d.expiresAt >= block.timestamp`, so this is now consistent and documented).

In `_createInvoice` (~line 200), first line of the body:

```solidity
        if (amountOut == 0) revert InvalidAmount();
```

In `recordPayerRefund` (~line 437), after the status checks:

```solidity
        if (payInToken != inv.payIn) revert InvalidPayInToken();
```

- [ ] **Step 4: Run — expect PASS, then full suite:**

```bash
forge test --match-path 'test/gateway/*'
```

Expected: ALL tests pass (if `AuditCoverage.t.sol` pins old fee numbers, update its assertions to the V13 model the same way as Task 1.2).

- [ ] **Step 5: Commit:** `git commit -am "fix(contracts): delegate expiry validation, zero-amount reject, payInToken check in recordPayerRefund"`

### Task 1.5: Deploy V13 to Arc testnet + rollout

- [ ] **Step 1: Deploy** (uses `packages/contracts/.env` — `DEPLOYER_PRIVATE_KEY` is the current admin):

```bash
cd packages/contracts
forge script script/Deploy.s.sol --rpc-url "$ARC_TESTNET_RPC_URL" --broadcast -vv
```

Record the new gateway address (call it `<V13_ADDR>` below). Verify constructor wiring in the broadcast log: feeBps=30, refundWindow=604800, adminRecoveryDelay=604800, owner+relayer as configured in `Deploy.s.sol`.

- [ ] **Step 2: Post-deploy on-chain setup** (mirror what `Deploy.s.sol` doesn't do — check the script body first; anything it already does, skip):
  - `setTokenSupport(<USDC>, true)` and `setTokenSupport(<EURC>, true)` from the admin.
  - Re-register the production merchant(s) (`registerMerchant`) — V13 state is empty.
  - Re-authorize the app's server wallet as delegate (`authorizeDelegate(serverWallet, <expiry>, RIGHT_CREATE_INVOICE)`) — without this, invoice creation 412s (`delegate_not_authorized`); see `packages/app/scripts/seed-prod-merchant.ts` which automates merchant+delegate setup.

- [ ] **Step 3: Update addresses everywhere:**
  - Vercel app env: `GATEWAY_ADDRESS` and `NEXT_PUBLIC_GATEWAY_ADDRESS` → `<V13_ADDR>` (production env, then redeploy in Phase 6).
  - VPS `/opt/arcora-ops/relayer/.env`: `GATEWAY_ADDRESS=<V13_ADDR>`; restart `arcora-relayer`.
  - VPS indexer env: add `GATEWAY_ADDRESS_V13=<V13_ADDR>` alongside the V10/V11 entries (keep old ones so historical invoices still resolve); restart `arcora-indexer`. Check `ops/indexer/run.ts` for how versions are wired (`grep -n "GATEWAY_ADDRESS_V1" ops/indexer/run.ts ops/indexer/.env.example`).
  - Repo `.env.example` files: same three updates so examples track reality.

- [ ] **Step 4: Indexer fee semantics.** The `InvoicePaid` last arg is now excess-to-escrow, and the real protocol fee arrives in `InvoiceClaimed.fee`. Find the mapping:

```bash
grep -n "InvoicePaid\|protocolFee\|merchantPayout" ops/indexer/run.ts | head -20
```

Change the V13 handler so `invoices.protocolFee` is written from `InvoiceClaimed.fee` (claim handler) and NOT from `InvoicePaid`'s last arg; `merchantPayout` from `InvoiceClaimed.toMerchant`. Keep V10–V12 handlers untouched (old semantics for old addresses). Run `cd ops/indexer && pnpm test` (or `npx vitest run` if no script) — expected: green.

- [ ] **Step 5: E2E smoke on testnet** (repeat what the user did manually on V12): create an invoice via the dashboard, pay it, verify settle lands on `<V13_ADDR>`, then refund a second invoice within the window and verify the payer's balance. Also verify a refund attempt AFTER warp isn't possible in prod — skip on live chain; the Foundry test covers it.

- [ ] **Step 6: Commit env-example/docs changes:** `git commit -am "chore: V13 gateway rollout — addresses, indexer fee mapping"`

---

## Phase 2 — App API hardening (`packages/app`)

### Task 2.1: CSRF — fail closed + content-type gate

**Files:** Modify `lib/security/csrf.ts`, `app/api/auth/logout/route.ts`; touch every `isSameOrigin` call site.

- [ ] **Step 1: Rewrite `lib/security/csrf.ts`:**

```typescript
import type { NextRequest } from "next/server";

/**
 * CSRF defence for state-changing, cookie-authenticated routes.
 *
 * V2 (audit 2026-06-11 CRIT-1): fail CLOSED when neither Origin nor Referer is
 * present. Browsers stamp Origin on every fetch/XHR/form POST, so a legitimate
 * dashboard request always carries it. Header-less mutations are curl /
 * server-to-server — those callers must use an API key (no ambient cookie),
 * not the session cookie, so rejecting them here costs nothing.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return false;

  const base = process.env.PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL;
  let expected: string | null = null;
  if (base) {
    try { expected = new URL(base).origin; } catch { expected = null; }
  }
  if (!expected) return process.env.NODE_ENV !== "production";

  if (origin) return origin === expected;
  try { return new URL(referer!).origin === expected; } catch { return false; }
}

/**
 * Defence-in-depth: browsers cannot send Content-Type: application/json
 * cross-origin without a CORS preflight. Form posts are x-www-form-urlencoded.
 * Call at the top of every cookie-authed mutation handler.
 */
export function isJsonContentType(req: NextRequest): boolean {
  const ct = req.headers.get("content-type") ?? "";
  return ct.split(";")[0].trim().toLowerCase() === "application/json";
}
```

- [ ] **Step 2: Apply the JSON gate.** List the call sites:

```bash
grep -rln "isSameOrigin" packages/app/app/api
```

Expected sites: `auth/siwe/nonce`, `auth/siwe/verify`, `merchant/bootstrap`, `merchant/api-key`, `merchant/webhook`, `merchant/origins`, `merchant/payout-token` (+ any others the grep shows). In each handler that parses a JSON body, directly after the `isSameOrigin` check add:

```typescript
  if (!isJsonContentType(req)) {
    return NextResponse.json({ error: "unsupported_content_type" }, { status: 415 });
  }
```

(For handlers with no body — e.g. POST api-key rotate — the gate is optional; add it anyway for uniformity, the dashboard always sends the header.)

- [ ] **Step 3: De-duplicate logout.** In `app/api/auth/logout/route.ts`, delete the local Origin/Referer block (lines ~17–28) and replace with the shared import:

```typescript
import { isSameOrigin } from "@/lib/security/csrf";
// ...
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "csrf" }, { status: 403 });
  }
```

- [ ] **Step 4: Update the dashboard if any fetch omits the header.** `grep -rn "method: \"POST\"\|method: \"PATCH\"" packages/app/app packages/app/components | grep -v api/` — every dashboard mutation fetch must send `"content-type": "application/json"` (most already do; fix any that don't).

- [ ] **Step 5: Verify:** `cd packages/app && pnpm typecheck && pnpm test` (run whatever `package.json` defines; at minimum `npx tsc --noEmit`). Manual check: log into the local dashboard, rotate the API key — works; `curl -X POST http://localhost:3000/api/merchant/api-key -H "Cookie: <session>"` (no Origin) — expect 403.

- [ ] **Step 6: Commit:** `git commit -am "fix(app): CSRF fail-closed + JSON content-type gate on cookie-auth mutations"`

### Task 2.2: `Cache-Control: no-store` on authenticated responses

**Files:** Create `lib/security/respond.ts`; modify the authed merchant/invoice routes.

- [ ] **Step 1: Create `packages/app/lib/security/respond.ts`:**

```typescript
import { NextResponse } from "next/server";

/** JSON response for authenticated data — never cacheable (audit 2026-06-11 HIGH-3). */
export function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
```

- [ ] **Step 2: Apply.** In these routes, replace `NextResponse.json(...)` with `privateJson(...)` for every authenticated success/error response (NOT the public checkout/status payloads, which already set their own headers):
  - `app/api/merchant/route.ts`
  - `app/api/merchant/escrows/route.ts`
  - `app/api/merchant/compliance/route.ts`
  - `app/api/merchant/treasury/route.ts`
  - `app/api/merchant/webhook/route.ts`, `api-key/route.ts`, `bootstrap/route.ts`, `origins/route.ts`, `payout-token/route.ts`
  - `app/api/invoices/[id]/route.ts` (the API-key-authed merchant view)

- [ ] **Step 3: Verify:** `curl -sD- http://localhost:3000/api/merchant -H "Cookie: <session>" | grep -i cache-control` → `no-store, private`. Typecheck green.

- [ ] **Step 4: Commit:** `git commit -am "fix(app): no-store on all authenticated API responses"`

### Task 2.3: Status token — header only

**Files:** Modify `app/api/checkout/status/[id]/route.ts` (+ the crosschain variant `app/api/checkout/crosschain/status/[id]/route.ts` if it mirrors the pattern — check with grep) and the hosted checkout poller.

- [ ] **Step 1: Find the poller:** `grep -rn "x-status-token\|?token=" packages/app/app packages/app/components packages/app/lib | grep -v api/` — note which client component appends `?token=`.

- [ ] **Step 2: In the route(s), drop the query-string channel** (line ~63):

```typescript
  // Audit 2026-06-11 HIGH-4: header-only — query strings end up in access logs.
  const presented = req.headers.get("x-status-token");
```

- [ ] **Step 3: Update the poller component** to send the token via header:

```typescript
  fetch(`/api/checkout/status/${id}`, { headers: { "x-status-token": token } })
```

- [ ] **Step 4: Manual verify:** hosted checkout still shows live status during a test payment (poller works); `curl ".../api/checkout/status/<id>?token=<tok>"` now returns the bare-status payload only.

- [ ] **Step 5: Commit:** `git commit -am "fix(app): status token accepted via header only"`

### Task 2.4: Exact USDC base-unit conversion

**Files:** Modify `app/api/invoices/route.ts:272`; `packages/app/package.json` already depends on `@arcora/crosschain-core` (verify: `grep crosschain-core packages/app/package.json` — if absent, `pnpm --filter app add @arcora/crosschain-core@workspace:*`).

- [ ] **Step 1: Write the failing test** (place beside existing app tests — `ls packages/app/**/*.test.ts` to find the convention; if the app has no test runner, do this as a unit test in `crosschain-core` instead, which has one):

```typescript
import { parseBaseUnits } from "@arcora/crosschain-core";

test("amountUsdc float artifacts do not corrupt base units", () => {
  for (const [usd, expected] of [["4.50", 4_500_000n], ["10.99", 10_990_000n], ["0.000001", 1n], ["1005.55", 1_005_550_000n]] as const) {
    expect(parseBaseUnits(usd, 6)).toBe(expected);
  }
});
```

- [ ] **Step 2: In `app/api/invoices/route.ts` replace line 272:**

```typescript
  const amountOut = parseBaseUnits(amountUsdc.toFixed(6), 6);
```

with import `import { parseBaseUnits } from "@arcora/crosschain-core";`. (`amountUsdc` is already Zod-validated as a positive finite number ≤ 1,000,000, so `toFixed(6)` is total and exact to the unit we charge.)

- [ ] **Step 3: Run tests + typecheck — green. Commit:** `git commit -am "fix(app): exact string-based USDC base-unit conversion"`

### Task 2.5: `RELAYER_ADDRESS` server env (drop `NEXT_PUBLIC_` coupling)

**Files:** Modify `app/api/checkout/submit/route.ts:71`, `app/api/checkout/crosschain/prepare/route.ts:79`, `.env.example`; Vercel env.

- [ ] **Step 1: In both routes:**

```typescript
const RELAYER_ADDRESS = (process.env.RELAYER_ADDRESS ?? process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "") as Address;
```

(Fallback keeps current deploys working until the env var lands; the comment should say the fallback dies at mainnet.)

- [ ] **Step 2:** Add `RELAYER_ADDRESS=` to `packages/app/.env.example` (server section) with a comment that `NEXT_PUBLIC_RELAYER_ADDRESS` is for client display only. Add the var in Vercel production env with the relayer's address.

- [ ] **Step 3: Typecheck + commit:** `git commit -am "fix(app): server-side RELAYER_ADDRESS env, NEXT_PUBLIC_ for display only"`

### Task 2.6: Publishable-key rotation endpoint

**Files:** Modify `app/api/merchant/api-key/route.ts` (or create `app/api/merchant/publishable-key/route.ts` — match how api-key rotation is built; read that file first and mirror it).

- [ ] **Step 1: Read `app/api/merchant/api-key/route.ts`** and note: session auth guard, `isSameOrigin` + JSON gate (from Task 2.1), key generation helper in `lib/auth/apikey.ts`.

- [ ] **Step 2: Create `app/api/merchant/publishable-key/route.ts`:**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/csrf";
import { privateJson } from "@/lib/security/respond";
import { getSessionMerchant } from "@/lib/auth/session";        // ← match the import the api-key route uses
import { db } from "@/lib/db";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "csrf" }, { status: 403 });
  const merchant = await getSessionMerchant(req);
  if (!merchant) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Same format as the lazy-mint in GET /api/merchant — keep in sync.
  const key = `pk_live_${randomBytes(24).toString("base64url")}`;
  await db.update(merchants)
    .set({ publishableKey: key, publishableKeyPrefix: key.slice(0, 16) })
    .where(eq(merchants.id, merchant.id));

  return privateJson({ publishableKey: key }, { status: 201 });
}
```

**Important:** before writing this, copy the exact session-helper name, db import paths, and pk generation format from the existing `GET /api/merchant` lazy-mint (Task says "same format" — `grep -n "pk_live_" packages/app -r` and reuse that exact generator if it's a shared helper). Old key stops working immediately because lookup is by full-key equality.

- [ ] **Step 3:** Add a "Rotate publishable key" button in the dashboard settings page next to the existing secret-key rotate (find it: `grep -rn "api-key" packages/app/app/m packages/app/components | grep -i rotate`).

- [ ] **Step 4: Manual verify:** rotate pk in dashboard; old pk_ rejected on `POST /api/invoices` (origin-bound create), new one accepted. Commit: `git commit -am "feat(app): publishable key rotation"`

### Task 2.7: Cheap-reject before bcrypt (API-key DoS)

**Files:** Modify `lib/auth/apikey.ts`.

- [ ] **Step 1: Read `lib/auth/apikey.ts`** (`lookupMerchantByApiKey`). It bcrypt-compares per request.

- [ ] **Step 2: Add fast pre-checks before any bcrypt call:**

```typescript
  // Audit 2026-06-11 MED-4: reject garbage before bcrypt. Real keys are
  // `ak_live_` + 32 base64url chars; anything else costs O(1), not a hash.
  if (!/^ak_(live|test)_[A-Za-z0-9_-]{20,64}$/.test(presentedKey)) return null;
```

and ensure the lookup narrows by the stored `apiKeyPrefix` column FIRST (indexed equality) so bcrypt runs against at most one row — read the current implementation; if it already prefix-narrows, just add the regex gate.

- [ ] **Step 3:** Add the shared per-IP rate limit to `GET /api/invoices/[id]` — same helper the other routes use (`grep -rn "rateLimit" packages/app/app/api/checkout/submit/route.ts` and copy that exact pattern, 30 req/60s).

- [ ] **Step 4: Typecheck + commit:** `git commit -am "fix(app): cheap-reject malformed API keys before bcrypt; rate-limit invoice reads"`

### Task 2.8: Crosschain prepare — compliance outage parity

**Files:** Modify `app/api/checkout/crosschain/prepare/route.ts` (~lines 59–77).

- [ ] **Step 1:** Wrap `screenWithAudit` in the same try/catch the authorize route uses (`grep -n -A12 "screenWithAudit" app/api/checkout/authorize/route.ts` and copy the catch block verbatim, including the `COMPLIANCE_FAIL_OPEN_FOR_PAY` env check), so a provider outage behaves identically on both payment paths.

- [ ] **Step 2: Typecheck + commit:** `git commit -am "fix(app): crosschain prepare honors COMPLIANCE_FAIL_OPEN_FOR_PAY like authorize"`

### Task 2.9: CSP — nonce'd scripts, drop `unsafe-inline`

**Files:** Modify `lib/security/headers.ts`, `middleware.ts`, `app/layout.tsx`.

- [ ] **Step 1:** In `middleware.ts`, generate a per-request nonce and pass it via header:

```typescript
  const nonce = crypto.randomUUID().replace(/-/g, "");
  res.headers.set("x-nonce", nonce);
```

and emit the CSP from middleware for HTML routes (move the CSP line out of `next.config.ts`/`headers.ts` static config — static config can't carry a per-request nonce):

```typescript
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",   // styles stay; script injection is the XSS vector that matters
      "img-src 'self' data: https:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
    ].join("; "),
  );
```

(Mirror any extra directives the current `headers.ts` CSP carries — read it first and port them all.)

- [ ] **Step 2:** In `app/layout.tsx`, thread the nonce to Next: read it with `headers()` and pass to any inline `<Script>`/`<script>` you own. Next.js automatically applies the nonce to its own inline runtime scripts when the CSP header contains one.

- [ ] **Step 3: Verify hard:** `pnpm dev`, open the dashboard AND the hosted checkout page with devtools console — zero CSP violations; wallet connect still works. This task has real breakage potential: if RainbowKit/wagmi inject inline scripts without nonce support, fall back to keeping `'unsafe-inline'` ONLY on the marketing routes and nonce on `/m/*` + `/i/*` (split by path in middleware), and document the residual in `KNOWN_ISSUES.md`.

- [ ] **Step 4: Commit:** `git commit -am "fix(app): nonce-based script-src CSP, drop unsafe-inline for scripts"`

---

## Phase 3 — SDK 1.3.0 (`packages/sdk`, `packages/sdk-react`, `packages/demo-merchant`)

### Task 3.1: Hard browser guard for secret keys

**Files:** Modify `packages/sdk/src/client.ts`, `packages/sdk/src/error.ts` (add code if the union lacks it), tests in `packages/sdk/test/`.

- [ ] **Step 1: Failing tests** (match the existing test style — `ls packages/sdk/test/`):

```typescript
import { Arcora } from "../src/client";

describe("browser secret-key guard", () => {
  const g = globalThis as any;
  beforeEach(() => { g.window = {}; });
  afterEach(() => { delete g.window; });

  it("throws for ak_live_ in a browser", () => {
    expect(() => new Arcora({ apiKey: "ak_live_abc123" })).toThrow(/server-side/);
  });
  it("throws for ak_test_ in a browser", () => {
    expect(() => new Arcora({ apiKey: "ak_test_abc123" })).toThrow(/server-side/);
  });
  it("allows pk_live_ in a browser", () => {
    expect(() => new Arcora({ apiKey: "pk_live_abc123" })).not.toThrow();
  });
  it("allows ak_live_ server-side", () => {
    delete g.window;
    expect(() => new Arcora({ apiKey: "ak_live_abc123" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect 2 FAILs** (`cd packages/sdk && pnpm test`).

- [ ] **Step 3: Replace `warnIfSecretKeyInBrowser`** in `src/client.ts` (lines 41–51):

```typescript
// AFG-019 / audit 2026-06-11 C-2: secret keys must never run in a browser.
// V1.3: this THROWS (was console.warn — universally ignored). Covers ak_test_
// too: test keys hold the same privileges against the live testnet API.
function assertKeySafeInContext(key: string): void {
  if (typeof window !== "undefined" && key.startsWith("ak_")) {
    throw new ArcoraError(
      "SECRET_KEY_IN_BROWSER",
      "A SECRET key (ak_…) was used in a browser. Anyone can read it from your " +
      "page and list your escrows or create invoices. Use your publishable key " +
      "(pk_live_…) in client code; keep ak_ keys server-side.",
    );
  }
}
```

Call it from the constructor (replacing the warn call), add `"SECRET_KEY_IN_BROWSER"` to the `ArcoraError` code union in `src/error.ts` (read the file; extend the type and any code map).

- [ ] **Step 4: Run tests — PASS. Commit:** `git commit -am "feat(sdk)!: throw on secret keys in browser context (ak_live_ and ak_test_)"`

### Task 3.2: Export a webhook verification helper

**Files:** Create `packages/sdk/src/webhook.ts`; modify `packages/sdk/src/index.ts`; test `packages/sdk/test/webhook.test.ts`.

- [ ] **Step 1: Failing tests:**

```typescript
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../src/webhook";

const secret = "whsec_test";
const body = '{"event":"invoice.paid"}';
const ts = String(Math.floor(Date.now() / 1000));
const v2sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

describe("verifyWebhook", () => {
  it("accepts a valid V2 signature within tolerance", () => {
    expect(verifyWebhook({ body, secret, signature: v2sig, timestamp: ts })).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhook({ body: body + " ", secret, signature: v2sig, timestamp: ts })).toBe(false);
  });
  it("rejects a stale timestamp (replay)", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = "sha256=" + createHmac("sha256", secret).update(`${old}.${body}`).digest("hex");
    expect(verifyWebhook({ body, secret, signature: sig, timestamp: old })).toBe(false);
  });
  it("rejects malformed signatures without throwing", () => {
    expect(verifyWebhook({ body, secret, signature: "nope", timestamp: ts })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL (module missing). Implement `src/webhook.ts`:**

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyWebhookParams {
  /** Raw request body, exactly as received (do not re-stringify parsed JSON). */
  body: string;
  /** Value of the X-Arcora-Signature-V2 header (`sha256=<hex>`). */
  signature: string;
  /** Value of the X-Arcora-Timestamp header (unix seconds). */
  timestamp: string;
  /** Your webhook secret from the dashboard. */
  secret: string;
  /** Replay tolerance in seconds. Default 300. */
  toleranceSeconds?: number;
}

/**
 * Timing-safe verification of Arcora V2 webhook signatures
 * (HMAC-SHA256 over `<timestamp>.<body>`), with a replay window.
 * Server-side only (uses node:crypto).
 */
export function verifyWebhook(p: VerifyWebhookParams): boolean {
  const tolerance = p.toleranceSeconds ?? 300;
  const ts = Number(p.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false;

  const expected = "sha256=" + createHmac("sha256", p.secret).update(`${p.timestamp}.${p.body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(p.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

Export from `src/index.ts`: `export { verifyWebhook, type VerifyWebhookParams } from "./webhook";` — **check `tsup.config.ts`/`package.json` exports**: if the SDK ships a browser bundle, `node:crypto` must not break it; if it does, add a separate `"./webhook"` export entry (subpath) instead of the root re-export.

- [ ] **Step 3: Run tests — PASS. Commit:** `git commit -am "feat(sdk): timing-safe verifyWebhook with V2 timestamp replay window"`

### Task 3.3: V1 webhook signature deprecation (`ops/webhooks` + docs)

**Files:** Modify `ops/webhooks/run.ts`, `packages/app/app/docs/webhooks/page.tsx`.

- [ ] **Step 1:** In `ops/webhooks/run.ts`, where delivery headers are assembled (find: `grep -n "X-Arcora-Signature" ops/webhooks/run.ts`), add alongside V1:

```typescript
  "Deprecation": "version=1",   // V1 sig (no timestamp) is replayable; migrate to X-Arcora-Signature-V2
  "Link": '<https://arcorapay.xyz/docs/webhooks#v2>; rel="deprecation"',
```

- [ ] **Step 2:** Update `/docs/webhooks` page: document `X-Arcora-Signature-V2` + `X-Arcora-Timestamp`, show the `verifyWebhook` SDK snippet from Task 3.2 as the canonical receiver code, and an explicit warning that V1 has no replay protection and will be removed at mainnet.

- [ ] **Step 3:** `cd ops/webhooks && pnpm test` (existing postpinned/ssrf tests stay green). Commit: `git commit -am "feat(webhooks): deprecate V1 signature, document V2 + SDK verifier"`

### Task 3.4: sdk-react + demo-merchant key hygiene

**Files:** Modify `packages/sdk-react/src/CheckoutButton.tsx` (docs comment only — the throw from Task 3.1 already fires inside `useCheckout`'s `new Arcora(opts)` in the browser), `packages/sdk-react/package.json`, `packages/demo-merchant/src/App.tsx`.

- [ ] **Step 1:** `packages/sdk-react/package.json`: add `"engines": { "node": ">=20" }` and a `"typecheck": "tsc --noEmit"` script (mirror sdk's package.json).

- [ ] **Step 2:** Add a JSDoc warning on `CheckoutButtonProps.apiKey` route — in `CheckoutButton.tsx`:

```tsx
/**
 * Props for the drop-in checkout button.
 *
 * SECURITY: `apiKey` here MUST be your publishable key (`pk_live_…`).
 * Secret keys (`ak_…`) throw at construction time in browser contexts
 * (SDK ≥ 1.3.0). Never pass a secret key to a React component.
 */
export interface CheckoutButtonProps extends InitOptions {
```

- [ ] **Step 3:** `packages/demo-merchant/src/App.tsx` (lines 9–10 + guard at ~47): flip the guard to publishable-only:

```typescript
const KEY_IS_PUBLISHABLE = API_KEY.startsWith("pk_");
// ...
if (!KEY_IS_PUBLISHABLE) {
  // render the existing config-error panel with copy:
  // "Use your publishable key (pk_live_…). Secret keys (ak_…) must never ship in client code — see packages/shop for the server-routed pattern."
}
```

(Reuse the exact error-panel JSX currently shown for `KEY_IS_LIVE`; check whether invoice creation with a pk_ key requires the allowed-origins setup and note that in the panel copy.)

- [ ] **Step 4:** `pnpm --filter @arcora/sdk-react typecheck && pnpm --filter demo-merchant build` — green. Commit: `git commit -am "fix(sdk-react,demo): publishable-key-only client patterns, engines field"`

### Task 3.5: Version bump + publish prep

- [ ] **Step 1:** Bump BOTH `packages/sdk/package.json` and `packages/sdk-react/package.json` to `1.3.0` (the browser throw is a behavior break for misusers — minor bump is defensible pre-1.x-discipline, but document it). Add CHANGELOG.md entries: throw-on-secret-key-in-browser, verifyWebhook export, engines.

- [ ] **Step 2:** `pnpm --filter @arcora/sdk build && pnpm --filter @arcora/sdk-react build && npm pack --dry-run` in each package — verify the tarball lists only `dist`, `README.md`, `LICENSE`.

- [ ] **Step 3 (USER, 2FA):** `pnpm --filter @arcora/sdk publish --no-git-checks` then the same for sdk-react.

- [ ] **Step 4: Commit:** `git commit -am "chore(sdk): 1.3.0"`

---## Phase 4 — Ops daemons (in-repo)

### Task 4.1: Indexer chunk transactionality

**Files:** Modify `ops/indexer/run.ts` (~lines 137–403), referencing the existing pattern in `ops/indexer/replay.ts`.

- [ ] **Step 1:** Read both files' chunk loops: `grep -n "BEGIN\|COMMIT\|ROLLBACK\|setLastBlock" ops/indexer/replay.ts ops/indexer/run.ts`

- [ ] **Step 2:** In `run.ts`, wrap each chunk's writes in the same client-scoped transaction `replay.ts` uses — checkout a client from the pool, `BEGIN`, run every event write of the chunk plus `setLastBlock(end)` as the FINAL statement, `COMMIT`; on error `ROLLBACK` and release. Copy the exact helper/structure from `replay.ts` (it was written for audit Ops-L-2 — same shape, same error handling).

- [ ] **Step 3:** `cd ops/indexer && pnpm test` green; deploy to VPS in Phase 5 rollout. Commit: `git commit -am "fix(indexer): transactional chunk writes in live daemon (parity with replay)"`

### Task 4.2: Crosschain worker deadline + mint floor

**Files:** Modify `ops/relayer/crosschain-worker.ts`, test `ops/relayer/crosschain-worker.test.ts`.

- [ ] **Step 1: Failing tests** (match the existing deps-injection style in `crosschain-worker.test.ts` — read it first):

```typescript
it("expires a stuck row even when burn_submitted_at is null", async () => {
  // row: status waiting_attestation, burn_submitted_at: null,
  // created_at: 3h ago, deadline 2h → expect bridge_failed, no IRIS call loop
});

it("rejects a mint far below source_amount", async () => {
  // mint Transfer.value = 1n, row.source_amount = 100_000_000n
  // expect row marked bridge_failed with amount_mismatch error, not settled
});
```

(Write them concretely against the test file's existing fixture helpers — the file already fabricates rows and a `deps` object; copy a neighbouring test and adjust the two fields.)

- [ ] **Step 2: Implement.** In `crosschain-worker.ts` (~line 65), extend the deadline check:

```typescript
const anchorMs = (row.burn_submitted_at ?? row.created_at ?? row.updated_at)?.getTime();
if (anchorMs != null && Date.now() - anchorMs > deadlineMs) { /* existing bridge_failed path */ }
```

And at the mint verification (~line 1003), replace the `> 0n` check:

```typescript
// CCTP fee tolerance: destination mint must be within 2% of the burn amount.
const minMint = (row.source_amount * 98n) / 100n;
if (mint.args.value < minMint) { /* mark bridge_failed: amount_mismatch */ }
```

- [ ] **Step 3:** `cd ops/relayer && pnpm test` — green. Commit: `git commit -am "fix(relayer): crosschain deadline fallback + mint amount floor"`

### Task 4.3: vault-signer / rotation-script hardening (repo side)

**Files:** Modify `ops/relayer/vault-signer.ts`, `ops/vault/secret-id-rotation.sh`, `ops/health/arcora-health.sh`.

- [ ] **Step 1: vault-signer HTTPS guard** — in `vault-signer.ts` near the constructor/login (line ~73):

```typescript
const u = new URL(opts.vaultUrl);
if (u.protocol === "http:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
  throw new Error(`vault-signer: refusing plaintext HTTP to non-loopback Vault (${u.hostname}); use https`);
}
```

Add a unit test in `vault-signer.test.ts` (copy a neighbouring construction test): external `http://` throws, `http://127.0.0.1` and `https://` don't.

- [ ] **Step 2: Rotation script repo↔box sync** — in `ops/vault/secret-id-rotation.sh`:
  - line 10: `ENV_FILE="/opt/arcora-ops/relayer/.env"` (matches the live box's `/root/secret-id-rotation.sh`, which already targets `/opt` — diff them first: the box copy is the source of truth, port any other deltas back).
  - Replace both `sed -n 's/.*"secret_id"...'` extractions with `jq`:

```bash
NEW_SECRET_ID=$(echo "$NEW_SECRET_BUNDLE" | jq -r '.data.secret_id // empty')
NEW_ACCESSOR=$(echo "$NEW_SECRET_BUNDLE" | jq -r '.data.secret_id_accessor // "unknown"')
```

  (and the `ROLE_USES` read: `vault read -format=json auth/approle/role/relayer | jq -r '.data.secret_id_num_uses'`). Keep `chown root:root` — systemd reads `EnvironmentFile=` as root before dropping to `arcora-ops`; verified working on the box.

- [ ] **Step 3: Health script** — in `ops/health/arcora-health.sh`:
  - CA-extraction fallback (lines ~146–157): change the `sslmode=require` downgrade from `WARN` to `FAIL` (the function should `fail "db tls: CA extraction failed — refusing unverified TLS"` and skip the query instead of degrading).
  - Top of script, after env parsing:

```bash
if [[ -n "${ARCORA_NTFY_TOPIC:-}" && ! "$ARCORA_NTFY_TOPIC" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "FAIL: ARCORA_NTFY_TOPIC contains unexpected characters" >&2; exit 2
fi
```

  - DSN sanity before psql: `[[ "$dsn" == postgresql://* || "$dsn" == postgres://* ]] || fail "queue: DSN does not look like a postgres URL"`

- [ ] **Step 4:** `bash -n ops/vault/secret-id-rotation.sh ops/health/arcora-health.sh` (syntax), relayer tests green. Commit: `git commit -am "fix(ops): vault https guard, jq-based rotation parsing, health hard-fails on TLS downgrade"`

---

## Phase 5 — VPS rollout (live box: 194.163.136.1, key auth)

### Task 5.1: Vault TLS on loopback

- [ ] **Step 1: Generate a self-signed cert on the box:**

```bash
ssh root@194.163.136.1 '
mkdir -p /opt/vault/tls && cd /opt/vault/tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout vault.key -out vault.crt -days 825 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
chown vault:vault vault.key vault.crt && chmod 600 vault.key'
```

- [ ] **Step 2: Update `config.hcl`** on the box (and the repo copy `ops/vault/config.hcl` to match):

```hcl
listener "tcp" {
  address       = "127.0.0.1:8200"
  tls_disable   = 0
  tls_cert_file = "/opt/vault/tls/vault.crt"
  tls_key_file  = "/opt/vault/tls/vault.key"
}
```

- [ ] **Step 3: Roll the dependents** (order matters — Vault first, then everything that talks to it):

```bash
ssh root@194.163.136.1 '
systemctl restart vault && sleep 2
export VAULT_ADDR=https://127.0.0.1:8200 VAULT_CACERT=/opt/vault/tls/vault.crt
vault status   # must show Sealed:false (unseal if the box requires manual unseal — follow docs/runbooks/vault-recovery.md)
sed -i "s|VAULT_ADDR=http://127.0.0.1:8200|VAULT_ADDR=https://127.0.0.1:8200|" /opt/arcora-ops/relayer/.env
grep -q VAULT_CACERT /opt/arcora-ops/relayer/.env || echo "VAULT_CACERT=/opt/vault/tls/vault.crt" >> /opt/arcora-ops/relayer/.env
systemctl restart arcora-relayer && sleep 3 && systemctl is-active arcora-relayer'
```

**Pre-check:** confirm `vault-signer.ts` honors a CA env (`grep -n "VAULT_CACERT\|NODE_EXTRA_CA_CERTS" ops/relayer/*.ts`). If it doesn't, add CA support to `vault-signer.ts` FIRST (accept `opts.caCertPath`, feed it to `undici`/`https` agent) — do that in Task 4.3 before this rollout, and deploy the rebuilt relayer to the box. Alternative zero-code path: set `NODE_EXTRA_CA_CERTS=/opt/vault/tls/vault.crt` in the systemd unit Environment= — prefer this if the signer uses global fetch.

- [ ] **Step 4: Update the rotation cron env** (`crontab -e` on the box): `VAULT_ADDR=https://127.0.0.1:8200` and add `VAULT_CACERT=/opt/vault/tls/vault.crt` to the cron line. Force one rotation run and check the log tail says `ok`:

```bash
ssh root@194.163.136.1 'VAULT_ADDR=https://127.0.0.1:8200 VAULT_CACERT=/opt/vault/tls/vault.crt VAULT_TOKEN=$(cat /etc/arcora/rotation-operator.token) /root/secret-id-rotation.sh && tail -1 /var/log/secret-id-rotation.log'
```

### Task 5.2: Retire `/root/arcora-ops`, consolidate on `/opt`

- [ ] **Step 1: Deploy the fixed repo scripts to the canonical location:**

```bash
scp ops/vault/secret-id-rotation.sh root@194.163.136.1:/opt/arcora-ops/vault/
scp ops/vault/vault-rotation-health.sh root@194.163.136.1:/opt/arcora-ops/vault/ 2>/dev/null || true   # if it exists in repo
scp ops/health/arcora-health.sh root@194.163.136.1:/opt/arcora-ops/health/
ssh root@194.163.136.1 'mkdir -p /opt/arcora-ops/vault /opt/arcora-ops/health; chmod 755 /opt/arcora-ops/vault/*.sh /opt/arcora-ops/health/*.sh'
```

(Create dirs before scp if missing — run the mkdir first.)

- [ ] **Step 2: Repoint the crons and tighten perms:**

```bash
ssh root@194.163.136.1 '
sed -i "s|/root/arcora-ops/vault/vault-rotation-health.sh|/opt/arcora-ops/vault/vault-rotation-health.sh|" /etc/cron.d/vault-rotation-health
sed -i "s|/root/arcora-ops/health/arcora-health.sh|/opt/arcora-ops/health/arcora-health.sh|" /etc/cron.d/arcora-health
chmod 600 /etc/cron.d/vault-rotation-health /etc/cron.d/arcora-health
crontab -l | sed "s|/root/secret-id-rotation.sh|/opt/arcora-ops/vault/secret-id-rotation.sh|" | crontab -'
```

(`/etc/cron.d` files at 600 still run — cron reads them as root; this hides the ntfy topic from local users. The root crontab edit points the daily rotation at the now-canonical script; delete `/root/secret-id-rotation.sh` after one successful 03:00 run.)

- [ ] **Step 3: After the next 03:00 rotation succeeds** (check `tail -1 /var/log/secret-id-rotation.log` shows today's `ok`):

```bash
ssh root@194.163.136.1 'rm -rf /root/arcora-ops /root/secret-id-rotation.sh'
```

- [ ] **Step 4: Deploy the rebuilt daemons** (indexer transaction fix, relayer worker fixes from Phase 4) the same way the box was originally provisioned (check `ops/relayer/README.md` deploy section for the exact rsync/build steps), restart services, verify `systemctl is-active arcora-relayer arcora-indexer arcora-webhooks` → 3× `active`, and the health cron stays quiet on ntfy for one full cycle.

---

## Phase 6 — Re-publish everything

Order: code phases (1–5) merged on `plan-1-protocol` → deploy app → refresh public snapshot → npm publish.

- [ ] **Step 1: Deploy the app:** from repo root: `vercel --prod --yes` (project rootDirectory is `packages/app`; per RELEASING.md never deploy from inside packages/app). Smoke: pay + refund one invoice on arcorapay.xyz against V13.
- [ ] **Step 2: Refresh the public snapshot** — execute Task 0.2 now (neutral identity, exclusions honored, includes all fixes).
- [ ] **Step 3: npm publish** — Task 3.5 Step 3 (user, 2FA).
- [ ] **Step 4: Docs sweep:** fee disclosure everywhere says "0.30% at claim, no other protocol take" (`grep -rn "0.3\|30 bps\|excess" packages/app/app/docs docs/LITEPAPER.md`); webhooks docs show V2; update `KNOWN_ISSUES.md` (CSP residual if any, V1 webhook deprecation timeline).
- [ ] **Step 5: Close the loop on the audit memory:** update `~/.claude/projects/-Users-huseyinarslan-Desktop-arcorapay/memory/arcorapay-security-audit-2026-06-11.md` marking findings fixed/deployed, so future sessions don't re-flag them.

---

## Execution notes

- **Phase order:** 0.1/0.3/0.4 immediately (cheap, kill the live risks); then 1 → 2 → 3 → 4 → 5 in any order (independent); 6 last. 0.2 executes inside Phase 6.
- **User-required steps (cannot be automated):** 0.1 password typing, 0.3 provider panel, 0.2/6.2 org-credential force-push, 3.5/6.3 npm 2FA publish, Vercel env edits if CLI lacks scope.
- **V13 is a breaking redeploy on testnet:** old V12 invoices stay claimable/refundable on the old address (indexer keeps both); new invoices go to V13. No data migration needed.
- **Biggest regression risks:** Task 2.9 (CSP — has an explicit fallback), Task 5.1 (Vault TLS — has a pre-check + runbook pointer). Both have verify steps before anything else depends on them.
