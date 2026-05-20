// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract FeesTest is GatewayTestBase {
    // I1: withdrawFees rejects zero-address `to`
    function test_WithdrawFees_RejectsZeroTo() public {
        // First accrue some fees so we don't hit NoFeesToWithdraw first
        _settle(bytes32("fee-1"), 100e6, 105e6);
        // 5e6 excess accrued immediately at settle; 100e6 escrow still held

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        gw.withdrawFees(address(eurc), address(0));
    }

    // I2: withdrawFees rejects zero balance
    function test_WithdrawFees_RejectsEmpty() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("NoFeesToWithdraw()"));
        gw.withdrawFees(address(eurc), admin);
    }

    // Happy path: transfers full balance and resets accrued to 0
    function test_WithdrawFees_HappyPath() public {
        // Settle with 5e6 excess -> immediately accrued as fee
        _settle(bytes32("fee-2"), 100e6, 105e6);

        uint256 before = eurc.balanceOf(admin);
        vm.prank(admin);
        gw.withdrawFees(address(eurc), admin);

        assertEq(eurc.balanceOf(admin), before + 5e6, "admin receives accrued fee");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "accrued resets to 0");
    }
}
