// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";

/// @title PaymentEscrow
/// @notice Per-chain escrow for the chain-agnostic CCTP V2 payment router
///         (PLAN §4.1). The buyer ALWAYS locks USDC here on the chain they pay
///         from; settlement later picks the cheapest correct path.
///
/// @dev LIFECYCLE (the resolution of PLAN §2/§4.1's deposit-vs-refund timing):
///      `deposit` only escrows USDC — it never pays the merchant or burns. While
///      `block.timestamp <= createdAt + REFUND_WINDOW` the buyer can `refund`
///      (USDC-only, to the recorded payer, on THIS chain — PLAN decision 7). Once
///      the window passes, `settle` dispatches by path:
///        • Path A (payoutDomain == LOCAL_DOMAIN): USDC transfer, or same-chain
///          Li.Fi swap → payout token → merchant.
///        • Path B/C (cross chain): depositForBurnWithHook to the destination
///          SettlementReceiver, which performs the dest-side payout.
///      Keeping USDC escrowed until the window closes is what makes refund a
///      single, swap-free, bridge-free transfer for EVERY path — the whole reason
///      the design is simple. `refund` and `settle` are mutually exclusive via the
///      status guard, so a paid escrow can never also be refunded.
contract PaymentEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────────
    enum Status {
        None,
        Escrowed,
        Settled,
        Refunded
    }

    enum PayoutToken {
        USDC,
        EURC,
        USDT
    }

    struct Escrow {
        address payer; // who locked the USDC; refund returns here, non-redirectable
        address merchant; // who gets paid at settle
        uint256 amount; // USDC minor units locked
        uint64 createdAt; // escrow time; refund window = createdAt + REFUND_WINDOW
        uint32 payoutDomain; // CCTP domain the merchant wants paid on
        PayoutToken payoutToken;
        Status status;
    }

    /// Caller supplies the off-chain invoice's merchant + payout config at deposit.
    struct DepositParams {
        bytes32 idemKey; // idempotency key (off-chain invoice derived)
        bytes32 invoiceRef; // off-chain logical invoice id (indexed in the event)
        address merchant;
        uint32 payoutDomain;
        PayoutToken payoutToken;
        uint256 amount; // exact USDC pulled from msg.sender
    }

    /// Settle-time params carry FRESH values (quotes/fees) — never baked at deposit.
    struct SettleParams {
        uint256 minOut; // Path A swap floor / Path C hook floor
        uint256 maxFee; // CCTP Fast-Transfer max fee (Path B/C)
        uint32 minFinalityThreshold; // 1000 fast / 2000 standard (Path B/C)
        bytes swapCalldata; // Li.Fi router calldata (Path A non-USDC only)
    }

    // ── Immutables ───────────────────────────────────────────────────────────
    uint8 internal constant ESCROW_ID_VERSION = 0x01;

    /// CCTP domain of THIS chain — written into escrowId byte[1], never caller-set.
    uint32 public immutable LOCAL_DOMAIN;
    IERC20 public immutable USDC;
    ITokenMessengerV2 public immutable TOKEN_MESSENGER;
    /// Seconds the buyer can refund before the merchant may be settled.
    uint256 public immutable REFUND_WINDOW;

    // ── Config (owner-managed) ───────────────────────────────────────────────
    /// destination CCTP domain → SettlementReceiver address (bytes32, CCTP-padded).
    mapping(uint32 => bytes32) public settlementReceiver;
    /// non-USDC payout token → its address on THIS chain (for same-chain swaps).
    mapping(PayoutToken => address) public localToken;
    /// Trusted Li.Fi router for same-chain swaps (finite approvals only).
    address public lifiRouter;
    /// If non-zero, only this address (or owner) may call `settle`. Zero = open.
    address public keeper;
    /// Protocol fee in basis points, skimmed in USDC on THIS chain at settle —
    /// before any payout or CCTP bridge, so fees always accrue as USDC here
    /// regardless of path. Refund (pre-settle) never pays a fee.
    uint16 public feeBps;
    address public feeRecipient;
    uint16 internal constant MAX_FEE_BPS = 100; // 1.00% hard cap

    // ── Storage ──────────────────────────────────────────────────────────────
    mapping(bytes32 => Escrow) public escrows; // escrowId → escrow
    mapping(bytes32 => bytes32) public idemKeyToEscrow; // idemKey → escrowId
    /// Sum of USDC across active (Escrowed) escrows. Invariant: USDC balance ≥ this.
    uint256 public totalEscrowed;

    // ── Events ───────────────────────────────────────────────────────────────
    event Deposited(
        bytes32 indexed escrowId,
        bytes32 indexed invoiceRef,
        address indexed payer,
        address merchant,
        uint256 amount,
        uint32 payoutDomain,
        PayoutToken payoutToken
    );
    event Refunded(bytes32 indexed escrowId, address indexed payer, uint256 amount);
    event Settled(bytes32 indexed escrowId, address indexed merchant, address token, uint256 amount);
    event BridgedForSettlement(
        bytes32 indexed escrowId,
        uint32 indexed payoutDomain,
        bytes32 receiver,
        uint256 amount,
        uint32 minFinalityThreshold,
        uint256 maxFee
    );
    event SettlementReceiverSet(uint32 indexed domain, bytes32 receiver);
    event LocalTokenSet(PayoutToken indexed token, address addr);
    event LifiRouterSet(address router);
    event KeeperSet(address keeper);
    event FeeConfigSet(address feeRecipient, uint16 feeBps);
    event FeeTaken(bytes32 indexed escrowId, address indexed feeRecipient, uint256 fee);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    // ── Errors ───────────────────────────────────────────────────────────────
    error DomainTooLarge(uint32 domain); // byte[1] of escrowId holds one byte
    error ZeroAmount();
    error ZeroMerchant();
    error NotEscrowed();
    error RefundWindowOpen();
    error RefundWindowClosed();
    error NotKeeper();
    error NoReceiver(uint32 domain);
    error TokenNotConfigured(PayoutToken token);
    error NoSwapRouter();
    error BadFinalityThreshold(uint32 threshold);
    error InsufficientOutput(uint256 got, uint256 minOut);
    error CannotRescueEscrowedUSDC();
    error FeeTooHigh(uint16 feeBps);

    constructor(
        uint32 localDomain,
        address usdc,
        address tokenMessenger,
        uint256 refundWindow,
        address owner_
    ) Ownable(owner_) {
        // byte[1] of escrowId is a single byte — all real CCTP domains fit, but
        // enforce it so a future >255 domain cannot silently corrupt the id.
        if (localDomain > type(uint8).max) revert DomainTooLarge(localDomain);
        LOCAL_DOMAIN = localDomain;
        USDC = IERC20(usdc);
        TOKEN_MESSENGER = ITokenMessengerV2(tokenMessenger);
        REFUND_WINDOW = refundWindow;
    }

    // ── Deposit ──────────────────────────────────────────────────────────────
    /// @notice Lock `p.amount` USDC. Idempotent on `p.idemKey`. Returns the
    ///         existing escrowId on a repeat (no second pull, no new escrow).
    function deposit(DepositParams calldata p) external nonReentrant returns (bytes32 escrowId) {
        bytes32 existing = idemKeyToEscrow[p.idemKey];
        if (existing != bytes32(0)) return existing;

        if (p.amount == 0) revert ZeroAmount();
        if (p.merchant == address(0)) revert ZeroMerchant();
        if (p.payoutDomain > type(uint8).max) revert DomainTooLarge(p.payoutDomain);

        address payer = msg.sender;
        escrowId = _generateEscrowId(p.merchant, p.idemKey, payer);

        // Effects before the external pull (CEI). A revert in the pull rolls all
        // of this back, so a half-written escrow can never persist.
        escrows[escrowId] = Escrow({
            payer: payer,
            merchant: p.merchant,
            amount: p.amount,
            createdAt: uint64(block.timestamp),
            payoutDomain: p.payoutDomain,
            payoutToken: p.payoutToken,
            status: Status.Escrowed
        });
        idemKeyToEscrow[p.idemKey] = escrowId;
        totalEscrowed += p.amount;

        emit Deposited(escrowId, p.invoiceRef, payer, p.merchant, p.amount, p.payoutDomain, p.payoutToken);

        USDC.safeTransferFrom(payer, address(this), p.amount);
    }

    // ── Refund (within window, USDC-only, to recorded payer) ─────────────────
    /// @notice Return the full escrowed USDC to the original payer. No redirect
    ///         parameter exists, so funds can only ever go back to `payer`.
    function refund(bytes32 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.status != Status.Escrowed) revert NotEscrowed();
        if (block.timestamp > uint256(e.createdAt) + REFUND_WINDOW) revert RefundWindowClosed();

        e.status = Status.Refunded; // effect before interaction
        uint256 amount = e.amount;
        totalEscrowed -= amount;

        USDC.safeTransfer(e.payer, amount);
        emit Refunded(escrowId, e.payer, amount);
    }

    // ── Settle (after window) — dispatch by path ─────────────────────────────
    /// @notice Pay the merchant. Only after the refund window has closed. For the
    ///         swap/bridge paths `s` carries FRESH quote/fee values.
    function settle(bytes32 escrowId, SettleParams calldata s) external nonReentrant {
        address k = keeper;
        if (k != address(0) && msg.sender != k && msg.sender != owner()) revert NotKeeper();

        Escrow storage e = escrows[escrowId];
        if (e.status != Status.Escrowed) revert NotEscrowed();
        if (block.timestamp <= uint256(e.createdAt) + REFUND_WINDOW) revert RefundWindowOpen();

        e.status = Status.Settled; // effect before interactions
        uint256 amount = e.amount;
        totalEscrowed -= amount;

        // Skim the protocol fee in USDC, here on the escrow chain, before paying
        // out or bridging. The merchant is settled on the NET amount.
        uint256 net = amount - _takeFee(escrowId, amount);

        if (e.payoutDomain == LOCAL_DOMAIN) {
            _settleSameChain(escrowId, e.merchant, e.payoutToken, net, s);
        } else {
            _settleCrossChain(escrowId, e, net, s);
        }
    }

    function _takeFee(bytes32 escrowId, uint256 amount) internal returns (uint256 fee) {
        address fr = feeRecipient;
        uint16 bps = feeBps;
        if (fr == address(0) || bps == 0) return 0;
        fee = (amount * bps) / 10_000;
        if (fee > 0) {
            USDC.safeTransfer(fr, fee);
            emit FeeTaken(escrowId, fr, fee);
        }
    }

    function _settleSameChain(
        bytes32 escrowId,
        address merchant,
        PayoutToken payoutToken,
        uint256 amount,
        SettleParams calldata s
    ) internal {
        if (payoutToken == PayoutToken.USDC) {
            USDC.safeTransfer(merchant, amount);
            emit Settled(escrowId, merchant, address(USDC), amount);
        } else {
            address tokenOut = _localTokenAddr(payoutToken);
            uint256 out = _swap(address(USDC), tokenOut, amount, s.minOut, s.swapCalldata);
            IERC20(tokenOut).safeTransfer(merchant, out);
            emit Settled(escrowId, merchant, tokenOut, out);
        }
    }

    function _settleCrossChain(bytes32 escrowId, Escrow storage e, uint256 amount, SettleParams calldata s)
        internal
    {
        if (s.minFinalityThreshold < 500) revert BadFinalityThreshold(s.minFinalityThreshold);
        bytes32 receiver = settlementReceiver[e.payoutDomain];
        if (receiver == bytes32(0)) revert NoReceiver(e.payoutDomain);

        // hookData is the trustless channel to the dest SettlementReceiver: it is
        // attested by Circle as part of the burn message. The dest contract parses
        // it back out (CCTP V2 does NOT auto-execute hooks — confirmed from source).
        bytes memory hookData = abi.encode(escrowId, e.merchant, uint8(e.payoutToken), s.minOut, e.payer);

        // Finite approval, reset to 0 immediately after (PLAN §9).
        USDC.forceApprove(address(TOKEN_MESSENGER), amount);
        TOKEN_MESSENGER.depositForBurnWithHook(
            amount,
            e.payoutDomain,
            receiver, // mintRecipient = dest SettlementReceiver
            address(USDC),
            receiver, // destinationCaller = dest SettlementReceiver (it submits receiveMessage)
            s.maxFee,
            s.minFinalityThreshold,
            hookData
        );
        USDC.forceApprove(address(TOKEN_MESSENGER), 0);

        emit BridgedForSettlement(escrowId, e.payoutDomain, receiver, amount, s.minFinalityThreshold, s.maxFee);
    }

    // ── escrowId (PLAN §3) ───────────────────────────────────────────────────
    /// @dev byte[0]=version(0x01), byte[1]=LOCAL_DOMAIN, byte[2..31]=240b entropy.
    function _generateEscrowId(address merchant, bytes32 idemKey, address payer)
        internal
        view
        returns (bytes32)
    {
        uint256 entropy = uint256(
            keccak256(
                abi.encode(merchant, idemKey, payer, block.number, block.prevrandao, block.timestamp, address(this))
            )
        );
        uint256 packed = (uint256(ESCROW_ID_VERSION) << 248) | (uint256(LOCAL_DOMAIN) << 240)
            | (entropy & ((uint256(1) << 240) - 1));
        return bytes32(packed);
    }

    // ── Same-chain Li.Fi swap (finite approval, minOut enforced) ─────────────
    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, bytes calldata swapCalldata)
        internal
        returns (uint256 out)
    {
        address router = lifiRouter;
        if (router == address(0)) revert NoSwapRouter();

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(router, amountIn);
        (bool ok, bytes memory ret) = router.call(swapCalldata);
        if (!ok) _bubbleRevert(ret);
        IERC20(tokenIn).forceApprove(router, 0);

        out = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        if (out < minOut) revert InsufficientOutput(out, minOut);
    }

    function _localTokenAddr(PayoutToken t) internal view returns (address) {
        if (t == PayoutToken.USDC) return address(USDC);
        address a = localToken[t];
        if (a == address(0)) revert TokenNotConfigured(t);
        return a;
    }

    function _bubbleRevert(bytes memory ret) private pure {
        if (ret.length == 0) revert("swap failed");
        assembly {
            revert(add(ret, 0x20), mload(ret))
        }
    }

    // ── Views ────────────────────────────────────────────────────────────────
    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }

    function escrowIdDomain(bytes32 escrowId) external pure returns (uint8) {
        return uint8(uint256(escrowId) >> 240);
    }

    // ── Owner config ─────────────────────────────────────────────────────────
    function setSettlementReceiver(uint32 domain, bytes32 receiver) external onlyOwner {
        settlementReceiver[domain] = receiver;
        emit SettlementReceiverSet(domain, receiver);
    }

    function setLocalToken(PayoutToken token, address addr) external onlyOwner {
        localToken[token] = addr;
        emit LocalTokenSet(token, addr);
    }

    function setLifiRouter(address router) external onlyOwner {
        lifiRouter = router;
        emit LifiRouterSet(router);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Set the protocol fee (basis points, ≤ 1.00%) and its recipient.
    ///         A zero recipient or zero bps disables the fee.
    function setFeeConfig(address feeRecipient_, uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        emit FeeConfigSet(feeRecipient_, feeBps_);
    }

    /// @notice Rescue stray tokens. USDC can only be rescued ABOVE `totalEscrowed`
    ///         so escrowed buyer funds can never be swept.
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(USDC)) {
            uint256 free = USDC.balanceOf(address(this)) - totalEscrowed;
            if (amount > free) revert CannotRescueEscrowedUSDC();
        }
        IERC20(token).safeTransfer(to, amount);
        emit Rescued(token, to, amount);
    }
}
