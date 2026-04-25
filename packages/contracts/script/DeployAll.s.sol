// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { IStableSwapPool } from "../src/interfaces/IStableSwapPool.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockChainlinkFeed } from "../src/testnet/MockChainlinkFeed.sol";
import { StableSwap } from "../src/pool/StableSwap.sol";

/// @notice One-shot Arc testnet deployment.
/// Sequence:
///   1. MockChainlinkFeed (EUR/USD reference, 8 decimals, initial 1.0863e8)
///   2. LPToken (template for cloning by StableSwap)
///   3. StableSwap pool [USDC, EURC] with A=200, fee=4bps, adminFee=50%
///   4. Bootstrap initial liquidity from deployer's balance
///   5. ArcFXGateway pointing at the pool + oracle
///
/// Required env:
///   DEPLOYER_PRIVATE_KEY
///   USDC_ADDRESS
///   EURC_ADDRESS
///   TREASURY_OWNER
///   PROTOCOL_FEE_BPS
///   BOOTSTRAP_USDC
///   BOOTSTRAP_EURC
contract DeployAll is Script {
    uint256 constant FEE_DENOMINATOR = 1e10;
    uint256 constant SWAP_FEE = 4 * 1e6;       // 4 bps = 0.04%
    uint256 constant ADMIN_FEE = 5 * 1e9;      // 50% of swap fee → admin
    uint256 constant A_PARAM = 200;            // amplification

    function run() external returns (
        ArcFXGateway gateway,
        StableSwap pool,
        MockChainlinkFeed oracle
    ) {
        uint256 pk        = vm.envUint("DEPLOYER_PRIVATE_KEY");
        IERC20  usdc      = IERC20(vm.envAddress("USDC_ADDRESS"));
        IERC20  eurc      = IERC20(vm.envAddress("EURC_ADDRESS"));
        address owner     = vm.envAddress("TREASURY_OWNER");
        uint256 feeBps    = vm.envUint("PROTOCOL_FEE_BPS");
        uint256 bootUSDC  = vm.envUint("BOOTSTRAP_USDC");
        uint256 bootEURC  = vm.envUint("BOOTSTRAP_EURC");

        vm.startBroadcast(pk);

        // 1. Oracle (testnet mock) — initial price 1 EUR = 1.0863 USD
        oracle = new MockChainlinkFeed(8, 1.0863e8);
        console2.log("MockChainlinkFeed:", address(oracle));

        // 2. StableSwap pool [USDC, EURC] (LPToken is deployed inside the pool's
        //    constructor; the lpTokenTargetAddress arg is unused in our port — we
        //    pass address(0) for clarity).
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = usdc;
        tokens[1] = eurc;
        uint8[] memory decimals = new uint8[](2);
        decimals[0] = 6;
        decimals[1] = 6;

        pool = new StableSwap(
            tokens,
            decimals,
            "Arc FX USDC/EURC LP",
            "fxLP",
            A_PARAM,
            SWAP_FEE,
            ADMIN_FEE,
            address(0)
        );
        console2.log("StableSwap pool:  ", address(pool));

        // 4. Bootstrap liquidity
        usdc.approve(address(pool), bootUSDC);
        eurc.approve(address(pool), bootEURC);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = bootUSDC;
        amounts[1] = bootEURC;
        uint256 lp = pool.addLiquidity(amounts, 0, block.timestamp + 30 minutes);
        console2.log("LP minted:        ", lp);

        // 5. Gateway
        gateway = new ArcFXGateway(
            IStableSwapPool(address(pool)),
            IChainlinkAggregator(address(oracle)),
            feeBps,
            owner
        );
        console2.log("ArcFXGateway:     ", address(gateway));

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment complete ===");
        console2.log("Pool:    ", address(pool));
        console2.log("Oracle:  ", address(oracle));
        console2.log("Gateway: ", address(gateway));
        console2.log("Owner:   ", owner);
    }
}
