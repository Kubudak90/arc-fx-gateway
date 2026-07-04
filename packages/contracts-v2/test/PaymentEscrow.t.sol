// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PaymentEscrow} from "../src/PaymentEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";
import {MockLiFiRouter} from "./mocks/MockLiFiRouter.sol";

contract PaymentEscrowTest is Test {
    PaymentEscrow internal escrow;
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockTokenMessenger internal messenger;
    MockLiFiRouter internal lifi;

    uint32 internal constant LOCAL_DOMAIN = 6; // Base
    uint32 internal constant DEST_DOMAIN = 3; // Arbitrum
    uint256 internal constant WINDOW = 300;

    address internal owner = address(this);
    address internal buyer = makeAddr("buyer");
    address internal merchant = makeAddr("merchant");
    bytes32 internal destReceiver = bytes32(uint256(uint160(makeAddr("destReceiver"))));

    uint256 internal constant AMOUNT = 10_000_000; // 10 USDC

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        messenger = new MockTokenMessenger();
        lifi = new MockLiFiRouter();

        escrow = new PaymentEscrow(LOCAL_DOMAIN, address(usdc), address(messenger), WINDOW, owner);
        escrow.setLocalToken(PaymentEscrow.PayoutToken.EURC, address(eurc));
        escrow.setLifiRouter(address(lifi));
        escrow.setSettlementReceiver(DEST_DOMAIN, destReceiver);

        usdc.mint(buyer, 1_000_000_000);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    function _params(bytes32 idemKey, uint32 payoutDomain, PaymentEscrow.PayoutToken token)
        internal
        view
        returns (PaymentEscrow.DepositParams memory)
    {
        return PaymentEscrow.DepositParams({
            idemKey: idemKey,
            invoiceRef: keccak256(abi.encode("invoice", idemKey)),
            merchant: merchant,
            payoutDomain: payoutDomain,
            payoutToken: token,
            amount: AMOUNT
        });
    }

    function _deposit(bytes32 idemKey, uint32 payoutDomain, PaymentEscrow.PayoutToken token)
        internal
        returns (bytes32 id)
    {
        vm.prank(buyer);
        id = escrow.deposit(_params(idemKey, payoutDomain, token));
    }

    function _emptySettle() internal pure returns (PaymentEscrow.SettleParams memory) {
        return PaymentEscrow.SettleParams({minOut: 0, maxFee: 0, minFinalityThreshold: 1000, swapCalldata: ""});
    }

    // ── deposit ────────────────────────────────────────────────────────────────
    function test_DepositPullsExactUSDC_AndEscrows() public {
        uint256 before = usdc.balanceOf(buyer);
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);

        assertEq(usdc.balanceOf(buyer), before - AMOUNT, "buyer debited exact");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrow holds USDC");
        assertEq(escrow.totalEscrowed(), AMOUNT);

        PaymentEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(e.payer, buyer);
        assertEq(e.merchant, merchant);
        assertEq(e.amount, AMOUNT);
        assertEq(uint8(e.status), uint8(PaymentEscrow.Status.Escrowed));
    }

    function test_DepositIsIdempotent_NoDoublePull() public {
        bytes32 key = bytes32(uint256(42));
        bytes32 id1 = _deposit(key, LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        uint256 balAfterFirst = usdc.balanceOf(address(escrow));

        bytes32 id2 = _deposit(key, LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        assertEq(id1, id2, "same escrowId");
        assertEq(usdc.balanceOf(address(escrow)), balAfterFirst, "no second pull");
        assertEq(escrow.totalEscrowed(), AMOUNT, "single escrow");
    }

    function test_EscrowId_VersionAndDomainBytes() public {
        bytes32 id = _deposit(bytes32(uint256(7)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        uint8 version = uint8(uint256(id) >> 248);
        uint8 domain = uint8(uint256(id) >> 240);
        assertEq(version, 0x01, "byte[0] version");
        assertEq(domain, uint8(LOCAL_DOMAIN), "byte[1] domain");
        assertEq(escrow.escrowIdDomain(id), uint8(LOCAL_DOMAIN));
    }

    function test_DepositZeroAmountReverts() public {
        PaymentEscrow.DepositParams memory p = _params(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        p.amount = 0;
        vm.prank(buyer);
        vm.expectRevert(PaymentEscrow.ZeroAmount.selector);
        escrow.deposit(p);
    }

    function test_DepositZeroMerchantReverts() public {
        PaymentEscrow.DepositParams memory p = _params(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        p.merchant = address(0);
        vm.prank(buyer);
        vm.expectRevert(PaymentEscrow.ZeroMerchant.selector);
        escrow.deposit(p);
    }

    // ── refund ───────────────────────────────────────────────────────────────
    function test_RefundBeforeWindow_ExactUSDCToPayer() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        uint256 before = usdc.balanceOf(buyer);

        escrow.refund(id); // permissionless; funds can only go to recorded payer
        assertEq(usdc.balanceOf(buyer), before + AMOUNT, "payer made whole");
        assertEq(escrow.totalEscrowed(), 0);

        PaymentEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(PaymentEscrow.Status.Refunded));
    }

    function test_RefundAfterWindow_Reverts() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(PaymentEscrow.RefundWindowClosed.selector);
        escrow.refund(id);
    }

    function test_RefundGoesToPayerNotCaller() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        address attacker = makeAddr("attacker");
        uint256 attackerBefore = usdc.balanceOf(attacker);
        uint256 payerBefore = usdc.balanceOf(buyer);

        vm.prank(attacker);
        escrow.refund(id); // no redirect param exists
        assertEq(usdc.balanceOf(attacker), attackerBefore, "attacker gets nothing");
        assertEq(usdc.balanceOf(buyer), payerBefore + AMOUNT, "payer gets refund");
    }

    function test_DoubleRefund_Reverts() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        escrow.refund(id);
        vm.expectRevert(PaymentEscrow.NotEscrowed.selector);
        escrow.refund(id);
    }

    // ── settle: same-chain ─────────────────────────────────────────────────────
    function test_SettleBeforeWindow_Reverts() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.expectRevert(PaymentEscrow.RefundWindowOpen.selector);
        escrow.settle(id, _emptySettle());
    }

    function test_SettleSameChainUSDC_MerchantExactAmount() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);

        escrow.settle(id, _emptySettle());
        assertEq(usdc.balanceOf(merchant), AMOUNT, "merchant paid exact");
        assertEq(escrow.totalEscrowed(), 0);
        PaymentEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(PaymentEscrow.Status.Settled));
    }

    function test_SettleSameChainEURC_SwapAboveMinOut() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.EURC);
        vm.warp(block.timestamp + WINDOW + 1);

        uint256 amountOut = 9_200_000; // 9.2 EURC for 10 USDC
        PaymentEscrow.SettleParams memory s = PaymentEscrow.SettleParams({
            minOut: 9_000_000,
            maxFee: 0,
            minFinalityThreshold: 1000,
            swapCalldata: abi.encodeCall(
                MockLiFiRouter.swap, (address(usdc), AMOUNT, address(eurc), amountOut, address(escrow))
            )
        });
        escrow.settle(id, s);

        assertEq(eurc.balanceOf(merchant), amountOut, "merchant got swapped EURC");
        assertGe(eurc.balanceOf(merchant), s.minOut, "above minOut");
        assertEq(usdc.balanceOf(address(escrow)), 0, "USDC swapped out");
        assertEq(usdc.allowance(address(escrow), address(lifi)), 0, "approval reset");
    }

    function test_SettleSameChainEURC_BelowMinOut_Reverts() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.EURC);
        vm.warp(block.timestamp + WINDOW + 1);

        uint256 amountOut = 8_000_000; // 8 EURC — below the 9 floor
        PaymentEscrow.SettleParams memory s = PaymentEscrow.SettleParams({
            minOut: 9_000_000,
            maxFee: 0,
            minFinalityThreshold: 1000,
            swapCalldata: abi.encodeCall(
                MockLiFiRouter.swap, (address(usdc), AMOUNT, address(eurc), amountOut, address(escrow))
            )
        });
        vm.expectRevert(abi.encodeWithSelector(PaymentEscrow.InsufficientOutput.selector, amountOut, s.minOut));
        escrow.settle(id, s);
    }

    // ── settle: cross-chain ────────────────────────────────────────────────────
    function test_SettleCrossChain_BurnsWithHook_ApprovalReset() public {
        bytes32 id = _deposit(bytes32(uint256(1)), DEST_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);

        PaymentEscrow.SettleParams memory s =
            PaymentEscrow.SettleParams({minOut: 0, maxFee: 50_000, minFinalityThreshold: 1000, swapCalldata: ""});
        escrow.settle(id, s);

        assertEq(messenger.burnCount(), 1, "one burn");
        MockTokenMessenger.Burn memory b = messenger.lastBurn();
        assertTrue(b.withHook, "used withHook");
        assertEq(b.amount, AMOUNT);
        assertEq(b.destinationDomain, DEST_DOMAIN);
        assertEq(b.mintRecipient, destReceiver, "mintRecipient = dest receiver");
        assertEq(b.destinationCaller, destReceiver, "destinationCaller = dest receiver");
        assertEq(b.burnToken, address(usdc));
        assertEq(b.maxFee, 50_000);
        assertEq(b.minFinalityThreshold, 1000);

        // hookData = abi.encode(escrowId, merchant, payoutToken(uint8), minOut, payer)
        (bytes32 hookId, address hookMerchant, uint8 hookToken, uint256 hookMinOut, address hookPayer) =
            abi.decode(b.hookData, (bytes32, address, uint8, uint256, address));
        assertEq(hookId, id);
        assertEq(hookMerchant, merchant);
        assertEq(hookToken, uint8(PaymentEscrow.PayoutToken.USDC));
        assertEq(hookMinOut, 0);
        assertEq(hookPayer, buyer);

        assertEq(usdc.allowance(address(escrow), address(messenger)), 0, "approval reset to 0");
        assertEq(escrow.totalEscrowed(), 0);
    }

    function test_SettleCrossChain_NoReceiver_Reverts() public {
        uint32 unknownDomain = 7; // Polygon — no receiver configured
        bytes32 id = _deposit(bytes32(uint256(1)), unknownDomain, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(PaymentEscrow.NoReceiver.selector, unknownDomain));
        escrow.settle(id, _emptySettle());
    }

    // ── protocol fee (skimmed in USDC at settle, before payout/bridge) ─────────
    function test_SettleSameChainUSDC_WithFee_SkimAndNet() public {
        address feeRecipient = makeAddr("fee");
        escrow.setFeeConfig(feeRecipient, 50); // 0.50%
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(id, _emptySettle());
        uint256 fee = (AMOUNT * 50) / 10_000;
        assertEq(usdc.balanceOf(feeRecipient), fee, "fee skimmed in USDC");
        assertEq(usdc.balanceOf(merchant), AMOUNT - fee, "merchant got net");
    }

    function test_SettleCrossChain_WithFee_BurnsNet() public {
        address feeRecipient = makeAddr("fee");
        escrow.setFeeConfig(feeRecipient, 30); // 0.30%
        bytes32 id = _deposit(bytes32(uint256(1)), DEST_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);
        PaymentEscrow.SettleParams memory s =
            PaymentEscrow.SettleParams({minOut: 0, maxFee: 0, minFinalityThreshold: 1000, swapCalldata: ""});
        escrow.settle(id, s);
        uint256 fee = (AMOUNT * 30) / 10_000;
        assertEq(usdc.balanceOf(feeRecipient), fee, "fee skimmed on source chain");
        assertEq(messenger.lastBurn().amount, AMOUNT - fee, "bridges net of fee");
    }

    function test_SetFeeConfig_CapEnforced() public {
        vm.expectRevert(abi.encodeWithSelector(PaymentEscrow.FeeTooHigh.selector, uint16(101)));
        escrow.setFeeConfig(makeAddr("fee"), 101);
        escrow.setFeeConfig(makeAddr("fee"), 100); // exactly at the 1% cap is allowed
        assertEq(escrow.feeBps(), 100);
    }

    function test_RefundNeverPaysFee() public {
        address feeRecipient = makeAddr("fee");
        escrow.setFeeConfig(feeRecipient, 100);
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        uint256 before = usdc.balanceOf(buyer);
        escrow.refund(id); // refund is pre-settle → full amount, no fee
        assertEq(usdc.balanceOf(buyer), before + AMOUNT, "full refund");
        assertEq(usdc.balanceOf(feeRecipient), 0, "no fee on refund");
    }

    // ── keeper gating + lifecycle exclusivity ──────────────────────────────────
    function test_KeeperGating() public {
        address keeper = makeAddr("keeper");
        escrow.setKeeper(keeper);
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);

        vm.prank(makeAddr("rando"));
        vm.expectRevert(PaymentEscrow.NotKeeper.selector);
        escrow.settle(id, _emptySettle());

        vm.prank(keeper);
        escrow.settle(id, _emptySettle());
        assertEq(usdc.balanceOf(merchant), AMOUNT);
    }

    function test_RefundAfterSettle_Reverts() public {
        bytes32 id = _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(id, _emptySettle());
        vm.expectRevert(PaymentEscrow.NotEscrowed.selector);
        escrow.refund(id);
    }

    // ── rescue safety ──────────────────────────────────────────────────────────
    function test_RescueCannotTakeEscrowedUSDC() public {
        _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        vm.expectRevert(PaymentEscrow.CannotRescueEscrowedUSDC.selector);
        escrow.rescue(address(usdc), owner, 1);
    }

    function test_RescueCanTakeStraySurplusUSDC() public {
        _deposit(bytes32(uint256(1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        usdc.mint(address(escrow), 5_000_000); // stray surplus above totalEscrowed
        escrow.rescue(address(usdc), owner, 5_000_000);
        assertEq(usdc.balanceOf(owner), 5_000_000);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrowed USDC untouched");
    }

    function testFuzz_BalanceCoversEscrowed(uint8 n) public {
        vm.assume(n > 0 && n <= 20);
        for (uint256 i = 0; i < n; i++) {
            _deposit(bytes32(uint256(i + 1)), LOCAL_DOMAIN, PaymentEscrow.PayoutToken.USDC);
        }
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalEscrowed());
        assertEq(escrow.totalEscrowed(), AMOUNT * n);
    }
}
