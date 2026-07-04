// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

/// Drives the gateway's fund-moving API against a bounded actor set while maintaining ghost
/// accounting of the open escrow per token. Escrows are non-enumerable in the contract, so the
/// handler tracks each open escrow's amount + token to know what a refund/claim/recover removes.
///
/// 2026-07-05 (audit LOW): coverage was widened from one merchant / one payout token to TWO
/// merchants on DIFFERENT payout tokens — merchant A settles in EURC, merchant B in USDC — so the
/// multi-token solvency identity is genuinely exercised (was the trivial 0 == 0 + 0). The handler
/// now also drives `adminRecoverEscrow` (funds leave the gateway) and `recordPayerRefund` (a
/// Created→Failed transition on an un-settled invoice, which must never touch escrow balances).
contract SolvencyHandler is Test {
    ArcFXGateway public gw;
    MockERC20 public usdc;
    MockERC20 public eurc;
    address public merchantA; // payout EURC
    address public merchantB; // payout USDC
    address public relayer;
    address public admin;
    address public customer;

    /// ghost: sum of open (settled-but-not-closed) escrow amounts, per token.
    mapping(address => uint256) public ghostOpenEscrow;
    bytes32[] public active;
    mapping(bytes32 => uint256) public escrowAmt;
    mapping(bytes32 => address) public escrowToken;   // payout token of the escrow
    mapping(bytes32 => address) public escrowMerchant; // merchant that owns the escrow
    uint256 private nonce;

    constructor(
        ArcFXGateway _gw,
        MockERC20 _usdc,
        MockERC20 _eurc,
        address _merchantA,
        address _merchantB,
        address _relayer,
        address _admin,
        address _customer
    ) {
        gw = _gw;
        usdc = _usdc;
        eurc = _eurc;
        merchantA = _merchantA;
        merchantB = _merchantB;
        relayer = _relayer;
        admin = _admin;
        customer = _customer;
    }

    /// Create + settle an invoice for one of the two merchants; the gateway escrows `gross` of that
    /// merchant's payout token (EURC for A, USDC for B).
    function settle(uint256 whichSeed, uint256 amountSeed, uint256 excessSeed) public {
        bool useB = whichSeed % 2 == 1;
        address merchant = useB ? merchantB : merchantA;
        MockERC20 payout = useB ? usdc : eurc;

        uint256 amountOut = bound(amountSeed, 1e6, 1_000_000e6);
        uint256 gross = amountOut + bound(excessSeed, 0, 100e6); // grossPayout >= amountOut
        bytes32 iid = keccak256(abi.encode("inv", nonce++));

        vm.prank(merchant);
        try gw.createInvoice(iid, address(usdc), amountOut, uint64(block.timestamp + 1 hours)) returns (bytes32 g) {
            payout.mint(relayer, gross);
            vm.prank(relayer);
            payout.approve(address(gw), gross);
            vm.prank(relayer);
            gw.settleInvoice(g, customer, address(usdc), gross + 10e6, gross, bytes32(0));

            ghostOpenEscrow[address(payout)] += gross;
            escrowAmt[g] = gross;
            escrowToken[g] = address(payout);
            escrowMerchant[g] = merchant;
            active.push(g);
        } catch {}
    }

    /// Refund an open escrow within the window: full gross back to the customer, no fee.
    function refund(uint256 seed) public {
        if (active.length == 0) return;
        uint256 i = bound(seed, 0, active.length - 1);
        bytes32 g = active[i];
        vm.prank(escrowMerchant[g]);
        try gw.refundInvoice(g) {
            ghostOpenEscrow[escrowToken[g]] -= escrowAmt[g];
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
            ghostOpenEscrow[escrowToken[g]] -= escrowAmt[g];
            _remove(i);
        } catch {}
    }

    /// Admin-recover an open escrow: deactivate the owning merchant, wait out the recovery delay,
    /// sweep the full escrow OUT of the gateway (no fee), then reactivate so the merchant is reusable.
    function adminRecover(uint256 seed) public {
        if (active.length == 0) return;
        uint256 i = bound(seed, 0, active.length - 1);
        bytes32 g = active[i];
        address merchant = escrowMerchant[g];

        vm.prank(merchant);
        try gw.deactivateMerchant() {} catch { return; }

        vm.warp(block.timestamp + 7 days + 7 days + 1); // refund window + recovery delay
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = g;
        vm.prank(admin);
        try gw.adminRecoverEscrow(ids, admin) {
            ghostOpenEscrow[escrowToken[g]] -= escrowAmt[g];
            _remove(i);
        } catch {}

        // Reactivate so future settle() calls for this merchant still work.
        vm.prank(admin);
        try gw.reactivateMerchant(merchant) {} catch {}
    }

    /// Record a payer refund on a freshly-created (un-settled) invoice: Created → Failed. There is
    /// no escrow behind a Created invoice, so this must leave every ghost balance untouched — the
    /// invariant then proves recordPayerRefund can never perturb solvency.
    function recordPayerRefund(uint256 amountSeed) public {
        bytes32 iid = keccak256(abi.encode("fail", nonce++));
        vm.prank(merchantA);
        try gw.createInvoice(iid, address(usdc), bound(amountSeed, 1e6, 1e12), uint64(block.timestamp + 1 hours))
            returns (bytes32 g)
        {
            vm.prank(relayer);
            try gw.recordPayerRefund(g, customer, address(usdc), bound(amountSeed, 1e6, 1e12), bytes32(0)) {} catch {}
        } catch {}
    }

    /// Sweep accrued protocol fees for both tokens. Leaves ghostOpenEscrow untouched (fees are read live).
    function withdrawFees(uint256 seed) public {
        address token = seed % 2 == 1 ? address(usdc) : address(eurc);
        vm.prank(admin);
        try gw.withdrawFees(token, admin) {} catch {}
    }

    function _remove(uint256 i) internal {
        active[i] = active[active.length - 1];
        active.pop();
    }
}

contract GatewayInvariantTest is GatewayTestBase {
    SolvencyHandler handler;
    address merchantB = makeAddr("merchantB");
    address payeeB    = makeAddr("payeeB");

    function setUp() public override {
        super.setUp();
        // Second merchant on a DIFFERENT payout token so multi-token solvency is non-trivial.
        vm.prank(merchantB);
        gw.registerMerchant(payeeB, address(usdc));

        handler = new SolvencyHandler(gw, usdc, eurc, merchant, merchantB, relayer, admin, customer);

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = SolvencyHandler.settle.selector;
        selectors[1] = SolvencyHandler.refund.selector;
        selectors[2] = SolvencyHandler.claim.selector;
        selectors[3] = SolvencyHandler.adminRecover.selector;
        selectors[4] = SolvencyHandler.recordPayerRefund.selector;
        selectors[5] = SolvencyHandler.withdrawFees.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// The custody invariant: the gateway holds exactly the open escrows plus the accrued fees,
    /// per token, across any interleaving of settle / refund / claim / adminRecover / recordPayerRefund.
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
