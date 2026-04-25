// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { IStableSwapPool } from "../src/interfaces/IStableSwapPool.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";

/// @notice Deploys ArcFXGateway. Pool and oracle must already be deployed.
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY     — uint256 hex
///   STABLESWAP_POOL_ADDRESS  — address of deployed Saddle/Curve-compatible pool
///   CHAINLINK_EURUSD_FEED    — address of EUR/USD aggregator (or mock for testnet)
///   TREASURY_OWNER           — address that will own the gateway and receive withdrawn fees
///   PROTOCOL_FEE_BPS         — uint256 (e.g. 10 for 0.10%)
contract Deploy is Script {
    function run() external returns (ArcFXGateway gw) {
        uint256 pk         = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address poolAddr   = vm.envAddress("STABLESWAP_POOL_ADDRESS");
        address oracleAddr = vm.envAddress("CHAINLINK_EURUSD_FEED");
        address owner      = vm.envAddress("TREASURY_OWNER");
        uint256 feeBps     = vm.envUint("PROTOCOL_FEE_BPS");

        vm.startBroadcast(pk);
        gw = new ArcFXGateway(
            IStableSwapPool(poolAddr),
            IChainlinkAggregator(oracleAddr),
            feeBps,
            owner
        );
        vm.stopBroadcast();

        console2.log("ArcFXGateway deployed:", address(gw));
        console2.log("Pool:               ", poolAddr);
        console2.log("Oracle:             ", oracleAddr);
        console2.log("Owner:              ", owner);
        console2.log("Protocol fee (bps): ", feeBps);
    }
}
