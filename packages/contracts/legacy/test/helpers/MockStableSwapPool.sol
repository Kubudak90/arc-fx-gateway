// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IStableSwapPool } from "../../src/interfaces/IStableSwapPool.sol";

contract MockStableSwapPool is IStableSwapPool {
    using SafeERC20 for IERC20;
    IERC20[2] public tokens;
    uint256 public rate1to0_1e18; // EURC→USDC implied rate, 1e18-scaled

    constructor(IERC20 usdc, IERC20 eurc, uint256 _rate) {
        tokens[0] = usdc;
        tokens[1] = eurc;
        rate1to0_1e18 = _rate;
    }

    function setRate(uint256 r) external { rate1to0_1e18 = r; }

    function getToken(uint8 i) external view returns (IERC20) { return tokens[i]; }

    function getTokenIndex(address t) external view returns (uint8) {
        if (t == address(tokens[0])) return 0;
        if (t == address(tokens[1])) return 1;
        revert("unknown token");
    }

    function calculateSwap(uint8 i, uint8 j, uint256 dx) public view returns (uint256) {
        if (i == 1 && j == 0) return (dx * rate1to0_1e18) / 1e18;
        if (i == 0 && j == 1) return (dx * 1e18) / rate1to0_1e18;
        revert("bad path");
    }

    function swap(uint8 i, uint8 j, uint256 dx, uint256 minDy, uint256 /*deadline*/) external returns (uint256 dy) {
        dy = calculateSwap(i, j, dx);
        require(dy >= minDy, "slippage");
        tokens[i].safeTransferFrom(msg.sender, address(this), dx);
        tokens[j].safeTransfer(msg.sender, dy);
    }
}
