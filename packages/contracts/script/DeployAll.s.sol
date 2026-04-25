// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { IStableSwapPool } from "../src/interfaces/IStableSwapPool.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockChainlinkFeed } from "../src/testnet/MockChainlinkFeed.sol";
import { OracleAMM } from "../src/pool/OracleAMM.sol";

/// @notice One-shot Arc testnet deployment using the OracleAMM (Chainlink-priced).
/// Required env: DEPLOYER_PRIVATE_KEY, USDC_ADDRESS, EURC_ADDRESS,
/// TREASURY_OWNER, PROTOCOL_FEE_BPS, BOOTSTRAP_USDC, BOOTSTRAP_EURC.
contract DeployAll is Script {
    uint256 constant POOL_FEE_BPS = 4; // 0.04% on each swap (held as spread)

    function run() external returns (ArcFXGateway gateway, OracleAMM pool, MockChainlinkFeed oracle) {
        uint256 pk        = vm.envUint("DEPLOYER_PRIVATE_KEY");
        IERC20  usdc      = IERC20(vm.envAddress("USDC_ADDRESS"));
        IERC20  eurc      = IERC20(vm.envAddress("EURC_ADDRESS"));
        address owner     = vm.envAddress("TREASURY_OWNER");
        uint256 feeBps    = vm.envUint("PROTOCOL_FEE_BPS");
        uint256 bootUSDC  = vm.envUint("BOOTSTRAP_USDC");
        uint256 bootEURC  = vm.envUint("BOOTSTRAP_EURC");

        vm.startBroadcast(pk);

        // 1. Oracle (testnet mock) — real EUR/USD = 1.0863
        oracle = new MockChainlinkFeed(8, 1.0863e8);
        console2.log("MockChainlinkFeed:", address(oracle));

        // 2. Oracle-driven AMM
        pool = new OracleAMM(usdc, eurc, IChainlinkAggregator(address(oracle)), POOL_FEE_BPS, 6, 6);
        console2.log("OracleAMM:        ", address(pool));

        // 3. Bootstrap liquidity
        usdc.approve(address(pool), bootUSDC);
        eurc.approve(address(pool), bootEURC);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = bootUSDC;
        amounts[1] = bootEURC;
        uint256 lp = pool.addLiquidity(amounts, 0, block.timestamp + 30 minutes);
        console2.log("LP minted:        ", lp);

        // 4. Gateway
        gateway = new ArcFXGateway(
            IStableSwapPool(address(pool)),
            IChainlinkAggregator(address(oracle)),
            feeBps,
            owner
        );
        console2.log("ArcFXGateway:     ", address(gateway));

        vm.stopBroadcast();
    }
}
