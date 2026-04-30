// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { StablecoinRegistry } from "../src/registry/StablecoinRegistry.sol";
import { StablePool }         from "../src/pool/StablePool.sol";
import { IStablePool }        from "../src/pool/IStablePool.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockChainlinkFeed }    from "../src/testnet/MockChainlinkFeed.sol";
import { MockERC20 }            from "./helpers/MockERC20.sol";

contract StablePoolTest is Test {
    StablecoinRegistry  reg;
    StablePool          pool;
    MockERC20           usdc;
    MockERC20           eurc;
    MockERC20           dai;       // 18 decimals
    MockChainlinkFeed   usdcFeed;
    MockChainlinkFeed   eurcFeed;
    MockChainlinkFeed   daiFeed;

    address owner    = makeAddr("owner");
    address customer = makeAddr("customer");

    uint16 constant DEFAULT_FEE_BPS = 5;
    uint16 constant TIGHT_DEV_BPS   = 50;
    uint16 constant FX_DEV_BPS      = 150;

    function setUp() public virtual {
        vm.warp(1_700_000_000);

        reg = new StablecoinRegistry(owner);
        pool = new StablePool(address(reg), DEFAULT_FEE_BPS, owner);

        usdc     = new MockERC20("USDC", "USDC", 6);
        eurc     = new MockERC20("EURC", "EURC", 6);
        dai      = new MockERC20("DAI",  "DAI",  18);
        usdcFeed = new MockChainlinkFeed(8, 1.0000e8);
        eurcFeed = new MockChainlinkFeed(8, 1.0863e8);
        daiFeed  = new MockChainlinkFeed(8, 1.0000e8);

        vm.startPrank(owner);
        reg.listToken(address(usdc), 6,  IChainlinkAggregator(address(usdcFeed)), TIGHT_DEV_BPS);
        reg.listToken(address(eurc), 6,  IChainlinkAggregator(address(eurcFeed)), FX_DEV_BPS);
        reg.listToken(address(dai),  18, IChainlinkAggregator(address(daiFeed)),  TIGHT_DEV_BPS);
        vm.stopPrank();
    }

    function _seed(address token, uint256 amount) internal {
        MockERC20(token).mint(owner, amount);
        vm.startPrank(owner);
        IERC20(token).approve(address(pool), amount);
        pool.deposit(token, amount);
        vm.stopPrank();
    }

    // ── deposit / withdraw ───────────────────────────────────────────

    function test_Deposit_PullsTokens_AndUpdatesReserve() public {
        usdc.mint(owner, 1_000e6);
        vm.startPrank(owner);
        usdc.approve(address(pool), 1_000e6);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IStablePool.LiquidityDeposited(address(usdc), 1_000e6, 1_000e6);
        pool.deposit(address(usdc), 1_000e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(pool)), 1_000e6);
        assertEq(pool.reserves(address(usdc)), 1_000e6);
    }

    function test_Deposit_RevertsIfNotOwner() public {
        usdc.mint(customer, 1_000e6);
        vm.startPrank(customer);
        usdc.approve(address(pool), 1_000e6);
        vm.expectRevert(); // OZ Ownable
        pool.deposit(address(usdc), 1_000e6);
        vm.stopPrank();
    }

    function test_Deposit_RevertsOnInactiveToken() public {
        MockERC20 other = new MockERC20("X", "X", 6);
        other.mint(owner, 1_000e6);
        vm.startPrank(owner);
        other.approve(address(pool), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(IStablePool.TokenNotActive.selector, address(other)));
        pool.deposit(address(other), 1_000e6);
        vm.stopPrank();
    }

    function test_Withdraw_TransfersOut_AndUpdatesReserve() public {
        _seed(address(usdc), 1_000e6);
        vm.expectEmit(true, false, false, true, address(pool));
        emit IStablePool.LiquidityWithdrawn(address(usdc), 400e6, 600e6);
        vm.prank(owner);
        pool.withdraw(address(usdc), 400e6, owner);
        assertEq(pool.reserves(address(usdc)), 600e6);
        assertEq(usdc.balanceOf(owner), 400e6);
    }

    function test_Withdraw_RevertsOnInsufficientReserve() public {
        _seed(address(usdc), 100e6);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IStablePool.InsufficientLiquidity.selector, address(usdc), 200e6, 100e6));
        pool.withdraw(address(usdc), 200e6, owner);
    }

    // ── pause / unpause ──────────────────────────────────────────────

    function test_Pause_BlocksDeposit_AllowsWithdraw() public {
        _seed(address(usdc), 1_000e6);
        vm.prank(owner);
        pool.pause();

        usdc.mint(owner, 100e6);
        vm.startPrank(owner);
        usdc.approve(address(pool), 100e6);
        vm.expectRevert(IStablePool.PoolPaused.selector);
        pool.deposit(address(usdc), 100e6);

        // withdraw still works (unwinding path)
        pool.withdraw(address(usdc), 200e6, owner);
        vm.stopPrank();
        assertEq(pool.reserves(address(usdc)), 800e6);
    }

    function test_Pause_RevertsIfNotOwner() public {
        vm.prank(customer);
        vm.expectRevert();
        pool.pause();
    }

    function test_Unpause_RestoresDeposits() public {
        vm.prank(owner);
        pool.pause();
        vm.prank(owner);
        pool.unpause();
        usdc.mint(owner, 100e6);
        vm.startPrank(owner);
        usdc.approve(address(pool), 100e6);
        pool.deposit(address(usdc), 100e6);
        vm.stopPrank();
        assertEq(pool.reserves(address(usdc)), 100e6);
    }

    // ── fee setter ────────────────────────────────────────────────────

    function test_SetSwapFee_Success() public {
        vm.expectEmit(true, false, false, true, address(pool));
        emit IStablePool.SwapFeeUpdated(DEFAULT_FEE_BPS, 30);
        vm.prank(owner);
        pool.setSwapFeeBps(30);
        assertEq(pool.swapFeeBps(), 30);
    }

    function test_SetSwapFee_RevertsAbove50() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IStablePool.InvalidFeeBps.selector, 51));
        pool.setSwapFeeBps(51);
    }
}
