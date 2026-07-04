// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";

/// Stand-in for the Li.Fi router. `swap` pulls `amountIn` of tokenIn from the
/// caller (using the finite approval the escrow granted) and mints `amountOut` of
/// tokenOut to `to`. The escrow builds the calldata, so `amountOut` lets a test
/// drive both the happy path and the below-minOut revert.
contract MockLiFiRouter {
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut, address to) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).mint(to, amountOut);
    }
}
