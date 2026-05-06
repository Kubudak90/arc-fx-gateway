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
