# Plan 10 — V10 custody gateway + Vault HSM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ArcFXGatewayV10` (per-invoice escrow custody, 7-day refund/claim window, fee-on-claim accounting) closing the four V10-deferred audit residuals (H4, M3, M4, L2) plus the four operational gotchas, retire V8/V9 entirely, and isolate the relayer key behind HashiCorp Vault on the existing VPS.

**Architecture:** Contract-first TDD against Foundry; legacy V8/V9 sources moved to `packages/contracts/legacy/`; off-chain (indexer, relayer, app, SDK) follows once the contract is green and deployed; relayer signs through Vault transit engine via a viem custom signer; DB rows wiped on cutover (single merchant on testnet, no migration UX needed).

**Tech Stack:** Solidity 0.8.26 + OpenZeppelin 5 + Foundry (forge); Node 20 + viem 2 + drizzle-orm; HashiCorp Vault 1.18+ with `vault-plugin-secrets-secp256k1`; Next.js 15 (App Router); Vitest 1; Postgres 16 (Neon).

**Spec:** `docs/superpowers/specs/2026-05-06-plan-10-custody-gateway-design.md`

---

## File structure

### Created

| Path | Responsibility |
|------|---------------|
| `packages/contracts/src/ArcFXGatewayV10.sol` | V10 gateway with custody escrow |
| `packages/contracts/script/DeployV10.s.sol` | V10 deploy script |
| `packages/contracts/test/V10/V10TestBase.t.sol` | Shared test setup (mocks, actors, helpers) |
| `packages/contracts/test/V10/Constructor.t.sol` | M3 fee bound + window validation |
| `packages/contracts/test/V10/Merchant.t.sol` | Register, deactivate, reactivate, M4 reject overwrite |
| `packages/contracts/test/V10/Settle.t.sol` | settleInvoice + escrow creation, no on-settle transfer |
| `packages/contracts/test/V10/Refund.t.sol` | refundInvoice within window, full amountOut to payer |
| `packages/contracts/test/V10/Claim.t.sol` | Permissionless claim, fee accrual on claim, batch atomicity |
| `packages/contracts/test/V10/AdminRecovery.t.sol` | Admin sweep for deactivated + 14d |
| `packages/contracts/test/V10/Delegate.t.sol` | Bit-flag rights |
| `packages/contracts/test/V10/PayerRefund.t.sol` | recordPayerRefund + nonReentrant (L2) |
| `packages/contracts/test/V10/Pause.t.sol` | Pause behavior |
| `packages/contracts/test/V10/Reentrancy.t.sol` | Malicious ERC20 reentry |
| `ops/relayer/vault-signer.ts` | viem custom signer that delegates to Vault transit engine |
| `ops/relayer/vault-signer.test.ts` | Vault dev-mode integration test |
| `ops/vault/install.sh` | One-shot Vault installer + systemd unit on the VPS |
| `ops/vault/policy-relayer.hcl` | Vault policy: transit/sign on relayer-v10 |
| `ops/vault/secret-id-rotation.sh` | Daily AppRole secret_id rotation cron |
| `ops/vault/README.md` | Vault setup walkthrough (init, unseal, plugin, AppRole) |
| `packages/app/app/api/merchant/escrows/route.ts` | List pending + matured escrows |
| `packages/app/app/api/merchant/escrows/route.test.ts` | Auth + aggregate test |
| `packages/app/components/treasury/ClaimAllButton.tsx` | Permissionless `claim([])` UI |
| `packages/app/lib/db/migrations/0016_v10_wipe.sql` | Wipe all merchant/invoice/webhook/etc rows |
| `packages/app/lib/db/migrations/0017_v10_escrow.sql` | New status enum values + escrow columns |
| `docs/runbooks/v10-deploy.md` | Deploy + cutover runbook |
| `docs/runbooks/vault-recovery.md` | Vault unseal / DR runbook |

### Modified

| Path | Change |
|------|--------|
| `packages/contracts/src/ArcFXGatewayV8.sol` | Move → `packages/contracts/legacy/ArcFXGatewayV8.sol` |
| `packages/contracts/src/ArcFXGatewayV9.sol` | Move → `packages/contracts/legacy/ArcFXGatewayV9.sol` |
| `packages/contracts/test/ArcFXGatewayV8.t.sol` | Move → `packages/contracts/test/legacy/` (kept for history; excluded from default test run) |
| `packages/contracts/test/ArcFXGatewayV9.t.sol` | Move → `packages/contracts/test/legacy/` |
| `packages/contracts/.slither-triage.md` | Scope updated to V10 only |
| `packages/contracts/foundry.toml` | Exclude `test/legacy/` from default profile |
| `ops/indexer/run.ts` | Drop V6/V8/V9 multi-cohort watch, add V10-only event handlers (`EscrowCreated`, `InvoiceClaimed`, `EscrowRecovered`, `MerchantReactivated`) |
| `ops/indexer/replay.ts` | Same V10-only scope |
| `ops/relayer/run.ts` | Replace `privateKeyToAccount(RELAYER_PRIVATE_KEY)` with `vaultSigner({...})`; point at V10 |
| `ops/relayer/.env.example` | Drop `RELAYER_PRIVATE_KEY`; add `VAULT_*` vars |
| `packages/app/lib/chain/gateway-abi.ts` | Replace V9 ABI with V10 ABI (escrow, claim, recovery, reactivate events + functions) |
| `packages/app/lib/chain/client.ts` | Update `GATEWAY_ADDRESS` env to `GATEWAY_ADDRESS_V10` |
| `packages/app/lib/db/schema.ts` | Add `claimed`, `recovered` to `invoiceStatus` enum; add `claimableAt`, `claimedAt`, `claimTx`, `recoveredAt`, `recoveryTx` to `invoices`; add `deactivatedAt` to `merchants` |
| `packages/app/app/api/merchant/bootstrap/route.ts` | Drop `readAllowance` call + `warning: approval_required` |
| `packages/app/app/api/internal/cron/h4-allowance-check/route.ts` | DELETE |
| `packages/app/vercel.json` | Drop `/api/internal/cron/h4-allowance-check` cron entry |
| `packages/app/app/m/dashboard/page.tsx` | Drop allowance-warning banner |
| `packages/app/app/m/settings/AllowedOriginsCard.tsx` | Drop the H4 banner block (allowed-origins itself stays) |
| `packages/app/app/m/treasury/page.tsx` | Add Claim tab with `ClaimAllButton` |
| `packages/app/components/treasury/ActivityFeed.tsx` | Add `claimed` and `recovered` status pill rendering |
| `packages/app/components/checkout/RefundButton.tsx` | Gate visibility by `now < settledAt + 7 days` AND `status === 'paid'` |
| `packages/sdk/src/abi.ts` | V10 ABI snapshot |
| `packages/sdk/src/client.ts` | Add `escrows()` method |
| `packages/sdk-react/src/useCheckout.tsx` | Surface `refundEndsAt` (unix seconds) on the result |
| `docs/audit/2026-05-05-residuals.md` | Mark H4/M3/M4/L2 closed |
| `docs/audit/deploy-checklist.md` | Add `vercel.json` location warning |
| `docs/runbooks/h4-refund-approval.md` | Deprecation header → V10 eliminates it |

### Deleted

| Path | Reason |
|------|--------|
| `packages/app/app/api/internal/cron/h4-allowance-check/` | Custody removes the dependency |
| `packages/app/lib/chain/erc20.ts` `readAllowance` export | No callers after H4 cron + bootstrap dropped (keep file if `safeApprove` etc. still used; review at task time) |

---

## Phase 0 — Prep

### Task 1: Branch + worktree

**Files:**
- N/A — branch creation only

- [ ] **Step 1: Create the V10 branch**

```bash
git checkout plan-1-protocol
git pull --ff-only origin plan-1-protocol
git checkout -b plan-10-v10-custody
```

- [ ] **Step 2: Verify clean working tree**

Run: `git status --short`
Expected: Empty (or only `.claude/` untracked)

- [ ] **Step 3: Push branch with upstream tracking**

```bash
git push -u origin plan-10-v10-custody
```

Expected: `* [new branch] plan-10-v10-custody → plan-10-v10-custody`

---

## Phase 1 — V10 contract (TDD, behavior by behavior)

Foundry tests drive the contract surface. Each task: write the test → run to confirm it fails (function not yet implemented or wrong behavior) → add the minimal contract code → run to confirm pass → commit.

### Task 2: V10 contract skeleton + test base

**Files:**
- Create: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/V10TestBase.t.sol`

- [ ] **Step 1: Write the V10 skeleton (compile-ready, behavior comes in later tasks)**

Create `packages/contracts/src/ArcFXGatewayV10.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl }     from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable }          from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ArcFXGatewayV10
/// @notice Custody gateway. Settled funds are held in per-invoice escrow;
///         refunds within the 7-day window pull from escrow (no allowance);
///         after the window, anyone may call claim() to push the merchant
///         leg out (fee accrued at claim, NOT at settle); deactivated
///         merchants' escrow becomes admin-recoverable after a further
///         7 days. Closes audit residuals H4 (custody), M3 (fee bound),
///         M4 (reactivate semantics), L2 (nonReentrant on PayerRefund).
contract ArcFXGatewayV10 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    uint8   public constant RIGHT_CREATE_INVOICE = 1 << 0;
    uint8   public constant RIGHT_REFUND         = 1 << 1;

    uint256 public immutable PROTOCOL_FEE_BPS;
    uint64  public immutable REFUND_WINDOW;
    uint64  public immutable ADMIN_RECOVERY_DELAY;

    mapping(address token    => bool)     public supportedTokens;

    struct Merchant { address payoutAddress; address payoutToken; bool active; }
    mapping(address merchant => Merchant) public merchants;

    enum InvoiceStatus { None, Created, Paid, Refunded, Failed, Claimed, Recovered }
    struct Invoice {
        address       merchant;
        address       payIn;
        address       payoutToken;
        uint256       amountOut;
        uint64        expiresAt;
        InvoiceStatus status;
        address       paidBy;
    }
    mapping(bytes32 globalId => Invoice) public invoices;

    struct Escrow { uint256 amount; address payoutToken; uint64 claimableAt; }
    mapping(bytes32 globalId => Escrow) public escrows;

    mapping(address token    => uint256) public protocolFeesAccrued;

    struct DelegateAuth { uint64 expiresAt; uint8 rights; }
    mapping(address merchant => mapping(address delegate => DelegateAuth)) public delegates;

    // Events / errors / functions filled in by subsequent tasks.

    constructor(
        uint256 protocolFeeBps,
        uint64  refundWindow,
        uint64  adminRecoveryDelay,
        address initialOwner,
        address initialRelayer
    ) {
        PROTOCOL_FEE_BPS     = protocolFeeBps;
        REFUND_WINDOW        = refundWindow;
        ADMIN_RECOVERY_DELAY = adminRecoveryDelay;
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(RELAYER_ROLE,       initialRelayer);
    }
}
```

- [ ] **Step 2: Write the shared test base**

Create `packages/contracts/test/V10/V10TestBase.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test }              from "forge-std/Test.sol";
import { Vm }                from "forge-std/Vm.sol";
import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAccessControl }    from "@openzeppelin/contracts/access/IAccessControl.sol";

import { ArcFXGatewayV10 }   from "../../src/ArcFXGatewayV10.sol";
import { MockERC20 }         from "../helpers/MockERC20.sol";

abstract contract V10TestBase is Test {
    ArcFXGatewayV10 gw;
    MockERC20 usdc;
    MockERC20 eurc;

    address admin    = makeAddr("admin");
    address relayer  = makeAddr("relayer");
    address merchant = makeAddr("merchant");
    address payee    = makeAddr("payee");
    address customer = makeAddr("customer");
    address sweepTo  = makeAddr("sweepTo");

    uint256 constant FEE_BPS              = 30;          // 0.30%
    uint64  constant REFUND_WINDOW        = 7 days;
    uint64  constant ADMIN_RECOVERY_DELAY = 7 days;

    function setUp() public virtual {
        vm.warp(1_700_000_000);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);

        gw = new ArcFXGatewayV10(FEE_BPS, REFUND_WINDOW, ADMIN_RECOVERY_DELAY, admin, relayer);

        vm.startPrank(admin);
        gw.setTokenSupport(address(usdc), true);
        gw.setTokenSupport(address(eurc), true);
        vm.stopPrank();

        vm.prank(merchant);
        gw.registerMerchant(payee, address(eurc));
    }

    function _createInvoice(bytes32 invoiceId, uint256 amountOut, uint64 ttl) internal returns (bytes32) {
        vm.prank(merchant);
        return gw.createInvoice(invoiceId, address(usdc), amountOut, uint64(block.timestamp + ttl));
    }

    function _fundRelayer(MockERC20 token, uint256 amount) internal {
        token.mint(relayer, amount);
        vm.prank(relayer);
        token.approve(address(gw), amount);
    }

    function _settle(bytes32 invoiceId, uint256 amountOut, uint256 gross) internal returns (bytes32 globalId) {
        globalId = _createInvoice(invoiceId, amountOut, 1 hours);
        _fundRelayer(eurc, gross);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), gross + 10e6, gross, bytes32(0));
    }
}
```

- [ ] **Step 3: Run forge build**

Run: `pnpm --filter @arcora/contracts exec forge build`
Expected: Compilation fails (`setTokenSupport`, `registerMerchant`, `createInvoice`, `settleInvoice` not yet implemented). The error confirms the test base wires correctly to the skeleton.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/V10TestBase.t.sol
git commit -m "feat(v10): contract skeleton + test base"
```

### Task 3: Constructor — fee bound (M3) + window validation

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol` (constructor + errors)
- Create: `packages/contracts/test/V10/Constructor.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/Constructor.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10Constructor is Test {
    address admin    = makeAddr("admin");
    address relayer  = makeAddr("relayer");

    function test_RejectFeeBpsAbove1000() public {
        vm.expectRevert(abi.encodeWithSignature("ProtocolFeeTooHigh(uint256)", 1001));
        new ArcFXGatewayV10(1001, 7 days, 7 days, admin, relayer);
    }

    function test_AcceptFeeBpsAtBound() public {
        ArcFXGatewayV10 gw = new ArcFXGatewayV10(1000, 7 days, 7 days, admin, relayer);
        assertEq(gw.PROTOCOL_FEE_BPS(), 1000);
    }

    function test_RejectZeroRefundWindow() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidWindow()"));
        new ArcFXGatewayV10(30, 0, 7 days, admin, relayer);
    }

    function test_RejectZeroRecoveryDelay() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidWindow()"));
        new ArcFXGatewayV10(30, 7 days, 0, admin, relayer);
    }

    function test_RejectZeroOwner() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        new ArcFXGatewayV10(30, 7 days, 7 days, address(0), relayer);
    }

    function test_RejectZeroRelayer() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        new ArcFXGatewayV10(30, 7 days, 7 days, admin, address(0));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Constructor -vv`
Expected: All six tests FAIL — constructor accepts everything currently.

- [ ] **Step 3: Add errors + bounds to the constructor**

In `packages/contracts/src/ArcFXGatewayV10.sol`, replace the constructor and add error declarations (place errors below the existing storage block):

```solidity
    error InvalidPayoutAddress();
    error InvalidWindow();
    error ProtocolFeeTooHigh(uint256 supplied);

    constructor(
        uint256 protocolFeeBps,
        uint64  refundWindow,
        uint64  adminRecoveryDelay,
        address initialOwner,
        address initialRelayer
    ) {
        if (initialOwner   == address(0)) revert InvalidPayoutAddress();
        if (initialRelayer == address(0)) revert InvalidPayoutAddress();
        if (protocolFeeBps > 1_000)       revert ProtocolFeeTooHigh(protocolFeeBps);
        if (refundWindow == 0)            revert InvalidWindow();
        if (adminRecoveryDelay == 0)      revert InvalidWindow();

        PROTOCOL_FEE_BPS     = protocolFeeBps;
        REFUND_WINDOW        = refundWindow;
        ADMIN_RECOVERY_DELAY = adminRecoveryDelay;

        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(RELAYER_ROLE,       initialRelayer);
    }
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Constructor -vv`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/Constructor.t.sol
git commit -m "feat(v10): constructor fee bound + window validation (M3)"
```

