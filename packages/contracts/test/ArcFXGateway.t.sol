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
        pool   = new MockStableSwapPool(IERC20(address(usdc)), IERC20(address(eurc)), 1.0860e18);
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

    // ── pay() ──────────────────────────────────────────────────────────

    function _fundPoolAndCustomer() internal {
        usdc.mint(address(pool), 1_000_000 * 1e6);
        eurc.mint(address(pool), 1_000_000 * 1e6);
        eurc.mint(customer, 1_000 * 1e6);
        vm.prank(customer);
        eurc.approve(address(gw), type(uint256).max);
    }

    function test_Pay_HappyPath() public {
        _registerMerchant();
        _fundPoolAndCustomer();

        bytes32 id = keccak256("happy");
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), 49_990_000, uint64(block.timestamp + 1 hours));

        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.prank(customer);
        gw.pay(id, 60_000_000); // generous cushion

        (, , , , ArcFXGateway.InvoiceStatus s, address paidBy) = gw.invoices(id);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Paid));
        assertEq(paidBy, customer);

        uint256 feeUsdc = (49_990_000 * 10) / 10_000;
        assertEq(usdc.balanceOf(merchant) - merchantBefore, 49_990_000 - feeUsdc);
        assertEq(gw.protocolFeesAccrued(address(usdc)), feeUsdc);
    }

    // ── pay() guards ───────────────────────────────────────────────────

    function test_Pay_RevertsOnExpired() public {
        _registerMerchant(); _fundPoolAndCustomer();
        bytes32 id = keccak256("exp");
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 60));
        vm.warp(block.timestamp + 120);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceExpired.selector, id));
        gw.pay(id, 2_000_000);
    }

    function test_Pay_RevertsOnReplay() public {
        _registerMerchant(); _fundPoolAndCustomer();
        bytes32 id = keccak256("rep");
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 1 hours));
        vm.prank(customer); gw.pay(id, 2_000_000);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceAlreadyPaid.selector, id));
        gw.pay(id, 2_000_000);
    }

    function test_Pay_RevertsOnNotFound() public {
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceNotFound.selector, bytes32(0)));
        gw.pay(bytes32(0), 1);
    }

    function test_Pay_RevertsOnSlippageTooTight() public {
        _registerMerchant(); _fundPoolAndCustomer();
        bytes32 id = keccak256("slip");
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 1 hours));
        vm.prank(customer);
        vm.expectRevert();
        gw.pay(id, 500_000);
    }

    function test_Pay_RevertsOnOracleDeviation() public {
        _registerMerchant(); _fundPoolAndCustomer();
        pool.setRate(0.5e18); // rate far from oracle (1.0863)
        bytes32 id = keccak256("dev");
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 1 hours));
        eurc.mint(customer, 100_000 * 1e6);
        vm.prank(customer);
        vm.expectRevert();
        gw.pay(id, type(uint128).max);
    }
}
