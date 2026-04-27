// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { OracleAMM } from "../src/pool/OracleAMM.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockERC20 } from "./helpers/MockERC20.sol";
import { MockChainlink } from "./helpers/MockChainlink.sol";

contract OracleAMMTest is Test {
    MockERC20     usdc;
    MockERC20     eurc;
    MockChainlink oracle;
    OracleAMM     pool;

    address lp       = makeAddr("lp");
    address swapper  = makeAddr("swapper");

    function setUp() public {
        usdc   = new MockERC20("USDC", "USDC", 6);
        eurc   = new MockERC20("EURC", "EURC", 6);
        oracle = new MockChainlink(8);
        oracle.setAnswer(1.0863e8, block.timestamp); // 1 EUR = 1.0863 USD
        pool   = new OracleAMM(IERC20(address(usdc)), IERC20(address(eurc)), IChainlinkAggregator(address(oracle)), 4, 6, 6); // 4 bps fee
    }

    function _seed() internal {
        usdc.mint(lp, 100_000 * 1e6);
        eurc.mint(lp, 92_000  * 1e6);
        vm.startPrank(lp);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        uint256[] memory amts = new uint256[](2);
        amts[0] = 100_000 * 1e6;
        amts[1] = 92_000  * 1e6;
        pool.addLiquidity(amts, 0, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_AddLiquidity_FirstDepositSetsRatio() public {
        _seed();
        // expected USDC-denominated value: 100_000e6 + 92_000e6 * 1.0863 = 199_939.6e6
        uint256 expected = 100_000 * 1e6 + (92_000 * 1e6 * 1.0863e18) / 1e18;
        assertEq(pool.totalSupply(), expected);
        assertEq(pool.balanceOf(lp), expected);
        assertEq(pool.reserve0(), 100_000 * 1e6);
        assertEq(pool.reserve1(), 92_000 * 1e6);
    }

    function test_Quote_EURCtoUSDC_AppliesFee() public {
        _seed();
        // 100 EURC → ~108.63 USDC gross, fee 4 bps → ~108.586 USDC net
        uint256 gross = (100 * 1e6 * 1.0863e18) / 1e18;
        uint256 fee   = (gross * 4) / 10_000;
        uint256 expected = gross - fee;
        assertEq(pool.calculateSwap(1, 0, 100 * 1e6), expected);
    }

    function test_Quote_USDCtoEURC_AppliesFee() public {
        _seed();
        // 108.63 USDC → ~100 EURC gross, fee 4 bps → ~99.96 EURC net
        uint256 gross = (108_630_000 * 1e18) / 1.0863e18;
        uint256 fee   = (gross * 4) / 10_000;
        uint256 expected = gross - fee;
        assertEq(pool.calculateSwap(0, 1, 108_630_000), expected);
    }

    function test_Swap_EURCtoUSDC_HappyPath() public {
        _seed();
        eurc.mint(swapper, 100 * 1e6);
        vm.startPrank(swapper);
        eurc.approve(address(pool), type(uint256).max);
        uint256 expected = pool.calculateSwap(1, 0, 100 * 1e6);
        uint256 got = pool.swap(1, 0, 100 * 1e6, 0, block.timestamp + 1 hours);
        vm.stopPrank();
        assertEq(got, expected);
        assertEq(usdc.balanceOf(swapper), expected);
    }

    function test_Swap_RevertsOnSlippage() public {
        _seed();
        eurc.mint(swapper, 100 * 1e6);
        vm.startPrank(swapper);
        eurc.approve(address(pool), type(uint256).max);
        uint256 expected = pool.calculateSwap(1, 0, 100 * 1e6);
        vm.expectRevert(abi.encodeWithSelector(OracleAMM.InsufficientOutput.selector, expected, expected + 1));
        pool.swap(1, 0, 100 * 1e6, expected + 1, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_Swap_RevertsOnDeadline() public {
        _seed();
        eurc.mint(swapper, 1 * 1e6);
        vm.startPrank(swapper);
        eurc.approve(address(pool), type(uint256).max);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(OracleAMM.DeadlinePassed.selector);
        pool.swap(1, 0, 1 * 1e6, 0, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_Swap_RevertsOnStaleOracle() public {
        _seed();
        // Move oracle freshness out of bound.
        vm.warp(block.timestamp + 2 hours);
        eurc.mint(swapper, 1 * 1e6);
        vm.startPrank(swapper);
        eurc.approve(address(pool), type(uint256).max);
        vm.expectRevert();
        pool.swap(1, 0, 1 * 1e6, 0, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_RemoveLiquidity_Proportional() public {
        _seed();
        uint256 lpBal = pool.balanceOf(lp);
        uint256[] memory mins = new uint256[](2);
        vm.prank(lp);
        uint256[] memory got = pool.removeLiquidity(lpBal, mins, block.timestamp + 1 hours);
        assertEq(got[0], 100_000 * 1e6);
        assertEq(got[1], 92_000  * 1e6);
        assertEq(pool.totalSupply(), 0);
    }

    function test_GetToken_GetIndex() public view {
        assertEq(address(pool.getToken(0)), address(usdc));
        assertEq(address(pool.getToken(1)), address(eurc));
        assertEq(pool.getTokenIndex(address(usdc)), 0);
        assertEq(pool.getTokenIndex(address(eurc)), 1);
    }

    function test_GetToken_RevertsOnInvalidIndex() public {
        vm.expectRevert(OracleAMM.InvalidTokenIndex.selector);
        pool.getToken(2);
    }
}