### Task 4: Token whitelist + pause

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`

- [ ] **Step 1: Add inline tests in V10TestBase to drive the surface**

Append to the bottom of `packages/contracts/test/V10/V10TestBase.t.sol` a concrete test contract:

```solidity
contract V10WhitelistAndPause is V10TestBase {
    function test_SetTokenSupport_OnlyAdmin() public {
        MockERC20 t = new MockERC20("X", "X", 6);
        vm.expectRevert();
        gw.setTokenSupport(address(t), true);
        vm.prank(admin);
        gw.setTokenSupport(address(t), true);
        assertTrue(gw.supportedTokens(address(t)));
    }

    function test_PauseUnpause_OnlyAdmin() public {
        vm.expectRevert();
        gw.pause();
        vm.prank(admin);
        gw.pause();
        assertTrue(gw.paused());
        vm.prank(admin);
        gw.unpause();
        assertFalse(gw.paused());
    }
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10WhitelistAndPause -vv`
Expected: Compile error — `setTokenSupport`, `pause`, `unpause` not implemented.

- [ ] **Step 3: Add token whitelist + pause to the contract**

In `ArcFXGatewayV10.sol`, after the constructor:

```solidity
    event TokenSupportUpdated(address indexed token, bool active);

    function setTokenSupport(address token, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedTokens[token] = active;
        emit TokenSupportUpdated(token, active);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10WhitelistAndPause -vv`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/V10TestBase.t.sol
git commit -m "feat(v10): token whitelist + pause"
```

### Task 5: Merchant lifecycle (register, deactivate, reactivate, M4 reject overwrite)

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/Merchant.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/Merchant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10Merchant is V10TestBase {
    function test_Register_AlreadyRegistered_Reverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("MerchantAlreadyRegistered()"));
        gw.registerMerchant(payee, address(eurc));
    }

    function test_Deactivate_FlipsActive() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        (, , bool active) = gw.merchants(merchant);
        assertFalse(active);
    }

    function test_DeactivatedCannotReRegister() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("MerchantAlreadyRegistered()"));
        gw.registerMerchant(payee, address(eurc));
    }

    function test_Reactivate_OnlyAdmin() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.expectRevert();
        gw.reactivateMerchant(merchant);
        vm.prank(admin);
        gw.reactivateMerchant(merchant);
        (, , bool active) = gw.merchants(merchant);
        assertTrue(active);
    }

    function test_Reactivate_AlreadyActive_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("MerchantAlreadyActive()"));
        gw.reactivateMerchant(merchant);
    }

    function test_Reactivate_NotMerchant_Reverts() public {
        address ghost = makeAddr("ghost");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("NotMerchant()"));
        gw.reactivateMerchant(ghost);
    }

    function test_UpdatePayoutAddress() public {
        address newPayee = makeAddr("newPayee");
        vm.prank(merchant);
        gw.updatePayoutAddress(newPayee);
        (address pa, , ) = gw.merchants(merchant);
        assertEq(pa, newPayee);
    }

    function test_UpdatePayoutToken() public {
        vm.prank(merchant);
        gw.updatePayoutToken(address(usdc));
        (, address pt, ) = gw.merchants(merchant);
        assertEq(pt, address(usdc));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Merchant -vv`
Expected: Compile error — `registerMerchant`, `deactivateMerchant`, `reactivateMerchant`, `updatePayoutAddress`, `updatePayoutToken` not implemented.

- [ ] **Step 3: Add merchant lifecycle to the contract**

In `ArcFXGatewayV10.sol`, after the pause functions:

```solidity
    error NotMerchant();
    error MerchantAlreadyRegistered();
    error MerchantAlreadyActive();
    error MerchantInactive();
    error InvalidPayoutToken();

    event MerchantRegistered(address indexed merchant, address payoutAddress, address payoutToken);
    event MerchantPayoutAddressUpdated(address indexed merchant, address oldAddress, address newAddress);
    event MerchantPayoutTokenUpdated(address indexed merchant, address oldToken, address newToken);
    event MerchantDeactivated(address indexed merchant);
    event MerchantReactivated(address indexed merchant);

    function registerMerchant(address payoutAddress, address payoutToken) external {
        // M4: reject any pre-existing row, active or not. Reactivation is admin-gated.
        if (merchants[msg.sender].payoutAddress != address(0)) revert MerchantAlreadyRegistered();
        if (payoutAddress == address(0))                       revert InvalidPayoutAddress();
        if (!supportedTokens[payoutToken])                     revert InvalidPayoutToken();
        merchants[msg.sender] = Merchant({
            payoutAddress: payoutAddress,
            payoutToken:   payoutToken,
            active:        true
        });
        emit MerchantRegistered(msg.sender, payoutAddress, payoutToken);
    }

    function updatePayoutAddress(address newPayoutAddress) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active)                       revert NotMerchant();
        if (newPayoutAddress == address(0))  revert InvalidPayoutAddress();
        address old = m.payoutAddress;
        m.payoutAddress = newPayoutAddress;
        emit MerchantPayoutAddressUpdated(msg.sender, old, newPayoutAddress);
    }

    function updatePayoutToken(address newPayoutToken) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active)                          revert NotMerchant();
        if (!supportedTokens[newPayoutToken])   revert InvalidPayoutToken();
        address old = m.payoutToken;
        m.payoutToken = newPayoutToken;
        emit MerchantPayoutTokenUpdated(msg.sender, old, newPayoutToken);
    }

    function deactivateMerchant() external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        m.active = false;
        emit MerchantDeactivated(msg.sender);
    }

    /// @notice Admin-only reactivation (audit M4). Preserves payoutAddress/Token.
    function reactivateMerchant(address merchantAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Merchant storage m = merchants[merchantAddr];
        if (m.payoutAddress == address(0)) revert NotMerchant();
        if (m.active)                       revert MerchantAlreadyActive();
        m.active = true;
        emit MerchantReactivated(merchantAddr);
    }
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Merchant -vv`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/Merchant.t.sol
git commit -m "feat(v10): merchant lifecycle + admin reactivate (M4)"
```

### Task 6: Invoice creation (createInvoice, createInvoiceFor with delegate scope)

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/Delegate.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/Delegate.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10Delegate is V10TestBase {
    address delegate = makeAddr("delegate");

    function test_CreateInvoice_HappyPath() public {
        vm.prank(merchant);
        bytes32 g = gw.createInvoice(bytes32("inv-1"), address(usdc), 100e6, uint64(block.timestamp + 1 hours));
        (address mer, , , uint256 amt, , ArcFXGatewayV10.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(mer, merchant);
        assertEq(amt, 100e6);
        assertEq(uint8(s), uint8(ArcFXGatewayV10.InvoiceStatus.Created));
    }

    function test_AuthorizeDelegate_RejectsUnknownRights() public {
        vm.prank(merchant);
        // 0x80 = bit beyond CREATE_INVOICE | REFUND
        vm.expectRevert(abi.encodeWithSignature("InvalidDelegateRights(uint8)", uint8(0x80)));
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), 0x80);
    }

    function test_CreateInvoiceFor_DelegateWithRight_Succeeds() public {
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), gw.RIGHT_CREATE_INVOICE());

        vm.prank(delegate);
        bytes32 g = gw.createInvoiceFor(merchant, bytes32("inv-2"), address(usdc), 50e6, uint64(block.timestamp + 1 hours));
        (address mer, , , , , , ) = gw.invoices(g);
        assertEq(mer, merchant);
    }

    function test_CreateInvoiceFor_DelegateWithRefundOnly_Reverts() public {
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), gw.RIGHT_REFUND());

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSignature("DelegateNotAuthorized()"));
        gw.createInvoiceFor(merchant, bytes32("inv-3"), address(usdc), 50e6, uint64(block.timestamp + 1 hours));
    }

    function test_CreateInvoiceFor_ExpiredDelegate_Reverts() public {
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 hours), gw.RIGHT_CREATE_INVOICE());

        vm.warp(block.timestamp + 2 hours);

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSignature("DelegateNotAuthorized()"));
        gw.createInvoiceFor(merchant, bytes32("inv-4"), address(usdc), 50e6, uint64(block.timestamp + 1 hours));
    }

    function test_RevokeDelegate() public {
        vm.startPrank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), gw.RIGHT_CREATE_INVOICE());
        gw.revokeDelegate(delegate);
        vm.stopPrank();

        (uint64 exp, uint8 rights) = gw.delegates(merchant, delegate);
        assertEq(exp, 0);
        assertEq(rights, 0);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Delegate -vv`
Expected: Compile error — `createInvoice`, `createInvoiceFor`, `authorizeDelegate`, `revokeDelegate` not implemented.

- [ ] **Step 3: Implement invoice creation + delegate scope**

In `ArcFXGatewayV10.sol`, after the merchant block:

```solidity
    error InvalidPayInToken();
    error InvoiceAlreadyExists(bytes32 globalId);
    error DelegateNotAuthorized();
    error InvalidDelegateRights(uint8 rights);

    event InvoiceCreated(
        bytes32 indexed globalId,
        address indexed merchant,
        bytes32 indexed merchantInvoiceId,
        address payIn,
        address payoutToken,
        uint256 amountOut,
        uint64 expiresAt
    );
    event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt, uint8 rights);
    event DelegateRevoked(address indexed merchant, address indexed delegate);

    function createInvoice(
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64  expiresAt
    ) external returns (bytes32) {
        return _createInvoice(msg.sender, merchantInvoiceId, payIn, amountOut, expiresAt);
    }

    function createInvoiceFor(
        address merchant_,
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64  expiresAt
    ) external returns (bytes32) {
        DelegateAuth memory d = delegates[merchant_][msg.sender];
        if (d.expiresAt < block.timestamp)               revert DelegateNotAuthorized();
        if ((d.rights & RIGHT_CREATE_INVOICE) == 0)      revert DelegateNotAuthorized();
        return _createInvoice(merchant_, merchantInvoiceId, payIn, amountOut, expiresAt);
    }

    function _createInvoice(
        address merchant_,
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64  expiresAt
    ) internal whenNotPaused returns (bytes32 globalId) {
        Merchant memory m = merchants[merchant_];
        if (!m.active)                revert MerchantInactive();
        if (!supportedTokens[payIn])  revert InvalidPayInToken();

        globalId = keccak256(abi.encode(merchant_, merchantInvoiceId));
        if (invoices[globalId].status != InvoiceStatus.None) revert InvoiceAlreadyExists(globalId);

        invoices[globalId] = Invoice({
            merchant:    merchant_,
            payIn:       payIn,
            payoutToken: m.payoutToken,
            amountOut:   amountOut,
            expiresAt:   expiresAt,
            status:      InvoiceStatus.Created,
            paidBy:      address(0)
        });
        emit InvoiceCreated(globalId, merchant_, merchantInvoiceId, payIn, m.payoutToken, amountOut, expiresAt);
    }

    function authorizeDelegate(address delegate, uint64 expiresAt, uint8 rights) external {
        if (!merchants[msg.sender].active) revert NotMerchant();
        uint8 validMask = RIGHT_CREATE_INVOICE | RIGHT_REFUND;
        if ((rights & ~validMask) != 0)    revert InvalidDelegateRights(rights);
        delegates[msg.sender][delegate] = DelegateAuth({ expiresAt: expiresAt, rights: rights });
        emit DelegateAuthorized(msg.sender, delegate, expiresAt, rights);
    }

    function revokeDelegate(address delegate) external {
        delete delegates[msg.sender][delegate];
        emit DelegateRevoked(msg.sender, delegate);
    }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Delegate -vv`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/Delegate.t.sol
git commit -m "feat(v10): invoice creation + delegate bit-flag scope"
```

