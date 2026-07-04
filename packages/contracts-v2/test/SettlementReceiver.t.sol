// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockMessageTransmitter} from "./mocks/MockMessageTransmitter.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";
import {MockLiFiRouter} from "./mocks/MockLiFiRouter.sol";

contract SettlementReceiverTest is Test {
    SettlementReceiver internal sr;
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockMessageTransmitter internal transmitter;
    MockTokenMessenger internal messenger;
    MockLiFiRouter internal lifi;

    uint32 internal constant SOURCE_DOMAIN = 6; // Base — where the buyer paid
    uint32 internal constant LOCAL_DOMAIN = 3; // Arbitrum — this dest chain
    address internal owner = address(this);
    address internal merchant = makeAddr("merchant");
    address internal buyer = makeAddr("buyer");
    address internal sourceEscrow = makeAddr("sourceEscrow");

    uint256 internal constant RECEIVED = 9_900_000; // 9.9 USDC minted (10 - 0.1 fee)

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        transmitter = new MockMessageTransmitter(usdc);
        messenger = new MockTokenMessenger();
        lifi = new MockLiFiRouter();

        sr = new SettlementReceiver(LOCAL_DOMAIN, address(usdc), address(transmitter), address(messenger), owner);
        sr.setTrustedEscrow(SOURCE_DOMAIN, _b32(sourceEscrow));
        sr.setLocalToken(SettlementReceiver.PayoutToken.EURC, address(eurc));
        sr.setLifiRouter(address(lifi));

        transmitter.setMintAmount(RECEIVED);
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _escrowId(uint256 entropy) internal pure returns (bytes32) {
        // byte[0]=version 0x01, byte[1]=SOURCE_DOMAIN, byte[2..31]=entropy
        return bytes32((uint256(0x01) << 248) | (uint256(SOURCE_DOMAIN) << 240) | (entropy & ((uint256(1) << 240) - 1)));
    }

    /// Build a CCTP V2 wire message (abi.encodePacked, exact offsets).
    function _message(address mintRecipient, bytes32 msgSender, bytes memory hookData)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory header = abi.encodePacked(
            uint32(1), // version
            SOURCE_DOMAIN, // sourceDomain
            uint32(LOCAL_DOMAIN), // destinationDomain
            bytes32(0), // nonce
            bytes32(0), // sender (header)
            bytes32(0), // recipient (header)
            bytes32(0), // destinationCaller
            uint32(1000), // minFinalityThreshold
            uint32(1000) // finalityThresholdExecuted
        );
        bytes memory body = abi.encodePacked(
            uint32(1), // body version
            bytes32(0), // burnToken
            _b32(mintRecipient), // mintRecipient (offset 184)
            uint256(10_000_000), // amount (offset 216) — SR uses balance delta, not this
            msgSender, // messageSender (offset 248)
            uint256(0), // maxFee
            uint256(0), // feeExecuted
            uint256(0), // expirationBlock
            hookData // offset 376 → end
        );
        return abi.encodePacked(header, body);
    }

    function _hook(bytes32 escrowId, address merchant_, SettlementReceiver.PayoutToken token, uint256 minOut, address payer)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(escrowId, merchant_, uint8(token), minOut, payer);
    }

    function _receive(bytes32 escrowId, address merchant_, SettlementReceiver.PayoutToken token, uint256 minOut)
        internal
    {
        bytes memory hd = _hook(escrowId, merchant_, token, minOut, buyer);
        bytes memory message = _message(address(sr), _b32(sourceEscrow), hd);
        sr.receiveAndSettle(message, "");
    }

    // ── Path B (USDC payout) ───────────────────────────────────────────────────
    function test_PathB_HealthyMerchant_PaidAtomically() public {
        bytes32 id = _escrowId(1);
        _receive(id, merchant, SettlementReceiver.PayoutToken.USDC, 0);

        assertEq(usdc.balanceOf(merchant), RECEIVED, "merchant paid net amount");
        assertEq(usdc.balanceOf(address(sr)), 0, "nothing parked");
        assertTrue(sr.processed(id));
        (, uint256 failedAmt) = sr.failedPayout(id);
        assertEq(failedAmt, 0, "no failed payout");
    }

    function test_PathB_BlacklistedMerchant_ParksWithoutReverting() public {
        usdc.setBlocked(merchant, true); // Circle froze the merchant
        bytes32 id = _escrowId(2);

        _receive(id, merchant, SettlementReceiver.PayoutToken.USDC, 0); // must NOT revert

        assertEq(usdc.balanceOf(merchant), 0, "merchant not paid");
        assertEq(usdc.balanceOf(address(sr)), RECEIVED, "mint succeeded, funds parked");
        (address payer, uint256 amount) = sr.failedPayout(id);
        assertEq(payer, buyer);
        assertEq(amount, RECEIVED);
        assertEq(sr.parkedUSDC(), RECEIVED);
    }

    function test_RecoverToBuyer_BurnsBackToSourceDomain() public {
        usdc.setBlocked(merchant, true);
        bytes32 id = _escrowId(3);
        _receive(id, merchant, SettlementReceiver.PayoutToken.USDC, 0);

        sr.recoverToBuyer(id, 1000, 1000);

        assertEq(messenger.burnCount(), 1, "one recovery burn");
        MockTokenMessenger.Burn memory b = messenger.lastBurn();
        assertFalse(b.withHook, "plain depositForBurn (no hook)");
        assertEq(b.amount, RECEIVED);
        assertEq(b.destinationDomain, SOURCE_DOMAIN, "back to the chain the buyer paid from");
        assertEq(b.mintRecipient, _b32(buyer), "mintRecipient = buyer");
        assertEq(b.destinationCaller, bytes32(0), "anyone may relay the recovery");
        assertEq(usdc.allowance(address(sr), address(messenger)), 0, "approval reset");
        assertEq(sr.parkedUSDC(), 0);
        (, uint256 amt) = sr.failedPayout(id);
        assertEq(amt, 0, "failed payout cleared");
    }

    function test_RecoverToBuyer_NothingFailed_Reverts() public {
        bytes32 id = _escrowId(99);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.NothingFailed.selector, id));
        sr.recoverToBuyer(id, 0, 1000);
    }

    // ── Path C (token payout, deferred settle) ─────────────────────────────────
    function test_PathC_RecordsPending_NoSwapInHook() public {
        bytes32 id = _escrowId(4);
        _receive(id, merchant, SettlementReceiver.PayoutToken.EURC, 9_000_000);

        assertEq(eurc.balanceOf(merchant), 0, "no swap during receive");
        assertEq(usdc.balanceOf(address(sr)), RECEIVED, "USDC held pending");
        (address m, SettlementReceiver.PayoutToken tok, uint256 amount, uint256 floor) = sr.pending(id);
        assertEq(m, merchant);
        assertEq(uint8(tok), uint8(SettlementReceiver.PayoutToken.EURC));
        assertEq(amount, RECEIVED);
        assertEq(floor, 9_000_000);
        assertEq(sr.parkedUSDC(), RECEIVED);
    }

    function test_PathC_Settle_GoodQuote_MerchantGetsToken() public {
        bytes32 id = _escrowId(5);
        _receive(id, merchant, SettlementReceiver.PayoutToken.EURC, 9_000_000);

        uint256 amountOut = 9_100_000;
        bytes memory swapCalldata =
            abi.encodeCall(MockLiFiRouter.swap, (address(usdc), RECEIVED, address(eurc), amountOut, address(sr)));
        sr.settle(id, swapCalldata, 9_000_000);

        assertEq(eurc.balanceOf(merchant), amountOut, "merchant got EURC");
        assertGe(eurc.balanceOf(merchant), 9_000_000, ">= minOut");
        assertEq(usdc.balanceOf(address(sr)), 0, "USDC swapped");
        assertEq(usdc.allowance(address(sr), address(lifi)), 0, "approval reset");
        assertEq(sr.parkedUSDC(), 0);
    }

    function test_PathC_Settle_HookFloorEnforced_EvenIfKeeperMinOutLower() public {
        bytes32 id = _escrowId(6);
        _receive(id, merchant, SettlementReceiver.PayoutToken.EURC, 9_000_000); // floor 9.0

        uint256 amountOut = 8_500_000; // below the hook floor
        bytes memory swapCalldata =
            abi.encodeCall(MockLiFiRouter.swap, (address(usdc), RECEIVED, address(eurc), amountOut, address(sr)));
        // keeper passes a low minOut, but the hook floor (9.0) governs → revert
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.InsufficientOutput.selector, amountOut, 9_000_000));
        sr.settle(id, swapCalldata, 0);
    }

    function test_PathC_Settle_NoRoute_FallbackUSDC() public {
        bytes32 id = _escrowId(7);
        _receive(id, merchant, SettlementReceiver.PayoutToken.EURC, 9_000_000);

        sr.settle(id, "", 0); // empty calldata = no viable route
        assertEq(usdc.balanceOf(merchant), RECEIVED, "merchant paid in USDC fallback");
        assertEq(eurc.balanceOf(merchant), 0);
        assertEq(sr.parkedUSDC(), 0);
    }

    function test_PathC_Settle_NothingPending_Reverts() public {
        bytes32 id = _escrowId(8);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.NothingPending.selector, id));
        sr.settle(id, "", 0);
    }

    // ── authorization / idempotency ────────────────────────────────────────────
    function test_UntrustedSender_Reverts() public {
        bytes32 id = _escrowId(9);
        bytes memory hd = _hook(id, merchant, SettlementReceiver.PayoutToken.USDC, 0, buyer);
        bytes memory message = _message(address(sr), _b32(makeAddr("imposter")), hd);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementReceiver.UntrustedSender.selector, SOURCE_DOMAIN, _b32(makeAddr("imposter")))
        );
        sr.receiveAndSettle(message, "");
    }

    function test_WrongMintRecipient_Reverts() public {
        bytes32 id = _escrowId(10);
        bytes memory hd = _hook(id, merchant, SettlementReceiver.PayoutToken.USDC, 0, buyer);
        // mint goes to a different recipient → SR sees no balance delta + mismatch
        bytes memory message = _message(makeAddr("other"), _b32(sourceEscrow), hd);
        vm.expectRevert(SettlementReceiver.NotMintRecipient.selector);
        sr.receiveAndSettle(message, "");
    }

    function test_DoubleProcess_Reverts() public {
        bytes32 id = _escrowId(11);
        _receive(id, merchant, SettlementReceiver.PayoutToken.USDC, 0);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.AlreadyProcessed.selector, id));
        _receive(id, merchant, SettlementReceiver.PayoutToken.USDC, 0);
    }

    function test_ReceiveFailed_Reverts() public {
        transmitter.setReturnFalse(true);
        bytes32 id = _escrowId(12);
        bytes memory hd = _hook(id, merchant, SettlementReceiver.PayoutToken.USDC, 0, buyer);
        bytes memory message = _message(address(sr), _b32(sourceEscrow), hd);
        vm.expectRevert(SettlementReceiver.ReceiveFailed.selector);
        sr.receiveAndSettle(message, "");
    }

    function test_KeeperGating_OnSettleAndRecover() public {
        address keeper = makeAddr("keeper");
        sr.setKeeper(keeper);

        bytes32 id = _escrowId(13);
        _receive(id, merchant, SettlementReceiver.PayoutToken.EURC, 0);

        vm.prank(makeAddr("rando"));
        vm.expectRevert(SettlementReceiver.NotKeeper.selector);
        sr.settle(id, "", 0);

        vm.prank(keeper);
        sr.settle(id, "", 0); // fallback USDC
        assertEq(usdc.balanceOf(merchant), RECEIVED);
    }

    // ── reentrancy: a malicious swap router cannot re-enter settle ─────────────
    function test_Reentrancy_SettleBlocked() public {
        ReentrantRouter attacker = new ReentrantRouter(sr);
        sr.setLifiRouter(address(attacker));

        bytes32 id = _escrowId(14);
        _receive(id, merchant, SettlementReceiver.PayoutToken.EURC, 0);
        attacker.arm(id);

        // settle calls the attacker as the router, which re-enters settle → the
        // ReentrancyGuard reverts, bubbling up and reverting the whole settle.
        vm.expectRevert();
        sr.settle(id, abi.encodeWithSignature("doSwap()"), 0);
        // pending is intact (settle fully reverted) → funds safe, retryable.
        (, , uint256 amount,) = sr.pending(id);
        assertEq(amount, RECEIVED, "pending preserved after blocked reentrancy");
    }

    // ── rescue safety ──────────────────────────────────────────────────────────
    function test_RescueCannotTakeOwedUSDC() public {
        usdc.setBlocked(merchant, true);
        bytes32 id = _escrowId(15);
        _receive(id, merchant, SettlementReceiver.PayoutToken.USDC, 0); // parks RECEIVED
        vm.expectRevert(SettlementReceiver.CannotRescueOwedUSDC.selector);
        sr.rescue(address(usdc), owner, 1);
    }
}

/// Re-enters settle when called as the Li.Fi router.
contract ReentrantRouter {
    SettlementReceiver internal immutable sr;
    bytes32 internal armedId;

    constructor(SettlementReceiver _sr) {
        sr = _sr;
    }

    function arm(bytes32 id) external {
        armedId = id;
    }

    function doSwap() external {
        sr.settle(armedId, "", 0); // re-entry — must hit the ReentrancyGuard
    }
}
