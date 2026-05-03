// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { ArcFXGatewayV9 } from "../src/ArcFXGatewayV9.sol";

/// @notice Deploys the v0.9 (refund-source binding) ArcFXGateway. Same shape
/// as DeployV8 — only the contract changed; the constructor + token whitelist
/// flow is identical.
///
/// Why V9: V8's refundInvoice pulled merchantPayout from inv.merchant, but
/// settlement deposited to merchants[m].payoutAddress. Split-wallet merchants
/// couldn't refund. V9 snapshots the actual payout address into
/// payments[globalId].payoutSource at settle time and refunds pull from
/// there. See docs/superpowers/specs/2026-05-03-plan-9-refund-source-binding.md.
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
contract DeployV9 is Script {
    function run() external returns (ArcFXGatewayV9 gw) {
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
        gw = new ArcFXGatewayV9(feeBps, owner, relayer_);

        // Optionally seed the token whitelist in the same broadcast.
        if (tokens.length > 0 && vm.addr(pk) == owner) {
            for (uint i; i < tokens.length; i++) {
                gw.setTokenSupport(tokens[i], true);
                console2.log("supported:", tokens[i]);
            }
        }
        vm.stopBroadcast();

        console2.log("ArcFXGatewayV9:    ", address(gw));
        console2.log("Owner:             ", owner);
        console2.log("Relayer:           ", relayer_);
        console2.log("Protocol fee (bps):", feeBps);
    }
}