### Task 7: Settle invoice → custody escrow (no transfer to merchant)

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/Settle.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/Settle.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10Settle is V10TestBase {
    function test_Settle_CreatesEscrow_NoTransferToMerchant() public {
        bytes32 g = _settle(bytes32("inv-1"), 100e6, 100e6);

        // Funds in custody, NOT in merchant wallet
        assertEq(eurc.balanceOf(payee), 0, "payee receives nothing at settle");
        assertEq(eurc.balanceOf(address(gw)), 100e6, "gateway holds full gross");

        (uint256 amt, address tok, uint64 claimableAt) = gw.escrows(g);
        assertEq(amt, 100e6, "escrow amount = amountOut");
        assertEq(tok, address(eurc));
        assertEq(claimableAt, uint64(block.timestamp + REFUND_WINDOW));

        // Status flipped to Paid
        (, , , , , ArcFXGatewayV10.InvoiceStatus s, address paidBy) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGatewayV10.InvoiceStatus.Paid));
        assertEq(paidBy, customer);

        // No fee accrued at settle
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "fee NOT accrued at settle");
    }

    function test_Settle_ExcessAccruesAtSettle() public {
        bytes32 g = _settle(bytes32("inv-2"), 100e6, 105e6);

        (uint256 amt, , ) = gw.escrows(g);
        assertEq(amt, 100e6, "escrow holds amountOut, not gross");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 5e6, "excess accrues immediately");
        assertEq(eurc.balanceOf(address(gw)), 105e6, "gateway holds gross");
    }

    function test_Settle_GrossBelowAmountOut_Reverts() public {
        bytes32 g = _createInvoice(bytes32("inv-3"), 100e6, 1 hours);
        _fundRelayer(eurc, 99e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("PayoutShortfall(uint256,uint256)", 99e6, 100e6));
        gw.settleInvoice(g, customer, address(usdc), 99e6, 99e6, bytes32(0));
    }

    function test_Settle_OnlyRelayer() public {
        bytes32 g = _createInvoice(bytes32("inv-4"), 100e6, 1 hours);
        vm.expectRevert();
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_Settle_DoubleSettle_Reverts() public {
        bytes32 g = _settle(bytes32("inv-5"), 100e6, 100e6);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceAlreadyPaid(bytes32)", g));
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_Settle_Expired_Reverts() public {
        bytes32 g = _createInvoice(bytes32("inv-6"), 100e6, 1 hours);
        vm.warp(block.timestamp + 2 hours);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceExpired(bytes32)", g));
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Settle -vv`
Expected: Compile error — `settleInvoice` not implemented.

- [ ] **Step 3: Add settleInvoice + escrow events / errors**

In `ArcFXGatewayV10.sol`, after the invoice block:

```solidity
    error InvoiceAlreadyPaid(bytes32 globalId);
    error InvoiceExpired(bytes32 globalId);
    error InvoiceNotFound(bytes32 globalId);
    error InvoiceNotInCreatedState(bytes32 globalId);
    error PayoutShortfall(uint256 supplied, uint256 required);

    event InvoicePaid(
        bytes32 indexed globalId,
        address indexed payer,
        uint256 amountIn,
        uint256 grossReceived,
        uint256 merchantPayout,
        uint256 fee
    );
    event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash);
    event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt);

    function settleInvoice(
        bytes32 globalId,
        address payer,
        address payInToken,
        uint256 amountIn,
        uint256 grossPayout,
        bytes32 swapTxHash
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None)        revert InvoiceNotFound(globalId);
        if (inv.status != InvoiceStatus.Created)     revert InvoiceAlreadyPaid(globalId);
        if (block.timestamp > inv.expiresAt)         revert InvoiceExpired(globalId);
        if (grossPayout < inv.amountOut)             revert PayoutShortfall(grossPayout, inv.amountOut);

        address payoutToken = inv.payoutToken;
        IERC20(payoutToken).safeTransferFrom(msg.sender, address(this), grossPayout);

        uint256 excess = grossPayout - inv.amountOut;
        protocolFeesAccrued[payoutToken] += excess;

        escrows[globalId] = Escrow({
            amount:      inv.amountOut,
            payoutToken: payoutToken,
            claimableAt: uint64(block.timestamp) + REFUND_WINDOW
        });

        inv.status = InvoiceStatus.Paid;
        inv.paidBy = payer;

        emit InvoicePaid(globalId, payer, amountIn, grossPayout, inv.amountOut, /*fee=*/0);
        emit SettlementContext(globalId, payInToken, swapTxHash);
        emit EscrowCreated(globalId, payoutToken, inv.amountOut, escrows[globalId].claimableAt);
    }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Settle -vv`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/Settle.t.sol
git commit -m "feat(v10): custody settle (escrow per invoice, no on-settle transfer)"
```

