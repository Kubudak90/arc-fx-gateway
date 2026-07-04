// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// 2026-07-05 (audit LOW): the last DEFAULT_ADMIN_ROLE holder must not be
/// removable — via renounceRole OR revokeRole — or every admin op (pause,
/// withdrawFees, adminRecover, token allowlist) is permanently bricked.
contract AdminRoleFloorTest is GatewayTestBase {
    bytes32 constant ADMIN = 0x00; // DEFAULT_ADMIN_ROLE

    function test_LastAdmin_CannotRenounce() public {
        vm.prank(admin);
        vm.expectRevert(ArcFXGateway.CannotRemoveLastAdmin.selector);
        gw.renounceRole(ADMIN, admin);
        assertTrue(gw.hasRole(ADMIN, admin), "admin retained");
    }

    function test_LastAdmin_CannotRevoke() public {
        vm.prank(admin);
        vm.expectRevert(ArcFXGateway.CannotRemoveLastAdmin.selector);
        gw.revokeRole(ADMIN, admin);
        assertTrue(gw.hasRole(ADMIN, admin), "admin retained");
    }

    function test_SecondAdmin_ThenFirstCanLeave() public {
        address admin2 = makeAddr("admin2");
        vm.prank(admin);
        gw.grantRole(ADMIN, admin2);
        assertTrue(gw.hasRole(ADMIN, admin2));

        // With two admins, the original can now step down.
        vm.prank(admin);
        gw.renounceRole(ADMIN, admin);
        assertFalse(gw.hasRole(ADMIN, admin), "first admin left");
        assertTrue(gw.hasRole(ADMIN, admin2), "second admin remains");

        // ...but now admin2 is the last one and is likewise pinned.
        vm.prank(admin2);
        vm.expectRevert(ArcFXGateway.CannotRemoveLastAdmin.selector);
        gw.renounceRole(ADMIN, admin2);
    }

    function test_GrantRevokeCycle_KeepsCountExact() public {
        address admin2 = makeAddr("admin2");
        // Idempotent grants/revokes must not corrupt the internal count.
        vm.startPrank(admin);
        gw.grantRole(ADMIN, admin2);
        gw.grantRole(ADMIN, admin2); // no-op grant
        gw.revokeRole(ADMIN, admin2);
        gw.revokeRole(ADMIN, admin2); // no-op revoke
        vm.stopPrank();

        // Back to a single admin — who is still the pinned last one.
        vm.prank(admin);
        vm.expectRevert(ArcFXGateway.CannotRemoveLastAdmin.selector);
        gw.renounceRole(ADMIN, admin);
        assertTrue(gw.hasRole(ADMIN, admin));
    }

    function test_RevokingANonAdminAccount_IsNoopNotRevert() public {
        // Revoking DEFAULT_ADMIN_ROLE from an address that never had it must not
        // trip the last-admin guard (the count is unchanged, nothing removed).
        address nobody = makeAddr("nobody");
        vm.prank(admin);
        gw.revokeRole(ADMIN, nobody);
        assertTrue(gw.hasRole(ADMIN, admin), "real admin untouched");
    }
}
