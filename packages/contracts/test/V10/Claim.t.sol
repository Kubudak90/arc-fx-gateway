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
