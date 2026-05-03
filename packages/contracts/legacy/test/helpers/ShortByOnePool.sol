// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IStableSwapPool } from "../../src/interfaces/IStableSwapPool.sol";

/// @notice Mock pool whose forward swap quote returns one wei less than
/// strict linear extrapolation of the probe rate. Reproduces the off-by-one
/// shortfall observed on the live OracleAMM where the gateway's linear
/// estimate routes to a swap output 1 wei below the merchant target.
contract ShortByOnePool is IStableSwapPool {
    using SafeERC20 for IERC20;
    IERC20[2] public tokens;
    uint256 public probeRateNum1to0_perMicro; // dy = (dx * num)/1e6 - 1 for EURC→USDC

    constructor(IERC20 usdc, IERC20 eurc, uint256 _probeRateNum) {
        tokens[0] = usdc;
        tokens[1] = eurc;
        probeRateNum1to0_perMicro = _probeRateNum;
    }

    function getToken(uint8 i) external view returns (IERC20) { return tokens[i]; }

    function getTokenIndex(address t) external view returns (uint8) {
        if (t == address(tokens[0])) return 0;
        if (t == address(tokens[1])) return 1;
        revert("unknown token");
    }

    /// @dev For probe (dx == 1e6), returns the configured probe number — that's
    /// the rate the gateway anchors its linear inverse on. For any other dx,
    /// returns one wei less than the linear extrapolation, deliberately
    /// breaking the assumption that probe-rate scales exactly to the actual
    /// swap output. Direction USDC→EURC is symmetric for completeness.
    function calculateSwap(uint8 i, uint8 j, uint256 dx) public view returns (uint256) {
        if (i == 1 && j == 0) {
            if (dx == 1e6) return probeRateNum1to0_perMicro;
            uint256 linear = (dx * probeRateNum1to0_perMicro) / 1e6;
            return linear == 0 ? 0 : linear - 1;
        }
        if (i == 0 && j == 1) {
            if (dx == 1e6) return (1e6 * 1e6) / probeRateNum1to0_perMicro;
            uint256 linear = (dx * 1e6) / probeRateNum1to0_perMicro;
            return linear == 0 ? 0 : linear - 1;
        }
        revert("bad path");
    }

    function swap(uint8 i, uint8 j, uint256 dx, uint256 minDy, uint256 /*deadline*/)
        external returns (uint256 dy)
    {
        dy = calculateSwap(i, j, dx);
        require(dy >= minDy, "slippage");
        tokens[i].safeTransferFrom(msg.sender, address(this), dx);
        tokens[j].safeTransfer(msg.sender, dy);
    }
}
