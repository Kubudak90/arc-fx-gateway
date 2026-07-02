// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

/// Drives the gateway's fund-moving API against a bounded actor set while maintaining ghost
/// accounting of the open escrow per token. Escrows are non-enumerable in the contract, so the
/// handler tracks each open escrow's amount to know what a refund/claim/recover removes.
///
/// The merchant (registered in GatewayTestBase.setUp) has payoutToken = EURC, so every escrow is
/// denominated in EURC. USDC is the pay-in token and never enters the gateway, so its solvency
/// identity is the trivial 0 == 0 + 0 — still asserted as a regression guard.
contract SolvencyHandler is Test {
    ArcFXGateway public gw;
    MockERC20 public usdc;
    MockERC20 public eurc;
    address public merchant;
    address public relayer;
    address public admin;
    address public customer;

    /// ghost: sum of open (settled-but-not-closed) escrow amounts, per token.
    mapping(address => uint256) public ghostOpenEscrow;
    bytes32[] public active;
    mapping(bytes32 => uint256) public escrowAmt;
    uint256 private nonce;

    constructor(
        ArcFXGateway _gw,
        MockERC20 _usdc,
        MockERC20 _eurc,
        address _merchant,
        address _relayer,
        address _admin,
        address _customer
    ) {
        gw = _gw;
        usdc = _usdc;
        eurc = _eurc;
        merchant = _merchant;
        relayer = _relayer;
        admin = _admin;
        customer = _customer;
    }

    /// Create + settle an invoice: relayer funds `gross` EURC, gateway escrows it.
    function settle(uint256 amountSeed, uint256 excessSeed) public {
        uint256 amountOut = bound(amountSeed, 1e6, 1_000_000e6);
        uint256 gross = amountOut + bound(excessSeed, 0, 100e6); // grossPayout >= amountOut
        bytes32 iid = keccak256(abi.encode("inv", nonce++));

        vm.prank(merchant);
        bytes32 g = gw.createInvoice(iid, address(usdc), amountOut, uint64(block.timestamp + 1 hours));

        eurc.mint(relayer, gross);
        vm.prank(relayer);
        eurc.approve(address(gw), gross);
        vm.prank(relayer);
        gw.settleInvoice(g, customer, address(usdc), gross + 10e6, gross, bytes32(0));

        ghostOpenEscrow[address(eurc)] += gross;
        escrowAmt[g] = gross;
        active.push(g);
    }

    /// Refund an open escrow within the window: full gross back to the customer, no fee.
    function refund(uint256 seed) public {
        if (active.length == 0) return;
        uint256 i = bound(seed, 0, active.length - 1);
        bytes32 g = active[i];
        vm.prank(merchant);
        try gw.refundInvoice(g) {
            ghostOpenEscrow[address(eurc)] -= escrowAmt[g];
            _remove(i);
        } catch {}
    }

    /// Claim an open escrow after the window: fee → protocolFeesAccrued, rest → payee.
    function claim(uint256 seed) public {
        if (active.length == 0) return;
        uint256 i = bound(seed, 0, active.length - 1);
        bytes32 g = active[i];
        vm.warp(block.timestamp + 7 days + 1);
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = g;
        try gw.claim(ids) {
            ghostOpenEscrow[address(eurc)] -= escrowAmt[g];
            _remove(i);
        } catch {}
    }

    /// Sweep accrued protocol fees. Leaves ghostOpenEscrow untouched (fees are read live).
    function withdrawFees() public {
        vm.prank(admin);
        try gw.withdrawFees(address(eurc), admin) {} catch {}
    }

    function _remove(uint256 i) internal {
        active[i] = active[active.length - 1];
        active.pop();
    }
}

contract GatewayInvariantTest is GatewayTestBase {
    SolvencyHandler handler;

    function setUp() public override {
        super.setUp();
        handler = new SolvencyHandler(gw, usdc, eurc, merchant, relayer, admin, customer);

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = SolvencyHandler.settle.selector;
        selectors[1] = SolvencyHandler.refund.selector;
        selectors[2] = SolvencyHandler.claim.selector;
        selectors[3] = SolvencyHandler.withdrawFees.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// The custody invariant: the gateway holds exactly the open escrows plus the accrued fees,
    /// per token, across any interleaving of settle / refund / claim / withdrawFees.
    function invariant_solvency() public view {
        assertEq(
            eurc.balanceOf(address(gw)),
            handler.ghostOpenEscrow(address(eurc)) + gw.protocolFeesAccrued(address(eurc)),
            "EURC solvency: balance != open escrow + fees"
        );
        assertEq(
            usdc.balanceOf(address(gw)),
            handler.ghostOpenEscrow(address(usdc)) + gw.protocolFeesAccrued(address(usdc)),
            "USDC solvency: balance != open escrow + fees"
        );
    }

    /// Accrued fees can always be withdrawn — they never exceed the held balance.
    function invariant_feesNeverExceedBalance() public view {
        assertLe(gw.protocolFeesAccrued(address(eurc)), eurc.balanceOf(address(gw)));
        assertLe(gw.protocolFeesAccrued(address(usdc)), usdc.balanceOf(address(gw)));
    }
}
