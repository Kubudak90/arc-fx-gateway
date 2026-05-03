// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISaddleAddLiquidity {
    function addLiquidity(
        uint256[] calldata amounts,
        uint256 minToMint,
        uint256 deadline
    ) external returns (uint256);
}

/// @notice Seeds initial liquidity into the StableSwap pool.
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY
///   STABLESWAP_POOL_ADDRESS
///   USDC_ADDRESS
///   EURC_ADDRESS
///   BOOTSTRAP_USDC   — uint256 (raw token units, e.g. 100_000 * 1e6)
///   BOOTSTRAP_EURC   — uint256 (raw token units, e.g. 92_000  * 1e6)
contract BootstrapLiquidity is Script {
    function run() external returns (uint256 lp) {
        uint256 pk      = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address pool    = vm.envAddress("STABLESWAP_POOL_ADDRESS");
        IERC20  usdc    = IERC20(vm.envAddress("USDC_ADDRESS"));
        IERC20  eurc    = IERC20(vm.envAddress("EURC_ADDRESS"));
        uint256 usdcAmt = vm.envUint("BOOTSTRAP_USDC");
        uint256 eurcAmt = vm.envUint("BOOTSTRAP_EURC");

        vm.startBroadcast(pk);
        usdc.approve(pool, usdcAmt);
        eurc.approve(pool, eurcAmt);

        // Saddle pools index tokens at construction; assume USDC=0, EURC=1
        // (matches our gateway's assumption). If your pool ordering differs, swap them.
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = usdcAmt;
        amounts[1] = eurcAmt;

        lp = ISaddleAddLiquidity(pool).addLiquidity(amounts, 0, block.timestamp + 30 minutes);
        vm.stopBroadcast();

        console2.log("LP minted:    ", lp);
        console2.log("USDC seeded:  ", usdcAmt);
        console2.log("EURC seeded:  ", eurcAmt);
    }
}
