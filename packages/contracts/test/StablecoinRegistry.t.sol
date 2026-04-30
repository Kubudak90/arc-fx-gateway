// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { StablecoinRegistry } from "../src/registry/StablecoinRegistry.sol";
import { IStablecoinRegistry } from "../src/registry/IStablecoinRegistry.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockChainlinkFeed } from "../src/testnet/MockChainlinkFeed.sol";
import { MockERC20 } from "./helpers/MockERC20.sol";

contract StablecoinRegistryTest is Test {
    StablecoinRegistry  reg;
    MockERC20           usdc;
    MockChainlinkFeed   usdcFeed;
    address             owner = makeAddr("owner");
    address             newOwner = makeAddr("newOwner");
    address             stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_700_000_000);
        reg = new StablecoinRegistry(owner);
        usdc = new MockERC20("USDC", "USDC", 6);
        usdcFeed = new MockChainlinkFeed(8, 1.0000e8);
    }

    function test_ListToken_Success() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit IStablecoinRegistry.TokenListed(address(usdc), 6, address(usdcFeed), 50);
        vm.prank(owner);
        reg.listToken(address(usdc), 6, IChainlinkAggregator(address(usdcFeed)), 50);

        IStablecoinRegistry.TokenInfo memory info = reg.tokenInfo(address(usdc));
        assertEq(info.decimals, 6);
        assertTrue(info.isActive);
        assertEq(address(info.usdOracle), address(usdcFeed));
        assertEq(info.maxOracleDeviationBps, 50);
        assertEq(reg.tokens(0), address(usdc));
        assertEq(reg.tokensLength(), 1);
        assertTrue(reg.isActive(address(usdc)));
    }

    function test_ListToken_RevertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(); // OZ Ownable: OwnableUnauthorizedAccount
        reg.listToken(address(usdc), 6, IChainlinkAggregator(address(usdcFeed)), 50);
    }

    function test_ListToken_RevertsOnDuplicate() public {
        vm.prank(owner);
        reg.listToken(address(usdc), 6, IChainlinkAggregator(address(usdcFeed)), 50);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IStablecoinRegistry.TokenAlreadyListed.selector, address(usdc)));
        reg.listToken(address(usdc), 6, IChainlinkAggregator(address(usdcFeed)), 50);
    }

    function test_ListToken_RevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IStablecoinRegistry.ZeroAddress.selector);
        reg.listToken(address(0), 6, IChainlinkAggregator(address(usdcFeed)), 50);
    }

    function test_ListToken_RevertsOnInvalidDecimals() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IStablecoinRegistry.InvalidDecimals.selector, 0));
        reg.listToken(address(usdc), 0, IChainlinkAggregator(address(usdcFeed)), 50);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IStablecoinRegistry.InvalidDecimals.selector, 30));
        reg.listToken(address(usdc), 30, IChainlinkAggregator(address(usdcFeed)), 50);
    }

    function test_ListToken_RevertsOnInvalidDeviation() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IStablecoinRegistry.InvalidDeviation.selector, 0));
        reg.listToken(address(usdc), 6, IChainlinkAggregator(address(usdcFeed)), 0);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IStablecoinRegistry.InvalidDeviation.selector, 10_001));
        reg.listToken(address(usdc), 6, IChainlinkAggregator(address(usdcFeed)), 10_001);
    }

    function test_Ownable2Step_AcceptHandshake() public {
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        // Pending — owner unchanged until accept
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), newOwner);
        // newOwner accepts
        vm.prank(newOwner);
        reg.acceptOwnership();
        assertEq(reg.owner(), newOwner);
        assertEq(reg.pendingOwner(), address(0));
    }
}
