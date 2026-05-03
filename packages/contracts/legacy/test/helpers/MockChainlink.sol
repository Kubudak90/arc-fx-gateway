// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IChainlinkAggregator } from "../../src/interfaces/IChainlinkAggregator.sol";

contract MockChainlink is IChainlinkAggregator {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public immutable decimalsOverride;

    constructor(uint8 _decimals) { decimalsOverride = _decimals; }

    function setAnswer(int256 _answer, uint256 _updatedAt) external {
        answer = _answer;
        updatedAt = _updatedAt;
    }

    function decimals() external view returns (uint8) { return decimalsOverride; }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
