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
