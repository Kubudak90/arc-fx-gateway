// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PriceGuard } from "../src/libraries/PriceGuard.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockChainlink } from "./helpers/MockChainlink.sol";

/// @dev Harness that exposes the internal library as external calls so vm.expectRevert works.
contract PriceGuardHarness {
    function check(uint256 poolRate, IChainlinkAggregator feed, uint256 maxDeviationBps) external view {
        PriceGuard.check(poolRate, feed, maxDeviationBps);
    }
}

contract PriceGuardTest is Test {
    MockChainlink feed;
    PriceGuardHarness harness;

    function setUp() public {
        vm.warp(1_700_000_000); // Set a realistic timestamp so stale-check arithmetic works
        feed = new MockChainlink(8);
        feed.setAnswer(1.0863e8, block.timestamp);
        harness = new PriceGuardHarness();
    }

    function test_Check_PassesWithinTolerance() public view {
        harness.check(1.0860e18, feed, 50);
    }

    function test_Check_RevertsBeyondTolerance() public {
        uint256 poolRate = 1.0730e18;
        vm.expectRevert(
            abi.encodeWithSelector(PriceGuard.OracleDeviation.selector, poolRate, 1.0863e18, uint256(50))
        );
        harness.check(poolRate, feed, 50);
    }

    function test_Check_RevertsOnStaleOracle() public {
        uint256 staleAt = block.timestamp - 2 hours;
        feed.setAnswer(1.0863e8, staleAt);
        vm.expectRevert(
            abi.encodeWithSelector(PriceGuard.StaleOracle.selector, staleAt)
        );
        harness.check(1.0863e18, feed, 50);
    }

    function test_Check_RevertsOnInvalidPrice() public {
        feed.setAnswer(-1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.InvalidOraclePrice.selector, int256(-1)));
        harness.check(1.0863e18, feed, 50);
    }

    function test_Check_ScalesDecimalsCorrectly() public {
        MockChainlink feed18 = new MockChainlink(18);
        feed18.setAnswer(1.0863e18, block.timestamp);
        harness.check(1.0860e18, feed18, 50);
    }

    function test_Check_ScalesDecimalsAbove18() public {
        // Oracle with 20 decimals: 1.0863e20 should scale down to 1.0863e18
        MockChainlink feed20 = new MockChainlink(20);
        feed20.setAnswer(1.0863e20, block.timestamp);
        harness.check(1.0860e18, feed20, 50);
    }
}
