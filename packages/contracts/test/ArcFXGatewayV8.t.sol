// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test }              from "forge-std/Test.sol";
import { Vm }                from "forge-std/Vm.sol";
import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAccessControl }    from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Pausable }          from "@openzeppelin/contracts/utils/Pausable.sol";

import { ArcFXGatewayV8 }    from "../src/ArcFXGatewayV8.sol";
import { MockERC20 }         from "./helpers/MockERC20.sol";

/// @dev Phase B coverage for the v0.8 (pool-free, relayer-driven) gateway.
/// Settlement no longer flows from the customer's tx; the relayer pulls payout
/// tokens from its own wallet and calls settleInvoice. The tests reflect that
/// new shape — most of the v0.7 swap-path expectations are gone.
contract ArcFXGatewayV8Test is Test {
    ArcFXGatewayV8 gw;
    MockERC20      usdc;
    MockERC20      eurc;

    address admin    = makeAddr("admin");
    address relayer  = makeAddr("relayer");
    address merchant = makeAddr("merchant");
    address payee    = makeAddr("payee"); // merchant's payout address (separate)
    address customer = makeAddr("customer");

    uint256 constant FEE_BPS = 30; // 0.30%

    function setUp() public {
        vm.warp(1_700_000_000);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);

        gw = new ArcFXGatewayV8(FEE_BPS, admin, relayer);

        vm.startPrank(admin);
        gw.setTokenSupport(address(usdc), true);
        gw.setTokenSupport(address(eurc), true);
        vm.stopPrank();

        vm.prank(merchant);
        gw.registerMerchant(payee, address(eurc));
    }

    // ── helpers ────────────────────────────────────────────────────────

    function _createInvoice(bytes32 invoiceId, uint256 amountOut, uint64 ttl)
        internal
        returns (bytes32 globalId)
    {
        vm.prank(merchant);
        return gw.createInvoice(invoiceId, address(usdc), amountOut, uint64(block.timestamp + ttl));
    }

    function _fundRelayer(MockERC20 token, uint256 amount) internal {
        token.mint(relayer, amount);
        vm.prank(relayer);
        token.approve(address(gw), amount);
    }

    // ── token support ──────────────────────────────────────────────────

    function test_SetTokenSupport_OnlyAdmin() public {
        MockERC20 newToken = new MockERC20("Test", "TST", 6);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        gw.setTokenSupport(address(newToken), true);

        vm.prank(admin);
        gw.setTokenSupport(address(newToken), true);
        assertTrue(gw.supportedTokens(address(newToken)));
    }

    // ── settleInvoice happy path ───────────────────────────────────────

    function test_SettleInvoice_HappyPath() public {
        // Exact-match case: gross equals amountOut, so the excess term is 0
        // and the fee bucket holds only the fee.
        uint256 amountOut = 100e6;
        bytes32 globalId  = _createInvoice(bytes32("inv-1"), amountOut, 1 hours);
        uint256 gross     = amountOut;

        _fundRelayer(eurc, gross);

        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, gross, bytes32("swap-tx-1"));

        uint256 expectedFee    = (amountOut * FEE_BPS) / 10_000;
        uint256 expectedPayout = amountOut - expectedFee;
        assertEq(eurc.balanceOf(payee), expectedPayout, "merchant payout");
        assertEq(gw.protocolFeesAccrued(address(eurc)), expectedFee, "fee accrued");
        assertEq(eurc.balanceOf(address(gw)), expectedFee, "gateway holds fee");

        (, , , , , ArcFXGatewayV8.InvoiceStatus status, address paidBy) = gw.invoices(globalId);
        assertEq(uint8(status), uint8(ArcFXGatewayV8.InvoiceStatus.Paid));
        assertEq(paidBy, customer);
    }

    function test_SettleInvoice_PayoutExceedsAmountOut_ExcessToProtocol() public {
        // App Kit can return more than the invoice's amountOut on a favourable
        // rate. v0.8.1 economics: merchant always receives exactly amountOut
        // net of the fee (predictable, Stripe-shaped); the excess accrues to
        // the protocol fee bucket — that surplus is what offsets the bad-rate
        // cases that revert with PayoutShortfall.
        uint256 amountOut = 100e6;
        bytes32 globalId  = _createInvoice(bytes32("inv-2"), amountOut, 1 hours);
        uint256 gross     = 105e6;

        _fundRelayer(eurc, gross);

        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, gross, bytes32("swap-tx-2"));

        uint256 expectedFee    = (amountOut * FEE_BPS) / 10_000;
        uint256 expectedPayout = amountOut - expectedFee;
        uint256 excess         = gross - amountOut;
        assertEq(eurc.balanceOf(payee), expectedPayout, "merchant receives exactly amountOut - fee");
        assertEq(gw.protocolFeesAccrued(address(eurc)), expectedFee + excess, "fee bucket holds fee + excess");
        assertEq(eurc.balanceOf(address(gw)), expectedFee + excess, "gateway holds fee + excess balance");
    }

    function test_SettleInvoice_EmitsEvents() public {
        uint256 amountOut = 100e6;
        bytes32 globalId  = _createInvoice(bytes32("inv-3"), amountOut, 1 hours);
        uint256 gross     = amountOut;
        _fundRelayer(eurc, gross);

        uint256 expectedFee    = (amountOut * FEE_BPS) / 10_000;
        uint256 expectedPayout = amountOut - expectedFee;

        vm.recordLogs();
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, gross, bytes32("hash-3"));
        Vm.Log[] memory entries = vm.getRecordedLogs();

        bool sawPaid;
        bool sawCtx;
        for (uint i; i < entries.length; i++) {
            if (entries[i].topics[0] == keccak256("InvoicePaid(bytes32,address,uint256,uint256,uint256,uint256)")) {
                sawPaid = true;
                (uint256 amountIn, uint256 grossOut, uint256 toMerchant, uint256 fee) =
                    abi.decode(entries[i].data, (uint256, uint256, uint256, uint256));
                assertEq(amountIn, 110e6);
                assertEq(grossOut, gross);
                assertEq(toMerchant, expectedPayout);
                assertEq(fee, expectedFee);
            } else if (entries[i].topics[0] == keccak256("SettlementContext(bytes32,address,bytes32)")) {
                sawCtx = true;
                bytes32 swapHash = abi.decode(entries[i].data, (bytes32));
                assertEq(swapHash, bytes32("hash-3"));
            }
        }
        assertTrue(sawPaid, "InvoicePaid emitted");
        assertTrue(sawCtx,  "SettlementContext emitted");
    }

    // ── settleInvoice reverts ──────────────────────────────────────────

    function test_SettleInvoice_RevertsForNonRelayer() public {
        bytes32 globalId = _createInvoice(bytes32("inv-r1"), 100e6, 1 hours);
        _fundRelayer(eurc, 100e6); // funded but msg.sender != relayer

        vm.expectRevert(); // AccessControlUnauthorizedAccount
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));
    }

    function test_SettleInvoice_RevertsOnNotFound() public {
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(
            ArcFXGatewayV8.InvoiceNotFound.selector, bytes32("nope")
        ));
        gw.settleInvoice(bytes32("nope"), customer, address(usdc), 110e6, 100e6, bytes32(0));
    }

    function test_SettleInvoice_RevertsOnAlreadyPaid() public {
        bytes32 globalId = _createInvoice(bytes32("inv-r2"), 100e6, 1 hours);
        _fundRelayer(eurc, 200e6);

        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(
            ArcFXGatewayV8.InvoiceAlreadyPaid.selector, globalId
        ));
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));
    }

    function test_SettleInvoice_RevertsOnExpired() public {
        bytes32 globalId = _createInvoice(bytes32("inv-r3"), 100e6, 30 minutes);
        _fundRelayer(eurc, 100e6);

        vm.warp(block.timestamp + 31 minutes);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(
            ArcFXGatewayV8.InvoiceExpired.selector, globalId
        ));
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));
    }

    function test_SettleInvoice_RevertsOnPayoutShortfall() public {
        bytes32 globalId = _createInvoice(bytes32("inv-r4"), 100e6, 1 hours);
        _fundRelayer(eurc, 99e6);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(
            ArcFXGatewayV8.PayoutShortfall.selector, 99e6, 100e6
        ));
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 99e6, bytes32(0));
    }

    function test_SettleInvoice_RevertsWhenPaused() public {
        bytes32 globalId = _createInvoice(bytes32("inv-r5"), 100e6, 1 hours);
        _fundRelayer(eurc, 100e6);

        vm.prank(admin);
        gw.pause();

        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));
    }

    // ── recordPayerRefund ──────────────────────────────────────────────

    function test_RecordPayerRefund_HappyPath() public {
        bytes32 globalId = _createInvoice(bytes32("rp-1"), 100e6, 1 hours);

        vm.prank(relayer);
        gw.recordPayerRefund(globalId, customer, address(usdc), 110e6, bytes32("slippage"));

        (, , , , , ArcFXGatewayV8.InvoiceStatus status, ) = gw.invoices(globalId);
        assertEq(uint8(status), uint8(ArcFXGatewayV8.InvoiceStatus.Failed));
    }

    function test_RecordPayerRefund_RevertsForNonRelayer() public {
        bytes32 globalId = _createInvoice(bytes32("rp-2"), 100e6, 1 hours);

        vm.expectRevert(); // AccessControlUnauthorizedAccount
        gw.recordPayerRefund(globalId, customer, address(usdc), 110e6, bytes32(0));
    }

    function test_RecordPayerRefund_RevertsAfterSettle() public {
        bytes32 globalId = _createInvoice(bytes32("rp-3"), 100e6, 1 hours);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(
            ArcFXGatewayV8.InvoiceNotInCreatedState.selector, globalId
        ));
        gw.recordPayerRefund(globalId, customer, address(usdc), 110e6, bytes32(0));
    }

    // ── refundInvoice (preserved from v0.7) ────────────────────────────

    function test_RefundInvoice_RoundTrip() public {
        bytes32 globalId = _createInvoice(bytes32("rf-1"), 100e6, 1 hours);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));

        // Merchant approves the gateway to pull back the merchantPayout.
        uint256 expectedFee    = (100e6 * FEE_BPS) / 10_000;
        uint256 expectedPayout = 100e6 - expectedFee;
        // payee holds the funds, but refundInvoice pulls from `merchant`. Move them.
        vm.prank(payee);
        eurc.transfer(merchant, expectedPayout);
        vm.prank(merchant);
        eurc.approve(address(gw), expectedPayout);

        vm.prank(merchant);
        gw.refundInvoice(globalId);

        (, , , , , ArcFXGatewayV8.InvoiceStatus status, ) = gw.invoices(globalId);
        assertEq(uint8(status), uint8(ArcFXGatewayV8.InvoiceStatus.Refunded));
        assertEq(eurc.balanceOf(customer), expectedPayout, "customer received refund");
        assertEq(eurc.balanceOf(merchant), expectedFee, "merchant got fee back");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "fee bucket cleared");
    }

    function test_RefundInvoice_RevertsForNonMerchantNonAdmin() public {
        bytes32 globalId = _createInvoice(bytes32("rf-2"), 100e6, 1 hours);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));

        vm.prank(customer);
        vm.expectRevert(ArcFXGatewayV8.NotMerchant.selector);
        gw.refundInvoice(globalId);
    }

    // ── createInvoice ──────────────────────────────────────────────────

    function test_CreateInvoice_RevertsOnUnsupportedPayIn() public {
        MockERC20 random = new MockERC20("Random", "RND", 6);
        vm.prank(merchant);
        vm.expectRevert(ArcFXGatewayV8.InvalidPayInToken.selector);
        gw.createInvoice(bytes32("ci-1"), address(random), 100e6, uint64(block.timestamp + 1 hours));
    }

    function test_CreateInvoice_RevertsWhenPaused() public {
        vm.prank(admin);
        gw.pause();

        vm.prank(merchant);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        gw.createInvoice(bytes32("ci-2"), address(usdc), 100e6, uint64(block.timestamp + 1 hours));
    }

    // ── withdraw + role tests ──────────────────────────────────────────

    function test_WithdrawFees_OnlyAdmin() public {
        bytes32 globalId = _createInvoice(bytes32("wf-1"), 100e6, 1 hours);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), 110e6, 100e6, bytes32(0));

        uint256 expectedFee = (100e6 * FEE_BPS) / 10_000;

        vm.expectRevert(); // AccessControlUnauthorizedAccount
        gw.withdrawFees(address(eurc), admin);

        vm.prank(admin);
        gw.withdrawFees(address(eurc), admin);
        assertEq(eurc.balanceOf(admin), expectedFee, "admin received fees");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "bucket cleared");
    }

    function test_RelayerRole_IsHeldByConstructorRelayer() public view {
        assertTrue(gw.hasRole(gw.RELAYER_ROLE(), relayer));
        assertFalse(gw.hasRole(gw.RELAYER_ROLE(), address(this)));
    }
}
