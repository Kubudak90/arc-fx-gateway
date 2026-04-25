// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStableSwapPool {
    function getToken(uint8 index) external view returns (IERC20);
    function getTokenIndex(address tokenAddress) external view returns (uint8);
    function calculateSwap(uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 dx)
        external view returns (uint256);
    function swap(
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        uint256 deadline
    ) external returns (uint256);
}
