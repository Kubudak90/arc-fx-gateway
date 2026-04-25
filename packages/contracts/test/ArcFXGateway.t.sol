// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { IStableSwapPool } from "../src/interfaces/IStableSwapPool.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MockERC20 } from "./helpers/MockERC20.sol";
import { MockChainlink } from "./helpers/MockChainlink.sol";
import { MockStableSwapPool } from "./helpers/MockStableSwapPool.sol";

contract ArcFXGatewayTest is Test {
    MockERC20            usdc;
    MockERC20            eurc;
    MockChainlink        oracle;
    MockStableSwapPool   pool;
    ArcFXGateway         gw;

    address merchant = makeAddr("merchant");
    address customer = makeAddr("customer");

    function setUp() public virtual {
        vm.warp(1_700_000_000); // Set a realistic timestamp
        usdc   = new MockERC20("USDC", "USDC", 6);
        eurc   = new MockERC20("EURC", "EURC", 6);
        oracle = new MockChainlink(8);
        oracle.setAnswer(1.0863e8, block.timestamp);
        pool   = new MockStableSwapPool(IERC20(address(usdc)), IERC20(address(eurc)), 0.9205e18);
        gw     = new ArcFXGateway(
            IStableSwapPool(address(pool)),
            IChainlinkAggregator(address(oracle)),
            10,
            address(this)
        );
    }

    function test_RegisterMerchant_Success() public {
        vm.prank(merchant);
        gw.registerMerchant(address(usdc));
        (address payout, bool registered) = gw.merchants(merchant);
        assertEq(payout, address(usdc));
        assertTrue(registered);
    }

    function test_RegisterMerchant_RevertsOnDoubleRegistration() public {
        vm.prank(merchant);
        gw.registerMerchant(address(usdc));
        vm.prank(merchant);
        vm.expectRevert(ArcFXGateway.MerchantAlreadyRegistered.selector);
        gw.registerMerchant(address(eurc));
    }

    function test_RegisterMerchant_RevertsOnUnsupportedToken() public {
        MockERC20 other = new MockERC20("X", "X", 18);
        vm.prank(merchant);
        vm.expectRevert(ArcFXGateway.InvalidPayoutToken.selector);
        gw.registerMerchant(address(other));
    }

    function test_RegisterMerchant_EmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(gw));
        emit ArcFXGateway.MerchantRegistered(merchant, address(usdc));
        vm.prank(merchant);
        gw.registerMerchant(address(usdc));
    }

    // ── createInvoice ──────────────────────────────────────────────────

    function _registerMerchant() internal {
        vm.prank(merchant);
        gw.registerMerchant(address(usdc));
    }

    function test_CreateInvoice_Success() public {
        _registerMerchant();
        bytes32 id = keccak256("inv-1");
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), 49_990_000, uint64(block.timestamp + 30 minutes));
        (address m, address payIn, uint256 amt, uint64 exp, ArcFXGateway.InvoiceStatus s, ) = gw.invoices(id);
        assertEq(m, merchant);
        assertEq(payIn, address(eurc));
        assertEq(amt, 49_990_000);
        assertEq(exp, uint64(block.timestamp + 30 minutes));
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Created));
    }

    function test_CreateInvoice_RevertsIfNotMerchant() public {
        vm.prank(merchant);
        vm.expectRevert(ArcFXGateway.NotMerchant.selector);
        gw.createInvoice(keccak256("inv-2"), address(eurc), 1, uint64(block.timestamp + 1 hours));
    }

    function test_CreateInvoice_RevertsOnDuplicateId() public {
        _registerMerchant();
        bytes32 id = keccak256("inv-3");
        vm.startPrank(merchant);
        gw.createInvoice(id, address(eurc), 100, uint64(block.timestamp + 1 hours));
        vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceAlreadyExists.selector, id));
        gw.createInvoice(id, address(eurc), 100, uint64(block.timestamp + 1 hours));
        vm.stopPrank();
    }

    function test_CreateInvoice_RevertsOnUnsupportedPair() public {
        _registerMerchant(); // payout = USDC
        vm.prank(merchant);
        vm.expectRevert(ArcFXGateway.UnsupportedPair.selector);
        gw.createInvoice(keccak256("inv-4"), address(usdc), 100, uint64(block.timestamp + 1 hours));
    }

    function test_CreateInvoice_EmitsEvent() public {
        _registerMerchant();
        bytes32 id = keccak256("inv-5");
        vm.expectEmit(true, true, false, true, address(gw));
        emit ArcFXGateway.InvoiceCreated(id, merchant, address(eurc), 50_000_000, uint64(block.timestamp + 1 hours));
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), 50_000_000, uint64(block.timestamp + 1 hours));
    }
}
