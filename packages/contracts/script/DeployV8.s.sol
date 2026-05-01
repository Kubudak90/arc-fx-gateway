// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { ArcFXGatewayV8 } from "../src/ArcFXGatewayV8.sol";

/// @notice Deploys the v0.8 (pool-free, relayer-driven) ArcFXGateway. No pool,
/// no oracle — App Kit Swap on Arc owns the FX, the relayer owns settlement.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY   — uint256 hex
///   GATEWAY_OWNER          — address that holds DEFAULT_ADMIN_ROLE
///   GATEWAY_RELAYER        — address that holds RELAYER_ROLE (the Arcora
///                            hot wallet running ops/relayer/run.ts)
///   PROTOCOL_FEE_BPS       — uint256 (e.g. 30 for 0.30%)
///
/// Optional, comma-separated lowercase 0x… addresses to whitelist on deploy:
///   SUPPORTED_TOKENS       — e.g. "0x3600...0000,0x89B5...D72a" (USDC, EURC)
contract DeployV8 is Script {
    function run() external returns (ArcFXGatewayV8 gw) {
        uint256 pk        = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner     = vm.envAddress("GATEWAY_OWNER");
        address relayer_  = vm.envAddress("GATEWAY_RELAYER");
        uint256 feeBps    = vm.envUint("PROTOCOL_FEE_BPS");
        address[] memory tokens = vm.envOr(
            "SUPPORTED_TOKENS",
            ",",
            new address[](0)
        );

        vm.startBroadcast(pk);
        gw = new ArcFXGatewayV8(feeBps, owner, relayer_);

        // Optionally seed the token whitelist in the same broadcast. Owner of
        // the contract is `owner`, but the deployer is `vm.addr(pk)`. If they
        // are not the same address, we leave whitelisting to the owner to do
        // post-deploy via setTokenSupport().
        if (tokens.length > 0 && vm.addr(pk) == owner) {
            for (uint i; i < tokens.length; i++) {
                gw.setTokenSupport(tokens[i], true);
                console2.log("supported:", tokens[i]);
            }
        }
        vm.stopBroadcast();

        console2.log("ArcFXGatewayV8:    ", address(gw));
        console2.log("Owner:             ", owner);
        console2.log("Relayer:           ", relayer_);
        console2.log("Protocol fee (bps):", feeBps);
    }
}
