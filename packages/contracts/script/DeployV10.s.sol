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
        if (tokens.length > 0) {
            // Audit #26: setTokenSupport is onlyRole(DEFAULT_ADMIN_ROLE).
            // When deployer != owner, the loop silently no-op'd in the
            // previous version. Surface it loudly so the operator runs
            // setTokenSupport separately from the owner address.
            if (vm.addr(pk) == owner) {
                for (uint i; i < tokens.length; i++) {
                    gw.setTokenSupport(tokens[i], true);
                    console2.log("supported:", tokens[i]);
                }
            } else {
                console2.log("WARN: SUPPORTED_TOKENS set but deployer != owner; tokens NOT whitelisted.");
                console2.log("       Call setTokenSupport(token,true) from the owner address (GATEWAY_OWNER).");
                console2.log("       Deployer:", vm.addr(pk));
                console2.log("       Owner:   ", owner);
                for (uint i; i < tokens.length; i++) {
                    console2.log("       pending:", tokens[i]);
                }
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