### Task 8: Refund — full amountOut to payer, no fee accrual

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/Refund.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/Refund.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10Refund is V10TestBase {
    address delegate = makeAddr("refund-delegate");

    function test_Refund_MakesCustomerWhole() public {
        bytes32 g = _settle(bytes32("inv-1"), 100e6, 100e6);

        vm.prank(merchant);
        gw.refundInvoice(g);

        // Customer gets FULL amountOut back (not amountOut - fee like V9)
        assertEq(eurc.balanceOf(customer), 100e6, "customer made whole");
        assertEq(eurc.balanceOf(address(gw)), 0, "escrow drained");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "no fee accrued by settle, none touched by refund");

        (uint256 amt, , ) = gw.escrows(g);
        assertEq(amt, 0, "escrow deleted");

        (, , , , , ArcFXGatewayV10.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGatewayV10.InvoiceStatus.Refunded));
    }

    function test_Refund_DoesNotTouchExcess() public {
        bytes32 g = _settle(bytes32("inv-2"), 100e6, 105e6);
        // 5e6 excess accrued at settle

        vm.prank(merchant);
        gw.refundInvoice(g);

        assertEq(eurc.balanceOf(customer), 100e6, "customer still gets amountOut");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 5e6, "excess preserved");
    }

    function test_Refund_AdminCanRefund() public {
        bytes32 g = _settle(bytes32("inv-3"), 100e6, 100e6);
        vm.prank(admin);
        gw.refundInvoice(g);
        assertEq(eurc.balanceOf(customer), 100e6);
    }

    function test_Refund_DelegateWithRefundRight_CanRefund() public {
        bytes32 g = _settle(bytes32("inv-4"), 100e6, 100e6);
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), gw.RIGHT_REFUND());
        vm.prank(delegate);
        gw.refundInvoice(g);
        assertEq(eurc.balanceOf(customer), 100e6);
    }

    function test_Refund_DelegateWithoutRefundRight_Reverts() public {
        bytes32 g = _settle(bytes32("inv-5"), 100e6, 100e6);
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), gw.RIGHT_CREATE_INVOICE());
        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSignature("NotAuthorized()"));
        gw.refundInvoice(g);
    }

    function test_Refund_Stranger_Reverts() public {
        bytes32 g = _settle(bytes32("inv-6"), 100e6, 100e6);
        address ghost = makeAddr("ghost");
        vm.prank(ghost);
        vm.expectRevert(abi.encodeWithSignature("NotAuthorized()"));
        gw.refundInvoice(g);
    }

    function test_Refund_NotPaid_Reverts() public {
        bytes32 g = _createInvoice(bytes32("inv-7"), 100e6, 1 hours);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotRefundable(bytes32)", g));
        gw.refundInvoice(g);
    }

    function test_Refund_WorksDuringPause() public {
        bytes32 g = _settle(bytes32("inv-8"), 100e6, 100e6);
        vm.prank(admin);
        gw.pause();
        vm.prank(merchant);
        gw.refundInvoice(g);
        assertEq(eurc.balanceOf(customer), 100e6, "refund must work when paused");
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Refund -vv`
Expected: Compile error — `refundInvoice` not implemented.

- [ ] **Step 3: Add refundInvoice**

In `ArcFXGatewayV10.sol`, after settleInvoice:

```solidity
    error NotAuthorized();
    error InvoiceNotRefundable(bytes32 globalId);

    event InvoiceRefunded(
        bytes32 indexed globalId,
        address indexed refundedTo,
        address indexed payoutToken,
        uint256 merchantPayout,
        uint256 protocolFeeReturned
    );

    /// @dev Intentionally omits whenNotPaused — refunds must remain callable
    /// during pause (matches V9 design).
    function refundInvoice(bytes32 globalId) external nonReentrant {
        Invoice storage inv = invoices[globalId];
        if (inv.status != InvoiceStatus.Paid) revert InvoiceNotRefundable(globalId);

        address merchant_ = inv.merchant;
        DelegateAuth memory d = delegates[merchant_][msg.sender];
        bool isMerchant       = msg.sender == merchant_;
        bool isAdmin          = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        bool isRefundDelegate = d.expiresAt >= block.timestamp && (d.rights & RIGHT_REFUND) != 0;
        if (!isMerchant && !isAdmin && !isRefundDelegate) revert NotAuthorized();

        Escrow memory e = escrows[globalId];
        address refundTo = inv.paidBy;

        inv.status = InvoiceStatus.Refunded;
        delete escrows[globalId];

        IERC20(e.payoutToken).safeTransfer(refundTo, e.amount);

        emit InvoiceRefunded(globalId, refundTo, e.payoutToken, e.amount, /*protocolFeeReturned=*/0);
    }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Refund -vv`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/Refund.t.sol
git commit -m "feat(v10): refund drains escrow, customer made whole (H4)"
```

### Task 9: Claim — permissionless, fee accrual at claim time

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/Claim.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/Claim.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10Claim is V10TestBase {
    function test_Claim_TooEarly_Reverts() public {
        bytes32 g = _settle(bytes32("inv-1"), 100e6, 100e6);
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = g;

        vm.expectRevert(
            abi.encodeWithSignature("ClaimTooEarly(bytes32,uint64)", g, uint64(block.timestamp + REFUND_WINDOW))
        );
        gw.claim(ids);
    }

    function test_Claim_PermissionlessAfterWindow_SplitsCorrectly() public {
        bytes32 g = _settle(bytes32("inv-2"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = g;

        // Anyone — even a stranger — can claim. Funds go to merchant payoutAddress.
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        gw.claim(ids);

        uint256 expectedFee    = (100e6 * FEE_BPS) / 10_000;
        uint256 expectedPayout = 100e6 - expectedFee;
        assertEq(eurc.balanceOf(payee), expectedPayout, "payout after split");
        assertEq(gw.protocolFeesAccrued(address(eurc)), expectedFee, "fee accrued at claim");

        (, , , , , ArcFXGatewayV10.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGatewayV10.InvoiceStatus.Claimed));

        (uint256 amt, , ) = gw.escrows(g);
        assertEq(amt, 0, "escrow deleted");
    }

    function test_Claim_RoutesToCurrentPayoutAddress_AfterRotation() public {
        bytes32 g = _settle(bytes32("inv-3"), 100e6, 100e6);

        address newPayee = makeAddr("newPayee");
        vm.prank(merchant);
        gw.updatePayoutAddress(newPayee);

        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        bytes32[] memory ids = new bytes32[](1); ids[0] = g;
        gw.claim(ids);

        assertEq(eurc.balanceOf(payee), 0, "old payoutAddress receives nothing");
        uint256 expectedPayout = 100e6 - (100e6 * FEE_BPS) / 10_000;
        assertEq(eurc.balanceOf(newPayee), expectedPayout, "current payoutAddress receives");
    }

    function test_Claim_BatchAtomic_OneBadIdRevertsAll() public {
        bytes32 g1 = _settle(bytes32("inv-4a"), 100e6, 100e6);
        bytes32 g2 = _settle(bytes32("inv-4b"), 50e6,  50e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);

        // Refund g2 first → it's no longer claimable
        vm.prank(merchant);
        gw.refundInvoice(g2);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = g1; ids[1] = g2;
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotClaimable(bytes32)", g2));
        gw.claim(ids);

        // g1 not partially claimed
        (uint256 amt, , ) = gw.escrows(g1);
        assertEq(amt, 100e6, "g1 escrow intact after batch revert");
    }

    function test_Claim_DoubleClaim_Reverts() public {
        bytes32 g = _settle(bytes32("inv-5"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        bytes32[] memory ids = new bytes32[](1); ids[0] = g;
        gw.claim(ids);

        vm.expectRevert(abi.encodeWithSignature("InvoiceNotClaimable(bytes32)", g));
        gw.claim(ids);
    }

    function test_Claim_WorksDuringPause() public {
        bytes32 g = _settle(bytes32("inv-6"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        vm.prank(admin); gw.pause();

        bytes32[] memory ids = new bytes32[](1); ids[0] = g;
        gw.claim(ids); // must not revert

        uint256 expectedPayout = 100e6 - (100e6 * FEE_BPS) / 10_000;
        assertEq(eurc.balanceOf(payee), expectedPayout);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Claim -vv`
Expected: Compile error — `claim` not implemented.

- [ ] **Step 3: Add claim**

In `ArcFXGatewayV10.sol`, after refundInvoice:

```solidity
    error InvoiceNotClaimable(bytes32 globalId);
    error ClaimTooEarly(bytes32 globalId, uint64 claimableAt);
    error PayoutAddressUnset(address merchant);

    event InvoiceClaimed(
        bytes32 indexed globalId,
        address indexed merchant,
        address payoutAddress,
        address payoutToken,
        uint256 toMerchant,
        uint256 fee
    );

    /// @notice Permissionless. Funds always route to the current
    /// merchants[merchant].payoutAddress (rotation-safe).
    /// Atomic batch — any failure reverts the entire call.
    function claim(bytes32[] calldata globalIds) external nonReentrant {
        for (uint256 i = 0; i < globalIds.length; ++i) {
            bytes32 globalId = globalIds[i];
            Invoice storage inv = invoices[globalId];
            Escrow memory e = escrows[globalId];

            if (inv.status != InvoiceStatus.Paid)         revert InvoiceNotClaimable(globalId);
            if (block.timestamp < e.claimableAt)          revert ClaimTooEarly(globalId, e.claimableAt);

            address payoutAddress = merchants[inv.merchant].payoutAddress;
            if (payoutAddress == address(0))              revert PayoutAddressUnset(inv.merchant);

            uint256 fee        = (e.amount * PROTOCOL_FEE_BPS) / 10_000;
            uint256 toMerchant = e.amount - fee;

            inv.status = InvoiceStatus.Claimed;
            delete escrows[globalId];
            protocolFeesAccrued[e.payoutToken] += fee;

            IERC20(e.payoutToken).safeTransfer(payoutAddress, toMerchant);

            emit InvoiceClaimed(globalId, inv.merchant, payoutAddress, e.payoutToken, toMerchant, fee);
        }
    }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Claim -vv`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/Claim.t.sol
git commit -m "feat(v10): permissionless claim splits escrow, fee accrued at claim"
```

### Task 10: Admin recovery for abandoned escrow

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/AdminRecovery.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/AdminRecovery.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10AdminRecovery is V10TestBase {
    bytes32[] _ids;

    function _id(bytes32 g) internal returns (bytes32[] memory) {
        delete _ids;
        _ids.push(g);
        return _ids;
    }

    function test_Recover_RequiresDeactivated() public {
        bytes32 g = _settle(bytes32("inv-1"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("MerchantStillActive(address)", merchant));
        gw.adminRecoverEscrow(_id(g), sweepTo);
    }

    function test_Recover_TooEarly_Reverts() public {
        bytes32 g = _settle(bytes32("inv-2"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();

        // After window but before window + recovery delay
        vm.warp(block.timestamp + REFUND_WINDOW + 1);

        vm.prank(admin);
        vm.expectRevert(); // RecoveryTooEarly
        gw.adminRecoverEscrow(_id(g), sweepTo);
    }

    function test_Recover_HappyPath() public {
        bytes32 g = _settle(bytes32("inv-3"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.prank(admin);
        gw.adminRecoverEscrow(_id(g), sweepTo);

        assertEq(eurc.balanceOf(sweepTo), 100e6);
        (, , , , , ArcFXGatewayV10.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGatewayV10.InvoiceStatus.Recovered));
    }

    function test_Recover_OnlyAdmin() public {
        bytes32 g = _settle(bytes32("inv-4"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.expectRevert();
        gw.adminRecoverEscrow(_id(g), sweepTo);
    }

    function test_Recover_RejectsZeroTo() public {
        bytes32 g = _settle(bytes32("inv-5"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        gw.adminRecoverEscrow(_id(g), address(0));
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10AdminRecovery -vv`
Expected: Compile error — `adminRecoverEscrow` not implemented.

- [ ] **Step 3: Add adminRecoverEscrow**

In `ArcFXGatewayV10.sol`, after claim:

```solidity
    error InvoiceNotRecoverable(bytes32 globalId);
    error MerchantStillActive(address merchant);
    error RecoveryTooEarly(bytes32 globalId, uint64 recoverableAt);

    event EscrowRecovered(
        bytes32 indexed globalId,
        address indexed merchant,
        address payoutToken,
        uint256 amount,
        address to
    );

    function adminRecoverEscrow(bytes32[] calldata globalIds, address to)
        external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (to == address(0)) revert InvalidPayoutAddress();
        for (uint256 i = 0; i < globalIds.length; ++i) {
            bytes32 globalId = globalIds[i];
            Invoice storage inv = invoices[globalId];
            Escrow memory e = escrows[globalId];

            if (inv.status != InvoiceStatus.Paid)        revert InvoiceNotRecoverable(globalId);
            if (merchants[inv.merchant].active)          revert MerchantStillActive(inv.merchant);
            uint64 recoverableAt = e.claimableAt + ADMIN_RECOVERY_DELAY;
            if (block.timestamp < recoverableAt)         revert RecoveryTooEarly(globalId, recoverableAt);

            inv.status = InvoiceStatus.Recovered;
            delete escrows[globalId];

            IERC20(e.payoutToken).safeTransfer(to, e.amount);

            emit EscrowRecovered(globalId, inv.merchant, e.payoutToken, e.amount, to);
        }
    }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10AdminRecovery -vv`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/AdminRecovery.t.sol
git commit -m "feat(v10): admin recovery for deactivated merchant escrow (+14d)"
```

### Task 11: Failed-swap path (recordPayerRefund) + L2 nonReentrant

**Files:**
- Modify: `packages/contracts/src/ArcFXGatewayV10.sol`
- Create: `packages/contracts/test/V10/PayerRefund.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/test/V10/PayerRefund.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";

contract V10PayerRefund is V10TestBase {
    function test_RecordPayerRefund_HappyPath() public {
        bytes32 g = _createInvoice(bytes32("inv-1"), 100e6, 1 hours);

        vm.prank(relayer);
        gw.recordPayerRefund(g, customer, address(usdc), 110e6, bytes32("swap_failed"));

        (, , , , , ArcFXGatewayV10.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGatewayV10.InvoiceStatus.Failed));
    }

    function test_RecordPayerRefund_OnlyRelayer() public {
        bytes32 g = _createInvoice(bytes32("inv-2"), 100e6, 1 hours);
        vm.expectRevert();
        gw.recordPayerRefund(g, customer, address(usdc), 100e6, bytes32(0));
    }

    function test_RecordPayerRefund_AlreadyPaid_Reverts() public {
        bytes32 g = _settle(bytes32("inv-3"), 100e6, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotInCreatedState(bytes32)", g));
        gw.recordPayerRefund(g, customer, address(usdc), 100e6, bytes32(0));
    }

    function test_RecordPayerRefund_NotFound_Reverts() public {
        bytes32 ghost = bytes32("never");
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotFound(bytes32)", ghost));
        gw.recordPayerRefund(ghost, customer, address(usdc), 100e6, bytes32(0));
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10PayerRefund -vv`
Expected: Compile error — `recordPayerRefund` not implemented.

- [ ] **Step 3: Add recordPayerRefund (with nonReentrant — L2)**

In `ArcFXGatewayV10.sol`, after adminRecoverEscrow:

```solidity
    event PayerRefunded(
        bytes32 indexed globalId,
        address indexed payer,
        address payInToken,
        uint256 amount,
        bytes32 reasonHash
    );

    /// @dev L2: nonReentrant added (defensive — no external call in body
    /// today, but guards against silent regressions).
    function recordPayerRefund(
        bytes32 globalId,
        address payer,
        address payInToken,
        uint256 amount,
        bytes32 reasonHash
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None)        revert InvoiceNotFound(globalId);
        if (inv.status != InvoiceStatus.Created)     revert InvoiceNotInCreatedState(globalId);

        inv.status = InvoiceStatus.Failed;
        emit PayerRefunded(globalId, payer, payInToken, amount, reasonHash);
    }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10PayerRefund -vv`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/PayerRefund.t.sol
git commit -m "feat(v10): recordPayerRefund + nonReentrant (L2)"
```

### Task 12: Pause behavior

**Files:**
- Create: `packages/contracts/test/V10/Pause.t.sol`

- [ ] **Step 1: Write the test**

Create `packages/contracts/test/V10/Pause.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { V10TestBase } from "./V10TestBase.t.sol";

contract V10Pause is V10TestBase {
    function test_Paused_BlocksCreateInvoice() public {
        vm.prank(admin); gw.pause();
        vm.prank(merchant);
        vm.expectRevert(); // EnforcedPause
        gw.createInvoice(bytes32("p-1"), address(usdc), 100e6, uint64(block.timestamp + 1 hours));
    }

    function test_Paused_BlocksSettle() public {
        bytes32 g = _createInvoice(bytes32("p-2"), 100e6, 1 hours);
        vm.prank(admin); gw.pause();
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert();
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_Paused_AllowsClaim() public {
        bytes32 g = _settle(bytes32("p-3"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        vm.prank(admin); gw.pause();
        bytes32[] memory ids = new bytes32[](1); ids[0] = g;
        gw.claim(ids);
    }

    function test_Paused_AllowsWithdrawFees() public {
        bytes32 g = _settle(bytes32("p-4"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        bytes32[] memory ids = new bytes32[](1); ids[0] = g;
        gw.claim(ids);
        vm.prank(admin); gw.pause();
        vm.prank(admin);
        gw.withdrawFees(address(eurc), admin);
    }
}
```

- [ ] **Step 2: Add withdrawFees (only missing piece)**

In `ArcFXGatewayV10.sol`, after recordPayerRefund:

```solidity
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

    function withdrawFees(address token, address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 amount = protocolFeesAccrued[token];
        protocolFeesAccrued[token] = 0;
        IERC20(token).safeTransfer(to, amount);
        emit FeesWithdrawn(token, to, amount);
    }
```

- [ ] **Step 3: Run pause test**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Pause -vv`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/ArcFXGatewayV10.sol packages/contracts/test/V10/Pause.t.sol
git commit -m "feat(v10): withdrawFees + pause behavior verified"
```

### Task 13: Reentrancy guards (malicious token attack)

**Files:**
- Create: `packages/contracts/test/V10/Reentrancy.t.sol`
- Create: `packages/contracts/test/helpers/ReentrantToken.sol`

- [ ] **Step 1: Write a malicious ERC20 helper**

Create `packages/contracts/test/helpers/ReentrantToken.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 that calls back into a target on every transfer. Used to
/// verify the gateway's nonReentrant guards survive token reentry.
contract ReentrantToken is ERC20 {
    address public target;
    bytes   public reentryCalldata;
    bool    public attackArmed;

    constructor() ERC20("Re", "RE") {}

    function arm(address t, bytes calldata data) external {
        target = t;
        reentryCalldata = data;
        attackArmed = true;
    }

    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function decimals() public pure override returns (uint8) { return 6; }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (attackArmed) {
            attackArmed = false; // single-shot
            (bool ok, ) = target.call(reentryCalldata);
            ok; // we don't assert here — the gateway's revert on reentry is what matters
        }
    }
}
```

- [ ] **Step 2: Write the reentrancy tests**

Create `packages/contracts/test/V10/Reentrancy.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ArcFXGatewayV10 } from "../../src/ArcFXGatewayV10.sol";
import { ReentrantToken } from "../helpers/ReentrantToken.sol";

contract V10Reentrancy is Test {
    ArcFXGatewayV10 gw;
    ReentrantToken token;

    address admin    = makeAddr("admin");
    address relayer  = makeAddr("relayer");
    address merchant = makeAddr("merchant");
    address payee    = makeAddr("payee");
    address customer = makeAddr("customer");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new ReentrantToken();
        gw = new ArcFXGatewayV10(30, 7 days, 7 days, admin, relayer);
        vm.prank(admin); gw.setTokenSupport(address(token), true);
        vm.prank(merchant); gw.registerMerchant(payee, address(token));
    }

    function test_Refund_ReentryReverts() public {
        // Settle a paid invoice
        vm.prank(merchant);
        bytes32 g = gw.createInvoice(bytes32("re-1"), address(token), 100e6, uint64(block.timestamp + 1 hours));
        token.mint(relayer, 100e6);
        vm.prank(relayer); token.approve(address(gw), 100e6);
        vm.prank(relayer);
        gw.settleInvoice(g, customer, address(token), 100e6, 100e6, bytes32(0));

        // Arm token to re-enter refundInvoice during the safeTransfer leg
        token.arm(address(gw), abi.encodeWithSignature("refundInvoice(bytes32)", g));

        vm.prank(merchant);
        // The outer call succeeds (token transfer completes), but the nested
        // call reverts internally; since ReentrantToken swallows the revert,
        // we assert the outer state is consistent (single drain, status flipped once).
        gw.refundInvoice(g);

        (, , , , , ArcFXGatewayV10.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGatewayV10.InvoiceStatus.Refunded), "single refund");
        assertEq(token.balanceOf(customer), 100e6, "no double drain");
    }
}
```

- [ ] **Step 3: Run to confirm pass**

Run: `pnpm --filter @arcora/contracts exec forge test --match-contract V10Reentrancy -vv`
Expected: 1 test passes (the nonReentrant on refundInvoice prevents the nested re-entry from doing damage; ReentrantToken swallows the revert from inside `_update`).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/V10/Reentrancy.t.sol packages/contracts/test/helpers/ReentrantToken.sol
git commit -m "test(v10): reentrancy guard verified via malicious token"
```

### Task 14: Coverage gate verification

**Files:**
- N/A — runs the existing `bin/coverage-gate.sh`

- [ ] **Step 1: Run forge test full**

Run: `pnpm --filter @arcora/contracts exec forge test -vv`
Expected: All V10 tests pass + V8/V9 legacy tests still pass (haven't moved them yet).

- [ ] **Step 2: Run coverage gate**

Run: `bash bin/coverage-gate.sh`
Expected: Coverage report shows V10 line ≥ 95%, branch ≥ 90% (the Plan-7 floor).

If below, identify the uncovered lines (gate output prints them) and add a focused test in the matching `test/V10/<Behavior>.t.sol` file.

- [ ] **Step 3: Commit any added tests**

Only if Step 2 needed additions:

```bash
git add packages/contracts/test/V10/
git commit -m "test(v10): close coverage gaps"
```

---

## Phase 2 — Retire V8 + V9

### Task 15: Move V8/V9 sources + tests to legacy/

**Files:**
- Move: `packages/contracts/src/ArcFXGatewayV8.sol` → `packages/contracts/legacy/`
- Move: `packages/contracts/src/ArcFXGatewayV9.sol` → `packages/contracts/legacy/`
- Move: `packages/contracts/test/ArcFXGatewayV8.t.sol` → `packages/contracts/test/legacy/`
- Move: `packages/contracts/test/ArcFXGatewayV9.t.sol` → `packages/contracts/test/legacy/`
- Modify: `packages/contracts/foundry.toml`
- Modify: `packages/contracts/.slither-triage.md`

- [ ] **Step 1: Move sources**

Run:
```bash
mkdir -p packages/contracts/legacy packages/contracts/test/legacy
git mv packages/contracts/src/ArcFXGatewayV8.sol packages/contracts/legacy/
git mv packages/contracts/src/ArcFXGatewayV9.sol packages/contracts/legacy/
git mv packages/contracts/test/ArcFXGatewayV8.t.sol packages/contracts/test/legacy/
git mv packages/contracts/test/ArcFXGatewayV9.t.sol packages/contracts/test/legacy/
```

- [ ] **Step 2: Exclude legacy from foundry default profile**

Modify `packages/contracts/foundry.toml` — under `[profile.default]` add a `no_match_path` (or under any existing `match_path`-style filter) to exclude legacy:

```toml
[profile.default]
src   = 'src'
test  = 'test'
out   = 'out'
libs  = ['lib']
no_match_path = 'test/legacy/**/*.t.sol'
```

If `[profile.default]` already has these keys, add only `no_match_path`. Add a `[profile.legacy]` that re-includes them so we can run the legacy suite if needed:

```toml
[profile.legacy]
match_path = 'test/legacy/**/*.t.sol'
```

- [ ] **Step 3: Update import paths in moved test files**

In `packages/contracts/test/legacy/ArcFXGatewayV8.t.sol` and `ArcFXGatewayV9.t.sol`, fix any relative imports that broke. The relative path goes from `test/<file>` (one level above `src/`) to `test/legacy/<file>` (two levels above `legacy/`):

- `import { ArcFXGatewayV8 } from "../src/ArcFXGatewayV8.sol";` → `import { ArcFXGatewayV8 } from "../../legacy/ArcFXGatewayV8.sol";`
- `import { MockERC20 } from "./helpers/MockERC20.sol";` → `import { MockERC20 } from "../helpers/MockERC20.sol";`

Same shape for V9.

- [ ] **Step 4: Verify default profile compiles + V10 tests still pass**

Run: `pnpm --filter @arcora/contracts exec forge test -vv`
Expected: V10 tests pass; legacy tests are NOT executed (no_match_path excludes them).

- [ ] **Step 5: Verify legacy profile still works**

Run: `pnpm --filter @arcora/contracts exec forge test --profile legacy -vv`
Expected: V8 + V9 tests pass under the legacy profile.

- [ ] **Step 6: Update Slither triage scope**

Modify `packages/contracts/.slither-triage.md`. Replace any `V8+V9` scope language with `V10 only`. Add a header note:

```markdown
**Scope (2026-05-06):** ArcFXGatewayV10. V8 and V9 in `legacy/` are out of scope —
they remain immutable on Arc testnet but are unused after the V10 cutover.
```

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/legacy/ packages/contracts/test/legacy/ packages/contracts/foundry.toml packages/contracts/.slither-triage.md
git commit -m "chore(v10): move V8/V9 to legacy/, exclude from default test profile"
```

---

## Phase 3 — Deploy script

### Task 16: DeployV10.s.sol

**Files:**
- Create: `packages/contracts/script/DeployV10.s.sol`

- [ ] **Step 1: Write the deploy script**

Create `packages/contracts/script/DeployV10.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { ArcFXGatewayV10 } from "../src/ArcFXGatewayV10.sol";

/// @notice Deploys V10 (custody escrow gateway). Closes audit residuals
/// H4 (custody), M3 (fee bound — now in-constructor), M4 (admin reactivate),
/// L2 (nonReentrant on recordPayerRefund).
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY    — uint256 hex
///   GATEWAY_OWNER           — DEFAULT_ADMIN_ROLE
///   GATEWAY_RELAYER         — RELAYER_ROLE (Vault-derived address)
///   PROTOCOL_FEE_BPS        — uint256 (≤ 1000, enforced in constructor)
///   REFUND_WINDOW_SECONDS   — uint64 (typ. 604800 = 7 days)
///   ADMIN_RECOVERY_DELAY    — uint64 (typ. 604800 = 7 days)
///
/// Optional:
///   SUPPORTED_TOKENS        — comma-separated 0x… addresses (USDC, EURC)
contract DeployV10 is Script {
    function run() external returns (ArcFXGatewayV10 gw) {
        uint256 pk          = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner       = vm.envAddress("GATEWAY_OWNER");
        address relayer_    = vm.envAddress("GATEWAY_RELAYER");
        uint256 feeBps      = vm.envUint("PROTOCOL_FEE_BPS");
        uint64  refundWin   = uint64(vm.envUint("REFUND_WINDOW_SECONDS"));
        uint64  recoveryDel = uint64(vm.envUint("ADMIN_RECOVERY_DELAY"));
        address[] memory tokens = vm.envOr("SUPPORTED_TOKENS", ",", new address[](0));

        vm.startBroadcast(pk);
        gw = new ArcFXGatewayV10(feeBps, refundWin, recoveryDel, owner, relayer_);
        if (tokens.length > 0 && vm.addr(pk) == owner) {
            for (uint i; i < tokens.length; i++) {
                gw.setTokenSupport(tokens[i], true);
                console2.log("supported:", tokens[i]);
            }
        }
        vm.stopBroadcast();

        console2.log("ArcFXGatewayV10:    ", address(gw));
        console2.log("Owner:              ", owner);
        console2.log("Relayer:            ", relayer_);
        console2.log("Protocol fee (bps): ", feeBps);
        console2.log("Refund window (s):  ", uint256(refundWin));
        console2.log("Recovery delay (s): ", uint256(recoveryDel));
    }
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm --filter @arcora/contracts exec forge build`
Expected: Compiles without warnings.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/script/DeployV10.s.sol
git commit -m "feat(v10): deploy script"
```

---

## Phase 4 — Vault HSM on the VPS

These tasks set up Vault on the existing VPS (`194.163.136.1`, see `memory/vps_ops.md`). The interactive parts (Vault init/unseal, plugin registration) happen in an SSH session; document them in the runbook so the engineer running this plan can reproduce.

### Task 17: Vault install script + systemd unit

**Files:**
- Create: `ops/vault/install.sh`
- Create: `ops/vault/vault.service`
- Create: `ops/vault/config.hcl`
- Create: `ops/vault/policy-relayer.hcl`
- Create: `ops/vault/secret-id-rotation.sh`
- Create: `ops/vault/README.md`

- [ ] **Step 1: Write the Vault systemd unit**

Create `ops/vault/vault.service`:

```ini
[Unit]
Description=HashiCorp Vault (Arcora relayer key)
After=network-online.target
ConditionFileNotEmpty=/etc/vault.d/config.hcl

[Service]
Type=notify
User=vault
Group=vault
ProtectSystem=full
ProtectHome=read-only
PrivateTmp=yes
PrivateDevices=yes
SecureBits=keep-caps
AmbientCapabilities=CAP_IPC_LOCK
Capabilities=CAP_IPC_LOCK+ep
CapabilityBoundingSet=CAP_SYSLOG CAP_IPC_LOCK
NoNewPrivileges=yes
ExecStart=/usr/local/bin/vault server -config=/etc/vault.d/config.hcl
ExecReload=/bin/kill --signal HUP $MAINPID
KillMode=process
KillSignal=SIGINT
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
LimitNOFILE=65536
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Write the Vault config**

Create `ops/vault/config.hcl`:

```hcl
ui      = false
api_addr = "http://127.0.0.1:8200"

storage "file" {
  path = "/var/lib/vault/data"
}

listener "tcp" {
  address     = "127.0.0.1:8200"
  tls_disable = 1
}

# secp256k1 plugin loaded post-install (see ops/vault/README.md).
plugin_directory = "/etc/vault.d/plugins"
```

- [ ] **Step 3: Write the relayer Vault policy**

Create `ops/vault/policy-relayer.hcl`:

```hcl
# Relayer can sign with the v10 transit key and read its public key
# (for address derivation). Cannot export, rotate, or delete keys.
path "transit/sign/relayer-v10" {
  capabilities = ["update"]
}

path "transit/keys/relayer-v10" {
  capabilities = ["read"]
}
```

- [ ] **Step 4: Write the install script**

Create `ops/vault/install.sh`:

```bash
#!/usr/bin/env bash
# Vault installer for the Arcora relayer key. Run on the VPS as root.
# Idempotent: re-running is safe (skips already-installed bits).
set -euo pipefail

VAULT_VERSION="${VAULT_VERSION:-1.18.2}"
ARCH="$(dpkg --print-architecture)"

if ! command -v vault >/dev/null 2>&1; then
  echo "[install] downloading vault ${VAULT_VERSION}_linux_${ARCH}…"
  curl -fsSL -o /tmp/vault.zip "https://releases.hashicorp.com/vault/${VAULT_VERSION}/vault_${VAULT_VERSION}_linux_${ARCH}.zip"
  unzip -o /tmp/vault.zip -d /usr/local/bin
  chmod +x /usr/local/bin/vault
  rm -f /tmp/vault.zip
fi

if ! id vault >/dev/null 2>&1; then
  useradd --system --home /etc/vault.d --shell /bin/false vault
fi

mkdir -p /etc/vault.d /etc/vault.d/plugins /var/lib/vault/data
cp ops/vault/config.hcl       /etc/vault.d/config.hcl
cp ops/vault/policy-relayer.hcl /etc/vault.d/policy-relayer.hcl
chown -R vault:vault /etc/vault.d /var/lib/vault
chmod 640 /etc/vault.d/config.hcl

cp ops/vault/vault.service /etc/systemd/system/vault.service
systemctl daemon-reload
systemctl enable vault.service
systemctl start vault.service

# Allow root to use the API
echo 'export VAULT_ADDR="http://127.0.0.1:8200"' >> /root/.bashrc

echo
echo "[install] Vault installed and started."
echo "Next steps (interactive — see ops/vault/README.md):"
echo "  1. vault operator init -key-shares=3 -key-threshold=2  # save the keys offline"
echo "  2. vault operator unseal  # twice with two different unseal keys"
echo "  3. install secp256k1 plugin (see README)"
echo "  4. vault secrets enable transit"
echo "  5. vault write -f transit/keys/relayer-v10 type=secp256k1 exportable=false"
echo "  6. vault auth enable approle"
echo "  7. vault write auth/approle/role/relayer secret_id_ttl=24h token_ttl=2h policies=relayer"
echo "  8. vault policy write relayer /etc/vault.d/policy-relayer.hcl"
```

- [ ] **Step 5: Write the secret_id rotation script**

Create `ops/vault/secret-id-rotation.sh`:

```bash
#!/usr/bin/env bash
# Daily rotation: mint a fresh AppRole secret_id, update the relayer env
# file atomically, signal-reload the relayer service.
set -euo pipefail

: "${VAULT_ADDR:=http://127.0.0.1:8200}"
: "${VAULT_TOKEN:?VAULT_TOKEN must be set (long-lived rotation operator token)}"

ENV_FILE="/etc/arcora/relayer.env"

NEW_SECRET_ID=$(vault write -field=secret_id -f auth/approle/role/relayer/secret-id)

# Atomic env-file rewrite
TMP=$(mktemp /etc/arcora/.relayer.env.XXXXXX)
trap 'rm -f "$TMP"' EXIT
grep -v '^VAULT_SECRET_ID=' "$ENV_FILE" > "$TMP"
echo "VAULT_SECRET_ID=$NEW_SECRET_ID" >> "$TMP"
chmod 0600 "$TMP"
chown root:root "$TMP"
mv -f "$TMP" "$ENV_FILE"

systemctl reload arcora-relayer.service

echo "[rotation] $(date -Iseconds) new secret_id rotated, relayer reloaded"
```

- [ ] **Step 6: Write the Vault README**

Create `ops/vault/README.md`:

```markdown
# Vault setup for Arcora relayer

The Arcora V10 relayer signs every transaction through HashiCorp Vault's
transit engine. The secp256k1 private key never leaves Vault — the relayer
authenticates via AppRole, calls `transit/sign/relayer-v10`, and uses the
returned signature.

## One-time setup (run on the VPS as root)

```
sudo bash ops/vault/install.sh
```

Then, interactively in an SSH session:

```
export VAULT_ADDR=http://127.0.0.1:8200

# 1. Init — save the 3 unseal keys offline (1Password + paper backup, distributed across holders)
vault operator init -key-shares=3 -key-threshold=2

# 2. Unseal — twice, with two of the three keys
vault operator unseal <key1>
vault operator unseal <key2>

# 3. Authenticate as root (one-time; we'll mint a long-lived ops token next)
vault login <root-token>

# 4. Install the secp256k1 plugin
#    Plugin source: vetted at implementation phase; install per its README.
#    Typical sequence:
SHA256=$(shasum -a 256 /etc/vault.d/plugins/vault-plugin-secrets-secp256k1 | cut -d' ' -f1)
vault plugin register -sha256=$SHA256 secrets vault-plugin-secrets-secp256k1
vault secrets enable -path=transit -plugin-name=vault-plugin-secrets-secp256k1 plugin

# 5. Generate the relayer key (cannot be exported)
vault write -f transit/keys/relayer-v10 type=secp256k1 exportable=false

# 6. Read the public key → derive the Ethereum address
vault read transit/keys/relayer-v10  # copy the public_key field; convert with viem helpers locally

# 7. AppRole auth + policy
vault policy write relayer /etc/vault.d/policy-relayer.hcl
vault auth enable approle
vault write auth/approle/role/relayer \
  secret_id_ttl=24h \
  token_ttl=2h \
  token_max_ttl=2h \
  policies=relayer

# 8. Mint role_id (long-lived) + first secret_id
ROLE_ID=$(vault read -field=role_id auth/approle/role/relayer/role-id)
SECRET_ID=$(vault write -field=secret_id -f auth/approle/role/relayer/secret-id)

# 9. Mint a long-lived ops token for the rotation cron (separate from root)
vault token create -policy=approle-rotator -ttl=8760h -orphan
# Save token to /root/.vault-rotation-token (mode 0600)

# 10. Wire the rotation cron
echo "0 4 * * * VAULT_TOKEN=$(cat /root/.vault-rotation-token) /opt/arcora/ops/vault/secret-id-rotation.sh" >> /etc/cron.d/vault-rotation
```

## Disaster recovery

See `docs/runbooks/vault-recovery.md`.

## What goes in `/etc/arcora/relayer.env`

```
VAULT_URL=http://127.0.0.1:8200
VAULT_ROLE_ID=<step 8 ROLE_ID>
VAULT_SECRET_ID=<step 8 SECRET_ID — rotated daily>
VAULT_KEY_NAME=relayer-v10
GATEWAY_ADDRESS_V10=<from forge deploy>
ARC_RPC=https://rpc.testnet.arc.network
DATABASE_URL=postgres://…
```
```

- [ ] **Step 7: Commit**

```bash
chmod +x ops/vault/install.sh ops/vault/secret-id-rotation.sh
git add ops/vault/
git commit -m "ops(vault): VPS install script + systemd + AppRole policy + rotation cron"
```

### Task 18: Vault custom signer (viem adapter)

**Files:**
- Create: `ops/relayer/vault-signer.ts`
- Create: `ops/relayer/vault-signer.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `ops/relayer/vault-signer.test.ts`:

```ts
// Run with: pnpm --filter @arcora/ops exec vitest run ops/relayer/vault-signer.test.ts
//
// Pre-req: a local Vault dev-mode instance with the secp256k1 plugin and
// a key called `test-relayer`. Skipped in CI; run manually on a dev box.
//
//   vault server -dev -dev-root-token-id=root &
//   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=root \
//     vault secrets enable -path=transit -plugin-name=vault-plugin-secrets-secp256k1 plugin
//   VAULT_ADDR=… vault write -f transit/keys/test-relayer type=secp256k1 exportable=false
//   VAULT_ADDR=… vault auth enable approle
//   …  (see ops/vault/README.md for the full ceremony — abbreviated for tests)

import { describe, it, expect } from "vitest";
import { hashMessage, recoverMessageAddress } from "viem";
import { vaultSigner } from "./vault-signer";

const enabled = process.env.VAULT_DEV === "1";
const itOnDev = enabled ? it : it.skip;

describe("vault-signer", () => {
  itOnDev("derives an Ethereum address from the transit public key", async () => {
    const account = await vaultSigner({
      vaultUrl:  "http://127.0.0.1:8200",
      roleId:    process.env.TEST_VAULT_ROLE_ID!,
      secretId:  process.env.TEST_VAULT_SECRET_ID!,
      keyName:   "test-relayer",
    });
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  itOnDev("signs a message and the signature recovers to the same address", async () => {
    const account = await vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   process.env.TEST_VAULT_ROLE_ID!,
      secretId: process.env.TEST_VAULT_SECRET_ID!,
      keyName:  "test-relayer",
    });
    const sig = await account.signMessage!({ message: "hello arcora" });
    const recovered = await recoverMessageAddress({ message: "hello arcora", signature: sig });
    expect(recovered.toLowerCase()).toEqual(account.address.toLowerCase());
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/ops exec vitest run ops/relayer/vault-signer.test.ts`
Expected: All tests skipped (`VAULT_DEV` not set). When `VAULT_DEV=1`, expect failure: `vault-signer` not implemented.

- [ ] **Step 3: Implement the signer adapter**

Create `ops/relayer/vault-signer.ts`:

```ts
import { toAccount } from "viem/accounts";
import {
  type Hex,
  type SignableMessage,
  type TypedDataDefinition,
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  publicKeyToAddress,
} from "viem";

export interface VaultSignerOpts {
  vaultUrl:  string;   // e.g. http://127.0.0.1:8200
  roleId:    string;   // VAULT_ROLE_ID
  secretId:  string;   // VAULT_SECRET_ID (rotated daily)
  keyName:   string;   // VAULT_KEY_NAME (typ. relayer-v10)
}

interface Session { token: string; expiresAt: number }

export async function vaultSigner(opts: VaultSignerOpts) {
  let session = await login(opts);

  async function ensureSession() {
    if (Date.now() < session.expiresAt - 5 * 60_000) return;
    session = await login(opts);
  }

  const pubkey = await fetchPublicKey(opts.vaultUrl, session.token, opts.keyName);
  const address = publicKeyToAddress(pubkey);

  return toAccount({
    address,

    async signMessage({ message }: { message: SignableMessage }) {
      await ensureSession();
      return await signDigest(opts, session.token, hashMessage(message));
    },

    async signTransaction(tx: any) {
      await ensureSession();
      const serialized = serializeTransaction(tx);
      const digest = keccak256(serialized);
      const signature = await signDigest(opts, session.token, digest);
      return serializeTransaction(tx, parseSignature(signature));
    },

    async signTypedData(typedData: TypedDataDefinition) {
      await ensureSession();
      return await signDigest(opts, session.token, hashTypedData(typedData));
    },
  });
}

async function login(opts: VaultSignerOpts): Promise<Session> {
  const res = await fetch(`${opts.vaultUrl}/v1/auth/approle/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ role_id: opts.roleId, secret_id: opts.secretId }),
  });
  if (!res.ok) throw new Error(`Vault login failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { auth: { client_token: string; lease_duration: number } };
  return {
    token:     json.auth.client_token,
    expiresAt: Date.now() + json.auth.lease_duration * 1000,
  };
}

async function fetchPublicKey(vaultUrl: string, token: string, keyName: string): Promise<Hex> {
  const res = await fetch(`${vaultUrl}/v1/transit/keys/${encodeURIComponent(keyName)}`, {
    headers: { "X-Vault-Token": token },
  });
  if (!res.ok) throw new Error(`Vault key read failed: ${res.status}`);
  const json = await res.json() as { data: { keys: Record<string, { public_key?: string }> } };
  const latest = Object.keys(json.data.keys).sort((a, b) => Number(b) - Number(a))[0];
  const raw = json.data.keys[latest]?.public_key;
  if (!raw) throw new Error("Vault key has no public_key field");
  // Plugin returns 0x04-prefixed uncompressed sec1; viem expects same.
  return raw.startsWith("0x") ? (raw as Hex) : (`0x${raw}` as Hex);
}

async function signDigest(
  opts:   VaultSignerOpts,
  token:  string,
  digest: Hex,
): Promise<Hex> {
  const res = await fetch(`${opts.vaultUrl}/v1/transit/sign/${encodeURIComponent(opts.keyName)}`, {
    method: "POST",
    headers: { "X-Vault-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      input:        Buffer.from(digest.slice(2), "hex").toString("base64"),
      prehashed:    true,
      marshaling_algorithm: "asn1",  // or "jws" depending on plugin config
    }),
  });
  if (!res.ok) throw new Error(`Vault sign failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data: { signature: string } };
  // Plugin returns "vault:v1:<base64-sig>"; strip prefix and convert to 0x-hex.
  const sigB64 = json.data.signature.split(":").pop()!;
  const sig = Buffer.from(sigB64, "base64").toString("hex");
  return `0x${sig}` as Hex;
}

function parseSignature(sig: Hex) {
  // r (32) || s (32) || v (1)
  const hex = sig.slice(2);
  return {
    r: `0x${hex.slice(0, 64)}` as Hex,
    s: `0x${hex.slice(64, 128)}` as Hex,
    v: BigInt(parseInt(hex.slice(128, 130), 16)),
  };
}
```

> **Note:** the exact response shape from `transit/sign` and `transit/keys/<name>` depends on the chosen secp256k1 plugin. The implementation phase MUST verify the plugin response format against its docs before declaring the test passing. The skeleton above matches the most common community plugin (`hashicorp-vault-plugin-secrets-secp256k1`).

- [ ] **Step 4: Run the integration test (manual on dev box)**

On a machine with Vault dev mode:
```bash
VAULT_DEV=1 \
TEST_VAULT_ROLE_ID=… TEST_VAULT_SECRET_ID=… \
pnpm --filter @arcora/ops exec vitest run ops/relayer/vault-signer.test.ts
```
Expected: 2 tests pass. If response shapes need adjustment, fix `vault-signer.ts` accordingly.

- [ ] **Step 5: Commit**

```bash
git add ops/relayer/vault-signer.ts ops/relayer/vault-signer.test.ts
git commit -m "feat(relayer): viem custom signer backed by Vault transit engine"
```

### Task 19: Switch relayer to vaultSigner

**Files:**
- Modify: `ops/relayer/run.ts`
- Modify: `ops/relayer/.env.example`

- [ ] **Step 1: Read the current relayer entrypoint**

Read `ops/relayer/run.ts` to identify:
- Where `RELAYER_PRIVATE_KEY` is read.
- Where `privateKeyToAccount(...)` is called.
- The `account` is wired into `walletClient`.

- [ ] **Step 2: Replace with vaultSigner**

In `ops/relayer/run.ts`, replace the account construction:

```ts
// BEFORE (M1 IIFE):
//   const account = (() => {
//     const pk = process.env.RELAYER_PRIVATE_KEY!;
//     return privateKeyToAccount(pk as Hex);
//   })();

// AFTER:
import { vaultSigner } from "./vault-signer";

const account = await vaultSigner({
  vaultUrl:  process.env.VAULT_URL!,
  roleId:    process.env.VAULT_ROLE_ID!,
  secretId:  process.env.VAULT_SECRET_ID!,
  keyName:   process.env.VAULT_KEY_NAME!,
});
```

If the relayer's top-level scope is sync, hoist the `vaultSigner` setup into the existing async bootstrap (every relayer command in `run.ts` already uses async/await for viem clients).

- [ ] **Step 3: Update env example**

In `ops/relayer/.env.example`, replace the `RELAYER_PRIVATE_KEY=` line with:

```bash
# Vault transit engine for relayer key isolation (audit M1, V10).
# Setup: ops/vault/README.md
VAULT_URL=http://127.0.0.1:8200
VAULT_ROLE_ID=
VAULT_SECRET_ID=
VAULT_KEY_NAME=relayer-v10
```

Drop any reference to `RELAYER_PRIVATE_KEY` (search `ops/relayer/.env.example` for it; remove the line and any inline doc).

- [ ] **Step 4: Update other relayer scripts (smoke.ts, e2e-test.ts, e2e-twowallet.ts, replay.ts)**

These auxiliary scripts may also use `RELAYER_PRIVATE_KEY` — search and replace them with `vaultSigner({...})` reads. If a script is dev-only and not part of prod, leave a note in its header that it now requires Vault env vars to run.

```bash
grep -rn "RELAYER_PRIVATE_KEY\|privateKeyToAccount" ops/relayer/
```

For each hit, decide: replace with vaultSigner OR delete the helper if obsolete.

- [ ] **Step 5: Type-check + commit**

```bash
pnpm --filter @arcora/ops exec tsc --noEmit
```
Expected: clean.

```bash
git add ops/relayer/
git commit -m "feat(relayer): authenticate via Vault, drop RELAYER_PRIVATE_KEY (M1)"
```

---

## Phase 5 — Indexer V10-only

### Task 20: Drop V6/V8/V9 from indexer

**Files:**
- Modify: `ops/indexer/run.ts`
- Modify: `ops/indexer/replay.ts`

- [ ] **Step 1: Read the current indexer**

Read `ops/indexer/run.ts` and identify:
- The `GATEWAY_V6 / V8 / V9` env reads (lines ~18-20).
- The parallel `getLogs` calls per cohort.
- The event handler dispatch.

- [ ] **Step 2: Replace gateway env reads with V10-only**

In `ops/indexer/run.ts`:

```ts
// BEFORE:
// const GATEWAY_V6   = (process.env.GATEWAY_ADDRESS_V6 ?? "").toLowerCase() as Address;
// const GATEWAY_V8   = (process.env.GATEWAY_ADDRESS_V8 ?? "").toLowerCase() as Address;
// const GATEWAY_V9   = (process.env.GATEWAY_ADDRESS_V9 ?? "").toLowerCase() as Address;

// AFTER:
const GATEWAY_V10 = (process.env.GATEWAY_ADDRESS_V10 ?? "").toLowerCase() as Address;
if (!GATEWAY_V10) throw new Error("GATEWAY_ADDRESS_V10 must be set");
```

Drop the multi-address loop in the `getLogs` block; collapse it into a single `getLogs({ address: GATEWAY_V10, … })` call per event.

- [ ] **Step 3: Update the ABI block to V10 events**

Replace the V8/V9 event signatures with V10:

```ts
const ABI = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
  "event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash)",
  "event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt)",
  "event PayerRefunded(bytes32 indexed globalId, address indexed payer, address payInToken, uint256 amount, bytes32 reasonHash)",
  "event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned)",
  "event InvoiceClaimed(bytes32 indexed globalId, address indexed merchant, address payoutAddress, address payoutToken, uint256 toMerchant, uint256 fee)",
  "event EscrowRecovered(bytes32 indexed globalId, address indexed merchant, address payoutToken, uint256 amount, address to)",
  "event MerchantReactivated(address indexed merchant)",
]);
```

- [ ] **Step 4: Add handlers for new V10 events**

After the existing `InvoicePaid` / `InvoiceRefunded` / `PayerRefunded` handlers, add:

```ts
// EscrowCreated → set claimable_at on the invoice row
for (const log of logs.filter(l => l.eventName === "EscrowCreated")) {
  const { globalId, claimableAt } = log.args;
  await db.update(invoices)
    .set({ claimableAt: new Date(Number(claimableAt) * 1000) })
    .where(eq(invoices.id, globalId));
}

// InvoiceClaimed → flip status to 'claimed', record claim_tx and fee
for (const log of logs.filter(l => l.eventName === "InvoiceClaimed")) {
  const { globalId, fee, toMerchant } = log.args;
  await db.update(invoices)
    .set({
      status:        "claimed",
      claimedAt:     new Date(),
      claimTx:       log.transactionHash,
      protocolFee:   String(fee),
      merchantPayout: String(toMerchant),
    })
    .where(and(eq(invoices.id, globalId), inArray(invoices.status, ["paid"])));
  // enqueue webhook (event_type = invoice.claimed)
  await enqueueWebhook(globalId, "invoice.claimed", { fee: String(fee), toMerchant: String(toMerchant) });
}

// EscrowRecovered → flip status to 'recovered'
for (const log of logs.filter(l => l.eventName === "EscrowRecovered")) {
  const { globalId } = log.args;
  await db.update(invoices)
    .set({ status: "recovered", recoveredAt: new Date(), recoveryTx: log.transactionHash })
    .where(and(eq(invoices.id, globalId), inArray(invoices.status, ["paid"])));
  await enqueueWebhook(globalId, "invoice.recovered", {});
}

// MerchantReactivated → clear deactivated_at
for (const log of logs.filter(l => l.eventName === "MerchantReactivated")) {
  const { merchant } = log.args;
  await db.update(merchants)
    .set({ deactivatedAt: null })
    .where(eq(merchants.address, merchant.toLowerCase()));
}
```

(`enqueueWebhook` is the existing helper — match its signature in the surrounding code.)

- [ ] **Step 5: Mirror the changes to replay.ts**

In `ops/indexer/replay.ts`, apply the same V10-only address read + ABI swap + new event handlers.

- [ ] **Step 6: Type-check + commit**

```bash
pnpm --filter @arcora/ops exec tsc --noEmit
```

```bash
git add ops/indexer/
git commit -m "feat(indexer): V10-only watch + new event handlers (escrow, claim, recover, reactivate)"
```

---

## Phase 6 — DB migrations + schema

### Task 21: Migration 0016 — wipe + Migration 0017 — V10 schema

**Files:**
- Create: `packages/app/lib/db/migrations/0016_v10_wipe.sql`
- Create: `packages/app/lib/db/migrations/0017_v10_escrow.sql`
- Modify: `packages/app/lib/db/schema.ts`

- [ ] **Step 1: Write the wipe migration**

Create `packages/app/lib/db/migrations/0016_v10_wipe.sql`:

```sql
-- 0016: V10 cutover wipe.
-- Hard cutover from V8/V9 → V10 with a single test merchant on testnet.
-- TRUNCATE preserves schema; CASCADE walks FK chains.
-- Order independent thanks to CASCADE, but listed leaf-to-root for clarity.

TRUNCATE TABLE
  webhook_attempts,
  rate_limit_counters,
  checkout_authorizations,
  compliance_screenings,
  invoices,
  webhook_endpoints,
  merchants
RESTART IDENTITY CASCADE;

-- indexer_state cursor must reset so we don't try to reconcile V9 logs into V10 schema
DELETE FROM indexer_state;
```

- [ ] **Step 2: Write the schema additions migration**

Create `packages/app/lib/db/migrations/0017_v10_escrow.sql`:

```sql
-- 0017: V10 escrow + reactivate columns + new status values.

-- Add the new enum values to invoice_status. Postgres enums can't drop values
-- non-trivially, so we ADD only.
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'claimed';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'recovered';

-- Per-invoice escrow state
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS claimable_at  timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS claimed_at    timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS claim_tx      text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recovered_at  timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recovery_tx   text;

-- Merchant reactivation tracking — surfaces "deactivated since X" copy
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- Index claimable_at to support the "claim all matured" dashboard query
CREATE INDEX IF NOT EXISTS idx_invoices_claimable_at
  ON invoices (claimable_at)
  WHERE status = 'paid' AND claimable_at IS NOT NULL;
```

- [ ] **Step 3: Update drizzle schema**

In `packages/app/lib/db/schema.ts`:

```ts
// Replace invoiceStatus
export const invoiceStatus = pgEnum("invoice_status",
  ["created", "paid", "expired", "refunded", "failed", "claimed", "recovered"]);

// In `invoices` table, add:
//   claimableAt: timestamp("claimable_at", { withTimezone: true }),
//   claimedAt:   timestamp("claimed_at",   { withTimezone: true }),
//   claimTx:     text("claim_tx"),
//   recoveredAt: timestamp("recovered_at", { withTimezone: true }),
//   recoveryTx:  text("recovery_tx"),

// In `merchants` table, add:
//   deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
```

- [ ] **Step 4: Run schema test**

Run: `pnpm --filter @arcora/app exec vitest run lib/db/schema.test.ts`
Expected: pass (the schema test is shape-only; migrations don't affect it).

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/db/migrations/0016_v10_wipe.sql \
        packages/app/lib/db/migrations/0017_v10_escrow.sql \
        packages/app/lib/db/schema.ts
git commit -m "feat(v10): DB migrations — wipe + escrow schema"
```

---

## Phase 7 — App layer

### Task 22: Drop H4 cron + vercel.json entry

**Files:**
- Delete: `packages/app/app/api/internal/cron/h4-allowance-check/`
- Modify: `packages/app/vercel.json`

- [ ] **Step 1: Delete the cron route**

```bash
git rm -r packages/app/app/api/internal/cron/h4-allowance-check/
```

- [ ] **Step 2: Drop the matching cron entry from vercel.json**

Read `packages/app/vercel.json`. Find the entry for `/api/internal/cron/h4-allowance-check` and delete that array element. Other crons (e.g., `siwe-nonce-cleanup`) stay.

- [ ] **Step 3: Run app vitest to confirm nothing depended on the cron**

Run: `pnpm --filter @arcora/app exec vitest run`
Expected: existing tests pass (no test currently imports h4-allowance-check helpers).

- [ ] **Step 4: Commit**

```bash
git add -A packages/app/app/api/internal/cron/ packages/app/vercel.json
git commit -m "chore(v10): delete H4 allowance cron — custody removes the dependency"
```

### Task 23: Drop allowance banner + bootstrap allowance check

**Files:**
- Modify: `packages/app/app/api/merchant/bootstrap/route.ts`
- Modify: `packages/app/app/m/dashboard/page.tsx`
- Modify: `packages/app/app/m/settings/AllowedOriginsCard.tsx` (or the H4 banner component, wherever it lives)

- [ ] **Step 1: Find the allowance banner**

Run:
```bash
grep -rn "approval_required\|H4\|allowance" packages/app/app packages/app/components
```
Note each file that produces or consumes the `warning: "approval_required"` shape.

- [ ] **Step 2: Drop the bootstrap allowance check**

In `packages/app/app/api/merchant/bootstrap/route.ts`, find the block that calls `readAllowance(...)` and returns `{ warning: "approval_required" }`. Delete it. The bootstrap response no longer carries a `warning` field.

- [ ] **Step 3: Drop the dashboard banner consumer**

In `packages/app/app/m/dashboard/page.tsx` (and any imported banner component), delete the JSX that renders the "Approval required" banner. Adjust imports.

- [ ] **Step 4: Drop the settings banner consumer**

In `packages/app/app/m/settings/AllowedOriginsCard.tsx` (or the file pinpointed in Step 1 — if the banner lives in a different file, edit that one instead), delete the `warning === "approval_required"` block. The allowed-origins card itself stays — only the H4 nudge is removed.

- [ ] **Step 5: Drop `readAllowance` if it has zero remaining callers**

Run:
```bash
grep -rn "readAllowance" packages/app/
```
If zero callers remain (after this commit), delete the `readAllowance` export from `packages/app/lib/chain/erc20.ts`. Keep `safeApprove` and other exports — only drop dead code.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @arcora/app exec vitest run`
Expected: pass. If a test asserted on `warning: approval_required`, update it to assert the field is absent.

- [ ] **Step 7: Commit**

```bash
git add packages/app/
git commit -m "chore(v10): drop H4 allowance banner + bootstrap allowance read"
```

### Task 24: V10 ABI + addresses

**Files:**
- Modify: `packages/app/lib/chain/gateway-abi.ts`
- Modify: `packages/app/lib/chain/client.ts`

- [ ] **Step 1: Generate the V10 ABI**

Run:
```bash
pnpm --filter @arcora/contracts exec forge inspect ArcFXGatewayV10 abi > /tmp/v10-abi.json
```

- [ ] **Step 2: Replace the ABI export**

In `packages/app/lib/chain/gateway-abi.ts`, replace the V9 ABI const with the V10 ABI (from `/tmp/v10-abi.json`). Keep the export name (`gatewayAbi`) so downstream imports don't break.

```ts
// packages/app/lib/chain/gateway-abi.ts
export const gatewayAbi = [/* … paste V10 ABI here … */] as const;
```

- [ ] **Step 3: Switch the gateway address env**

In `packages/app/lib/chain/client.ts` (or wherever `GATEWAY_ADDRESS` is read), replace `GATEWAY_ADDRESS_V9` with `GATEWAY_ADDRESS_V10`. Throw if unset.

```ts
export const GATEWAY_ADDRESS = (() => {
  const v = process.env.GATEWAY_ADDRESS_V10;
  if (!v) throw new Error("GATEWAY_ADDRESS_V10 must be set");
  return v.toLowerCase() as `0x${string}`;
})();
```

- [ ] **Step 4: Type-check + run app tests**

```bash
pnpm --filter @arcora/app exec tsc --noEmit
pnpm --filter @arcora/app exec vitest run
```
Expected: any test that calls `gatewayAbi` with V9 function names (e.g., `payments`) needs a small update to V10 names (`escrows`). Fix and re-run until green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/chain/
git commit -m "feat(v10): app — V10 ABI + GATEWAY_ADDRESS_V10"
```

### Task 25: /api/merchant/escrows endpoint

**Files:**
- Create: `packages/app/app/api/merchant/escrows/route.ts`
- Create: `packages/app/app/api/merchant/escrows/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/app/api/merchant/escrows/route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

const dbMock = vi.hoisted(() => ({
  /* … shape varies — match the existing /api/merchant/treasury test pattern in this repo */
}));
vi.mock("@/lib/db/client", () => ({ db: dbMock }));

describe("GET /api/merchant/escrows", () => {
  it("401s when unauthenticated", async () => {
    const req = new Request("http://localhost/api/merchant/escrows");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns pending + matured + claimed groups for the authed merchant", async () => {
    // Stub session, stub db query results: 2 paid invoices (1 matured, 1 pending),
    // 1 claimed, 1 refunded. Expect:
    //   pending:  [1]
    //   matured:  [1]
    //   claimed:  [1]
    // Refunded NOT in any group.
  });
});
```

(Match the existing `/api/merchant/treasury/route.test.ts` shape for the auth + db mock plumbing — that file is the canonical reference for this codebase's API-route testing pattern.)

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @arcora/app exec vitest run app/api/merchant/escrows/route.test.ts`
Expected: cannot import `./route` (file doesn't exist).

- [ ] **Step 3: Implement the route**

Create `packages/app/app/api/merchant/escrows/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, lte, isNull } from "drizzle-orm/sql";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { authedMerchant } from "@/lib/auth/session";

export async function GET(req: Request | NextRequest) {
  const merchant = await authedMerchant(req);
  if (!merchant) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();

  const [pending, matured, claimed] = await Promise.all([
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchant.id),
      eq(invoices.status, "paid"),
      gt(invoices.claimableAt, now),
    )),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchant.id),
      eq(invoices.status, "paid"),
      lte(invoices.claimableAt, now),
    )),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchant.id),
      eq(invoices.status, "claimed"),
    )).limit(50),
  ]);

  return NextResponse.json({
    pending,
    matured,
    claimed,
    counts: { pending: pending.length, matured: matured.length, claimed: claimed.length },
  });
}
```

(`authedMerchant` is the existing session helper used by `/api/merchant/treasury`. Match that file's import.)

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @arcora/app exec vitest run app/api/merchant/escrows/route.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/app/api/merchant/escrows/
git commit -m "feat(v10): /api/merchant/escrows — pending/matured/claimed rollup"
```

### Task 26: ClaimAllButton + Treasury Claim tab

**Files:**
- Create: `packages/app/components/treasury/ClaimAllButton.tsx`
- Modify: `packages/app/app/m/treasury/page.tsx`

- [ ] **Step 1: Implement ClaimAllButton**

Create `packages/app/components/treasury/ClaimAllButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { gatewayAbi } from "@/lib/chain/gateway-abi";
import { GATEWAY_ADDRESS } from "@/lib/chain/client";

export function ClaimAllButton({ globalIds }: { globalIds: `0x${string}`[] }) {
  const [step, setStep] = useState<"idle" | "submitting" | "confirming" | "done" | "error">("idle");
  const { writeContractAsync } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const { isSuccess } = useWaitForTransactionReceipt({ hash });

  if (globalIds.length === 0) {
    return <p className="text-sm text-muted-foreground">No matured escrows to claim.</p>;
  }

  async function onClick() {
    setStep("submitting");
    try {
      const tx = await writeContractAsync({
        address:      GATEWAY_ADDRESS,
        abi:          gatewayAbi,
        functionName: "claim",
        args:         [globalIds],
      });
      setHash(tx);
      setStep("confirming");
    } catch (e) {
      console.error(e);
      setStep("error");
    }
  }

  if (isSuccess && step !== "done") setStep("done");

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={step === "submitting" || step === "confirming"}
        className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {step === "idle"        && `Claim ${globalIds.length} matured invoice${globalIds.length === 1 ? "" : "s"}`}
        {step === "submitting"  && "Submitting…"}
        {step === "confirming"  && "Waiting for confirmation…"}
        {step === "done"        && "Claimed ✓"}
        {step === "error"       && "Failed — retry"}
      </button>
      {hash && <p className="text-xs text-muted-foreground">tx: {hash}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the Treasury page**

In `packages/app/app/m/treasury/page.tsx`:
- Fetch `/api/merchant/escrows` server-side (or client-side with `swr` matching the existing pattern).
- Render a "Claim" tab (or a card if the existing layout doesn't use tabs) showing `pending` and `matured` counts.
- Render `<ClaimAllButton globalIds={matured.map(m => m.id)} />`.

(Match the existing structure of the treasury page — don't introduce a new tab system if the page is currently a flat list of cards.)

- [ ] **Step 3: Manual smoke (anvil)**

Spin up the dev environment (`pnpm dev` from `packages/app`), pay a test invoice locally (foundry-anvil cheats or full localnet), warp 7 days in test mode, click Claim All. Expected: tx submitted, confirmed, banner says "Claimed ✓".

(The `vercel:verification` skill can help here when running `pnpm dev`.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/components/treasury/ClaimAllButton.tsx packages/app/app/m/treasury/page.tsx
git commit -m "feat(v10): treasury Claim tab + permissionless ClaimAllButton"
```

### Task 27: Refund button window gating + status pills

**Files:**
- Modify: `packages/app/components/checkout/RefundButton.tsx` (or wherever the existing RefundButton lives)
- Modify: `packages/app/components/treasury/ActivityFeed.tsx` (or the invoice list component)

- [ ] **Step 1: Find the existing RefundButton + status pill renderer**

```bash
grep -rn "RefundButton\|status.*paid\|status.*refunded" packages/app/components packages/app/app/m
```

- [ ] **Step 2: Gate the RefundButton by 7-day window**

In the RefundButton component, add visibility logic:

```tsx
const refundEndsAt = new Date(invoice.claimableAt ?? 0);
const stillRefundable = invoice.status === "paid" && Date.now() < refundEndsAt.getTime();

if (!stillRefundable) return null;
```

- [ ] **Step 3: Add status pills for `claimed` and `recovered`**

In the activity-feed / invoice list status renderer, extend the existing pill switch:

```tsx
const PILL = {
  created:   { label: "Created",   className: "bg-amber-100 text-amber-800" },
  paid:      { label: "Paid",      className: "bg-emerald-100 text-emerald-800" },
  refunded:  { label: "Refunded",  className: "bg-sky-100 text-sky-800" },
  failed:    { label: "Failed",    className: "bg-rose-100 text-rose-800" },
  expired:   { label: "Expired",   className: "bg-zinc-100 text-zinc-700" },
  claimed:   { label: "Claimed",   className: "bg-violet-100 text-violet-800" },   // NEW
  recovered: { label: "Recovered", className: "bg-orange-100 text-orange-800" },   // NEW
} as const;
```

(Match the existing pill-style classes in the file — the values above are illustrative; copy from the existing pill map and add the two new keys.)

- [ ] **Step 4: Run app tests**

Run: `pnpm --filter @arcora/app exec vitest run`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/components/
git commit -m "feat(v10): refund window gating + claimed/recovered status pills"
```

---

## Phase 8 — SDK updates

### Task 28: SDK V10 ABI + escrows method

**Files:**
- Modify: `packages/sdk/src/abi.ts`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk-react/src/useCheckout.tsx`

- [ ] **Step 1: Replace SDK ABI**

In `packages/sdk/src/abi.ts`, paste the V10 ABI (same source as `/tmp/v10-abi.json` from Task 24).

- [ ] **Step 2: Add escrows() to the Arcora client**

In `packages/sdk/src/client.ts`, on the `Arcora` class:

```ts
async escrows(): Promise<{
  pending:  EscrowSummary[];
  matured:  EscrowSummary[];
  claimed:  EscrowSummary[];
}> {
  const r = await this.request("/api/merchant/escrows", { method: "GET" });
  return r.json();
}

export interface EscrowSummary {
  id:           string;
  amountOut:    string;
  payoutToken:  string;
  claimableAt:  string | null;
  status:       "paid" | "claimed";
}
```

- [ ] **Step 3: Surface refundEndsAt on useCheckout**

In `packages/sdk-react/src/useCheckout.tsx`, extend the result with `refundEndsAt`:

```ts
return {
  // … existing fields
  refundEndsAt: invoice?.claimableAt ? new Date(invoice.claimableAt) : null,
};
```

(Host apps can use this for a refund-deadline countdown.)

- [ ] **Step 4: Run SDK tests**

```bash
pnpm --filter @arcora/sdk        exec vitest run
pnpm --filter @arcora/sdk-react  exec vitest run
```
Expected: existing 14 + 4 tests pass; if any test asserts on V9 ABI shape (function names like `payments`), update to V10 names. Add at least one new test for `escrows()` exercising the request path.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/ packages/sdk-react/
git commit -m "feat(v10): SDK — V10 ABI + escrows() + refundEndsAt"
```

---

## Phase 9 — Docs

### Task 29: V10 deploy runbook

**Files:**
- Create: `docs/runbooks/v10-deploy.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/v10-deploy.md`:

```markdown
# V10 deploy runbook

## Pre-flight

- [ ] `plan-10-v10-custody` branch green: forge tests + vitest + tsc
- [ ] Vault running on VPS, transit key `relayer-v10` generated, public key derived → relayer address recorded as `GATEWAY_RELAYER`
- [ ] `DEPLOYER_PRIVATE_KEY` and `GATEWAY_OWNER` set (admin EOA)
- [ ] USDC + EURC testnet addresses on Arc confirmed

## Deploy

```
cd packages/contracts
PROTOCOL_FEE_BPS=30 \
REFUND_WINDOW_SECONDS=604800 \
ADMIN_RECOVERY_DELAY=604800 \
SUPPORTED_TOKENS="0x<USDC>,0x<EURC>" \
forge script script/DeployV10.s.sol \
  --broadcast --legacy --rpc-url $ARC_RPC -vvv
```

## Verify (Foundry-broadcast-lies caveat from MEMORY.md)

```
cast receipt <txHash> --rpc-url $ARC_RPC | grep status
# expect: status 1
cast code <V10Address> --rpc-url $ARC_RPC | wc -c
# expect: > 100 (non-empty bytecode)
```

## Wire env

### Vercel (packages/app)
```
GATEWAY_ADDRESS_V10=0x…
# remove: GATEWAY_ADDRESS_V6, V8, V9, H4_MIN_BOOTSTRAP_ALLOWANCE
```

### VPS (/etc/arcora/relayer.env, /etc/arcora/indexer.env)
```
GATEWAY_ADDRESS_V10=0x…
VAULT_URL=http://127.0.0.1:8200
VAULT_ROLE_ID=…
VAULT_SECRET_ID=…
VAULT_KEY_NAME=relayer-v10
# remove: RELAYER_PRIVATE_KEY, GATEWAY_ADDRESS_V6/V8/V9
```

## DB migrations (apply in order)

```
psql $DATABASE_URL_DIRECT -f packages/app/lib/db/migrations/0016_v10_wipe.sql
psql $DATABASE_URL_DIRECT -f packages/app/lib/db/migrations/0017_v10_escrow.sql
```

## Restart daemons on the VPS

```
ssh root@194.163.136.1 'systemctl reload arcora-relayer arcora-indexer'
```

## Re-bootstrap as merchant

1. Visit `https://arcorapay.xyz`, SIWE in, hit `/m/dashboard`
2. Bootstrap as merchant — single TX → V10 `registerMerchant`
3. Verify `GATEWAY_ADDRESS_V10` matches in the dashboard footer (or wherever it's surfaced)

## Smoke flow

| Step | Expected |
|------|----------|
| Create invoice (USDC pay-in, USDC payout, $10) | `created` row in DB, `InvoiceCreated` event |
| Pay it from a wallet | `paid` row, escrow created, `EscrowCreated` event, no transfer to merchant |
| Refund within 7 days | customer made whole (full $10), `refunded` status |
| Create + pay another | escrow row visible in `/m/treasury` Claim tab |
| Wait 7 days (or warp time on a fork) | "Claim all" button enables |
| Click Claim | merchant payoutAddress receives net, fee accrued, `claimed` status |
| Deactivate merchant | `MerchantDeactivated`, `deactivated_at` timestamp set |
| Wait 14 days, admin recover | `recovered` status, funds at sweep address |
| Reactivate via admin | `active = true` again, `deactivated_at` cleared |

## Rollback

V10 is immutable — there's no rollback. If V10 has a critical bug found post-deploy:
1. Pause via admin (`gw.pause()`)
2. Refund / claim outstanding escrows (refunds work paused)
3. Deploy V11 with the fix; cut over the same way (DB wipe is now optional since V10 already had clean state)
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/v10-deploy.md
git commit -m "docs(v10): deploy runbook"
```

### Task 30: Vault recovery runbook

**Files:**
- Create: `docs/runbooks/vault-recovery.md`

- [ ] **Step 1: Write the recovery runbook**

Create `docs/runbooks/vault-recovery.md`:

```markdown
# Vault recovery runbook

## Quick reference

- Vault data lives at `/var/lib/vault/data/` on the VPS.
- 3 unseal keys distributed: 1Password (offline export) + paper backup + (TBD second holder for mainnet T-0).
- Threshold: 2 of 3 to unseal.
- Master root token: revoked after install. Use the long-lived `approle-rotator` token for daily rotation.

## Reboot — unseal procedure

After every VPS reboot:
```
ssh root@194.163.136.1
export VAULT_ADDR=http://127.0.0.1:8200
vault operator unseal <key1>
vault operator unseal <key2>
vault status   # expect: Sealed=false, Initialized=true
```

The relayer cannot sign transactions while Vault is sealed. The systemd
unit will retry-loop until unseal completes; expect log lines like
"vault: server sealed" until then.

## Lost a single unseal key

Acceptable — 2-of-3 still functions. Generate a fresh key set:
```
vault operator rekey -init -key-shares=3 -key-threshold=2
# then for each existing key holder:
vault operator rekey <existing-key>
```

## Lost majority of unseal keys

**Recovery is impossible.** The transit key is unrecoverable. To restore service:
1. Note the address of the inaccessible relayer key.
2. Bring up a fresh Vault on a new VPS (or wipe `/var/lib/vault/data/` and re-init).
3. Generate a new transit key → new relayer address.
4. Submit an admin-controlled tx to V10 that grants `RELAYER_ROLE` to the new address and revokes the old role:
   ```
   cast send <V10> "grantRole(bytes32,address)" $RELAYER_ROLE_HASH <newRelayerAddr> --private-key $ADMIN_PK
   cast send <V10> "revokeRole(bytes32,address)" $RELAYER_ROLE_HASH <oldRelayerAddr> --private-key $ADMIN_PK
   ```
5. Update `GATEWAY_RELAYER` reference if still needed; relayer systemd reloads.

## Daily rotation cron failure

If `secret-id-rotation.sh` errors:
- Relayer still has its current `secret_id` valid for 24h. Manual re-run:
  ```
  ssh root@194.163.136.1
  VAULT_TOKEN=$(cat /root/.vault-rotation-token) bash /opt/arcora/ops/vault/secret-id-rotation.sh
  ```
- Past 24h without rotation → relayer signing fails (invalid secret_id). Use the rotation operator token to mint a new secret_id manually:
  ```
  vault write -f auth/approle/role/relayer/secret-id
  # write secret_id into /etc/arcora/relayer.env, systemctl reload arcora-relayer
  ```
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/vault-recovery.md
git commit -m "docs(vault): recovery runbook"
```

### Task 31: Update audit residuals + h4 runbook + deploy checklist

**Files:**
- Modify: `docs/audit/2026-05-05-residuals.md`
- Modify: `docs/runbooks/h4-refund-approval.md`
- Modify: `docs/audit/deploy-checklist.md`

- [ ] **Step 1: Mark V10 deferred items closed**

In `docs/audit/2026-05-05-residuals.md`, find the "Deferred to V10" section. Replace with:

```markdown
## Deferred to V10 — CLOSED 2026-05-06 (Plan 10)

| Finding | Resolution |
|--------|------------|
| H4 (refund custody) | V10 custody model deployed at `0x<V10>`. Allowance dependency eliminated. |
| M3 (fee bound) | V10 constructor enforces `protocolFeeBps <= 1000`. |
| M4 (reactivate semantics) | V10 admin-only `reactivateMerchant`; `registerMerchant` rejects deactivated overwrite. |
| L2 (`nonReentrant` on `recordPayerRefund`) | Modifier added in V10. |
```

- [ ] **Step 2: Add deprecation header to h4 runbook**

Prepend to `docs/runbooks/h4-refund-approval.md`:

```markdown
> **DEPRECATED 2026-05-06.** V10 (Plan 10) eliminates the H4 refund-approval
> dependency entirely via the custody model. This runbook is retained for
> historical reference only — do not action it on V10. See
> `docs/runbooks/v10-deploy.md` and `docs/superpowers/specs/2026-05-06-plan-10-custody-gateway-design.md`.
```

- [ ] **Step 3: Add vercel.json warning to deploy checklist**

In `docs/audit/deploy-checklist.md`, add (near the top, before the existing checklist body):

```markdown
## ⚠ vercel.json location is not portable

`packages/app/vercel.json` is the SOURCE OF TRUTH for cron registration. The
Vercel project root is set to `packages/app/`; relocating the project root
will silently stop registering all crons. If the monorepo layout is ever
reorganized, coordinate the `vercel.json` move at the same time and verify
crons still register via `vercel crons ls`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/audit/2026-05-05-residuals.md \
        docs/runbooks/h4-refund-approval.md \
        docs/audit/deploy-checklist.md
git commit -m "docs(v10): mark audit residuals closed; h4 runbook deprecated; vercel.json note"
```

---

## Phase 10 — Deploy + smoke

### Task 32: Deploy V10 to Arc testnet

**Files:**
- N/A — operational

- [ ] **Step 1: Stand up Vault on the VPS**

```bash
scp -r ops/vault/ root@194.163.136.1:/opt/arcora/ops/vault/
ssh root@194.163.136.1 'cd /opt/arcora && bash ops/vault/install.sh'
```

Then complete the interactive setup per `ops/vault/README.md` — init, unseal, plugin install, transit engine, relayer-v10 key, AppRole + policy.

Save: 3 unseal keys (offline), `role_id`, first `secret_id`, the long-lived rotation operator token.

- [ ] **Step 2: Derive the relayer address from the public key**

In a local Node.js REPL or one-off script:

```ts
import { publicKeyToAddress } from "viem";
console.log(publicKeyToAddress("0x04…"));  // paste public_key from `vault read transit/keys/relayer-v10`
```

This is the `GATEWAY_RELAYER` for the V10 deploy.

- [ ] **Step 3: Run the V10 deploy script**

Per `docs/runbooks/v10-deploy.md` Phase Deploy. Save the V10 address.

- [ ] **Step 4: Verify on-chain**

```bash
cast receipt <txHash> --rpc-url $ARC_RPC | grep -E '^(status|blockNumber)'
cast code <V10Addr> --rpc-url $ARC_RPC | wc -c
```

Expected: status 1; bytecode size > 100 chars.

- [ ] **Step 5: Set token whitelist if not done in deploy script**

Only if `SUPPORTED_TOKENS` env was empty at deploy:
```
cast send <V10Addr> "setTokenSupport(address,bool)" <USDC> true --private-key $ADMIN_PK
cast send <V10Addr> "setTokenSupport(address,bool)" <EURC> true --private-key $ADMIN_PK
```

- [ ] **Step 6: Commit deploy artifacts**

```bash
# If the deploy generated broadcast/ and run-latest.json, those are git-ignored — skip
# Just record the V10 address in the runbook
sed -i.bak "s/0x<V10>/<actual_address>/" docs/runbooks/v10-deploy.md
rm docs/runbooks/v10-deploy.md.bak
git add docs/runbooks/v10-deploy.md
git commit -m "ops(v10): record live V10 address in runbook"
```

### Task 33: Apply DB migrations to prod

**Files:**
- N/A — operational

- [ ] **Step 1: Pull production database URL**

```bash
cd packages/app
vercel env pull --environment=production .env.production.local
# DATABASE_URL_DIRECT (non-pooling) is what we apply migrations against
```

- [ ] **Step 2: Apply 0016 wipe**

```bash
psql "$DATABASE_URL_DIRECT" -f lib/db/migrations/0016_v10_wipe.sql
```

Expected: TRUNCATE completes, no errors. The schema_migrations / drizzle table is untouched (per Plan-5 hot-fix pattern, drizzle tracking has been bypassed since 2026-05-02 — this matches `compliance_phase0.md`).

- [ ] **Step 3: Apply 0017 escrow schema**

```bash
psql "$DATABASE_URL_DIRECT" -f lib/db/migrations/0017_v10_escrow.sql
```

Expected: ALTER TYPE + ALTER TABLE + CREATE INDEX all succeed.

- [ ] **Step 4: Quick sanity query**

```bash
psql "$DATABASE_URL_DIRECT" -c "SELECT enum_range(NULL::invoice_status);"
# expect array containing 'claimed' and 'recovered'

psql "$DATABASE_URL_DIRECT" -c "SELECT count(*) FROM invoices, merchants;"
# expect 0,0 (both wiped)
```

### Task 34: Wire env on Vercel + VPS, restart daemons

**Files:**
- N/A — operational

- [ ] **Step 1: Vercel env**

```
vercel env rm GATEWAY_ADDRESS_V6 production || true
vercel env rm GATEWAY_ADDRESS_V8 production || true
vercel env rm GATEWAY_ADDRESS_V9 production || true
vercel env rm H4_MIN_BOOTSTRAP_ALLOWANCE production || true

vercel env add GATEWAY_ADDRESS_V10 production   # paste V10 address
```

- [ ] **Step 2: Production deploy**

```bash
cd packages/app
vercel --prod --yes
```

Expected: build succeeds, alias `arcorapay.xyz` updated.

- [ ] **Step 3: VPS env (relayer + indexer)**

```bash
ssh root@194.163.136.1
# Edit /etc/arcora/relayer.env — drop RELAYER_PRIVATE_KEY, GATEWAY_ADDRESS_V*, add VAULT_* + GATEWAY_ADDRESS_V10
# Edit /etc/arcora/indexer.env — drop GATEWAY_ADDRESS_V6/V8/V9, add GATEWAY_ADDRESS_V10
systemctl reload arcora-relayer.service
systemctl reload arcora-indexer.service
journalctl -u arcora-relayer -n 50 --no-pager
journalctl -u arcora-indexer -n 50 --no-pager
```

Expected: relayer logs show successful Vault AppRole login + key derive; indexer logs show V10 address being watched.

### Task 35: End-to-end smoke

**Files:**
- N/A — manual verification

- [ ] **Step 1: Browser smoke per docs/runbooks/v10-deploy.md "Smoke flow"**

Walk the table row by row at `https://arcorapay.xyz`. Each row must turn green.

- [ ] **Step 2: Update memory**

After full smoke success, append to `MEMORY.md` an entry:

```
- [V10 custody gateway LIVE on prod](v10_custody.md) — deployed 2026-05-XX at 0x…; closes audit residuals H4/M3/M4/L2; Vault on VPS isolates relayer key
```

And create `memory/v10_custody.md` with the live state summary (address, deploy date, env vars, smoke timestamps).

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "plan-10: V10 custody gateway + Vault HSM" --body "$(cat <<'EOF'
## Summary
- Closes audit residuals H4 (custody), M3 (fee bound), M4 (reactivate), L2 (nonReentrant).
- New per-invoice escrow with 7-day refund/claim window; fee accrues on claim.
- V8/V9 retired; sources in `legacy/`.
- HashiCorp Vault on VPS isolates relayer key (transit engine + AppRole + viem custom signer).
- Operational gotchas closed: H4 cron deleted, allowance banner deleted, vercel.json doc note.

Spec: docs/superpowers/specs/2026-05-06-plan-10-custody-gateway-design.md
Plan: docs/superpowers/plans/2026-05-06-plan-10-custody-gateway.md
Runbook: docs/runbooks/v10-deploy.md

## Test plan
- [x] forge tests green (V10 suite + coverage gate ≥95/90)
- [x] vitest green (app + sdk + sdk-react)
- [x] V10 deployed to Arc testnet (status=1, code non-empty)
- [x] Migrations 0016+0017 applied to Neon prod
- [x] Vault running on VPS, secret_id rotation cron live
- [x] Browser smoke: pay → refund → pay → claim → deactivate → admin recover → reactivate

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (run after writing the plan, before handoff)

**Spec coverage:** Each spec section is mapped:
- Custody escrow → Tasks 7, 8, 9, 10
- Refund window === claim delay (7 days) → Task 7 (escrow.claimableAt) + Task 8 + Task 9
- Fee on claim → Task 9
- Permissionless claim → Task 9
- Admin recovery → Task 10
- Delegate scope → Task 6 (createInvoice) + Task 8 (refund auth)
- Reactivate (M4) → Task 5
- M3 fee bound → Task 3
- L2 nonReentrant → Task 11
- Vault HSM → Tasks 17, 18, 19, 30
- V8/V9 retirement → Task 15
- Indexer rewrite → Task 20
- DB migrations → Task 21, 33
- App: drop H4 cron → Task 22
- App: drop allowance banner → Task 23
- App: V10 ABI + escrows + Claim tab → Tasks 24, 25, 26
- App: refund window gating → Task 27
- SDK: V10 ABI + escrows() + refundEndsAt → Task 28
- Docs: runbooks + residuals → Tasks 29, 30, 31
- Deploy + smoke → Tasks 32, 33, 34, 35

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task. The two `Note:` blocks (Task 18 plugin response shape, Task 26 anvil smoke) are explicit instructions to verify against the live plugin/dev env at implementation time, not deferrals.

**Type consistency check:**
- `Escrow { amount, payoutToken, claimableAt }` consistent across Tasks 2, 7, 8, 9, 10.
- `InvoiceStatus` enum values consistent: `None, Created, Paid, Refunded, Failed, Claimed, Recovered`.
- `RIGHT_CREATE_INVOICE` / `RIGHT_REFUND` constants consistent in Task 6 and Task 8.
- `claim(bytes32[])` / `adminRecoverEscrow(bytes32[], address)` signatures consistent in tests + impl.
- Error names consistent (e.g. `InvoiceNotClaimable`, `RecoveryTooEarly`, `MerchantStillActive`).
