// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase }     from "./GatewayTestBase.t.sol";
import { FeeOnTransferERC20 }  from "../helpers/FeeOnTransferERC20.sol";

/// Audit M3 (2026-07-04): ArcFXGateway records `escrow.amount = grossPayout`
/// but never measures the balance actually received by `safeTransferFrom`. For
/// an exact-transfer token the two are equal (positive control below). For a
/// fee-on-transfer / rebasing token the contract receives LESS than it records,
/// so the recorded escrow over-states the real balance and downstream
/// claim/refund can strand funds. These tests are the regression guard behind
/// the exact-transfer-only token allowlist policy (see docs/audit/threat-model.md
/// and docs/audit/deploy-checklist.md): only exact-transfer, non-rebasing,
/// hook-free tokens (USDC/EURC) may ever be passed to setTokenSupport.
contract FeeOnTransferPolicyTest is GatewayTestBase {
    FeeOnTransferERC20 feeTok;
    address feeMerchant = makeAddr("feeMerchant");
    address feePayee    = makeAddr("feePayee");

    uint16 constant TOK_FEE_BPS = 100; // 1%

    function setUp() public override {
        super.setUp();
        feeTok = new FeeOnTransferERC20("Fee Coin", "FEE", 6, TOK_FEE_BPS);
        vm.prank(admin);
        gw.setTokenSupport(address(feeTok), true);
        // A merchant whose payout token is the fee-on-transfer token.
        vm.prank(feeMerchant);
        gw.registerMerchant(feePayee, address(feeTok));
    }

    function _settleFor(address merchant_, uint256 gross, uint256 salt) internal returns (bytes32 globalId) {
        bytes32 invoiceId = keccak256(abi.encode("fee-inv", merchant_, gross, salt));
        vm.prank(merchant_);
        globalId = gw.createInvoice(invoiceId, address(usdc), gross, uint64(block.timestamp + 1 hours));
        feeTok.mint(relayer, gross);
        vm.prank(relayer);
        feeTok.approve(address(gw), gross);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), gross + 10e6, gross, bytes32(0));
    }

    /// Positive control: an exact-transfer token (USDC via the base merchant)
    /// records exactly what it receives — the invariant the gateway relies on.
    function test_ExactTransferToken_RecordedEqualsReceived() public {
        // base merchant's payout token is EURC (exact-transfer)
        bytes32 invoiceId = keccak256("exact-inv");
        vm.prank(merchant);
        bytes32 globalId = gw.createInvoice(invoiceId, address(usdc), 100e6, uint64(block.timestamp + 1 hours));
        eurc.mint(relayer, 100e6);
        vm.prank(relayer);
        eurc.approve(address(gw), 100e6);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));

        (uint256 recorded,,) = gw.escrows(globalId);
        assertEq(recorded, 100e6, "recorded escrow == grossPayout");
        assertEq(eurc.balanceOf(address(gw)), recorded, "exact-transfer: balance == recorded");
    }

    /// Hazard: a fee-on-transfer token makes the recorded escrow exceed the real
    /// balance. This is why such tokens must never be whitelisted.
    function test_FeeOnTransferToken_RecordedExceedsReceived() public {
        uint256 gross = 100e6;
        bytes32 globalId = _settleFor(feeMerchant, gross, 0);

        (uint256 recorded,,) = gw.escrows(globalId);
        uint256 realBal = feeTok.balanceOf(address(gw));
        uint256 withheld = (gross * TOK_FEE_BPS) / 10_000;

        assertEq(recorded, gross, "escrow records the full grossPayout");
        assertEq(realBal, gross - withheld, "contract only received gross minus the transfer fee");
        assertLt(realBal, recorded, "fee-on-transfer: recorded escrow over-states the real balance");
    }

    /// Downstream consequence: with only one such escrow, the recorded amount
    /// cannot be fully paid out — a second settlement's balance is drawn down by
    /// the first, so the aggregate recorded escrow exceeds the aggregate balance
    /// (the solvency invariant the standard-MockERC20 fuzz never exercises).
    function test_FeeOnTransferToken_AggregateInsolvency() public {
        uint256 gross = 100e6;
        bytes32 g1 = _settleFor(feeMerchant, gross, 1);
        bytes32 g2 = _settleFor(feeMerchant, gross, 2);

        (uint256 r1,,) = gw.escrows(g1);
        (uint256 r2,,) = gw.escrows(g2);
        uint256 recordedTotal = r1 + r2;
        uint256 realBal = feeTok.balanceOf(address(gw));

        assertEq(recordedTotal, 2 * gross, "two escrows record 2x gross");
        assertLt(realBal, recordedTotal, "contract balance cannot cover both recorded escrows");
    }
}
