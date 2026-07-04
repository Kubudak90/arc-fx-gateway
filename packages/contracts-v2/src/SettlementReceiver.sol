// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "./interfaces/IMessageTransmitterV2.sol";
import {CCTPMessageV2} from "./libraries/CCTPMessageV2.sol";

/// @title SettlementReceiver
/// @notice Destination-side of the cross-chain settlement (PLAN §4.2).
///
/// @dev CCTP V2 does NOT auto-execute hooks (verified from source: the message
///      recipient is the canonical destination TokenMessengerV2, which mints to
///      `mintRecipient` and ignores hookData). So instead of relying on a
///      protocol callback, THIS contract is set as both `mintRecipient` AND
///      `destinationCaller` by the source escrow. The relayer calls
///      `receiveAndSettle`, which itself calls the canonical
///      `MessageTransmitter.receiveMessage` — minting USDC to this contract via
///      the normal protocol path (no minter registration needed) — then parses
///      the attested hookData and pays out, all atomically in one transaction.
///
///      Trustless binding: hookData is attested by Circle as part of the burn
///      message, and we additionally require the message's `messageSender` to be
///      the registered PaymentEscrow for that source domain, so only our own
///      escrows can drive a payout.
contract SettlementReceiver is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using CCTPMessageV2 for bytes;

    // Mirrors PaymentEscrow.PayoutToken; only the uint8 value crosses the wire.
    enum PayoutToken {
        USDC,
        EURC,
        USDT
    }

    struct FailedPayout {
        address payer; // recover destination is the source chain (escrowId byte[1])
        uint256 amount; // USDC parked after a failed merchant transfer
    }

    struct Pending {
        address merchant;
        PayoutToken payoutToken;
        uint256 amount; // USDC awaiting the deferred token swap
        uint256 minFloor; // hook-carried minOut floor for the swap
    }

    // ── Immutables ───────────────────────────────────────────────────────────
    uint32 public immutable LOCAL_DOMAIN;
    IERC20 public immutable USDC;
    IMessageTransmitterV2 public immutable MESSAGE_TRANSMITTER;
    ITokenMessengerV2 public immutable TOKEN_MESSENGER; // for recoverToBuyer

    // ── Config (owner) ───────────────────────────────────────────────────────
    /// source CCTP domain → trusted PaymentEscrow (bytes32, CCTP-padded address).
    mapping(uint32 => bytes32) public trustedEscrow;
    mapping(PayoutToken => address) public localToken; // EURC/USDT on THIS chain
    address public lifiRouter;
    address public keeper; // if set, only keeper/owner may call settle/recover

    // ── Storage ──────────────────────────────────────────────────────────────
    mapping(bytes32 => bool) public processed; // escrowId → received once
    mapping(bytes32 => FailedPayout) public failedPayout; // Path B failures
    mapping(bytes32 => Pending) public pending; // Path C awaiting settle
    /// USDC owed to merchants/payers (parked + pending). Invariant: balance ≥ this.
    uint256 public parkedUSDC;

    // ── Events ───────────────────────────────────────────────────────────────
    event Settled(bytes32 indexed escrowId, address indexed merchant, address token, uint256 amount);
    event PayoutFailed(bytes32 indexed escrowId, address indexed payer, uint256 amount);
    event PendingSettle(bytes32 indexed escrowId, address indexed merchant, uint8 payoutToken, uint256 amount);
    event SettledFallbackUSDC(bytes32 indexed escrowId, address indexed merchant, uint256 amount);
    event RecoveredToBuyer(bytes32 indexed escrowId, address indexed payer, uint32 sourceDomain, uint256 amount);
    event TrustedEscrowSet(uint32 indexed domain, bytes32 escrow);
    event LocalTokenSet(PayoutToken indexed token, address addr);
    event LifiRouterSet(address router);
    event KeeperSet(address keeper);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    // ── Errors ───────────────────────────────────────────────────────────────
    error ReceiveFailed();
    error NotMintRecipient();
    error UntrustedSender(uint32 sourceDomain, bytes32 sender);
    error AlreadyProcessed(bytes32 escrowId);
    error NotKeeper();
    error NothingPending(bytes32 escrowId);
    error NothingFailed(bytes32 escrowId);
    error TokenNotConfigured(PayoutToken token);
    error NoSwapRouter();
    error InsufficientOutput(uint256 got, uint256 minOut);
    error CannotRescueOwedUSDC();

    constructor(
        uint32 localDomain,
        address usdc,
        address messageTransmitter,
        address tokenMessenger,
        address owner_
    ) Ownable(owner_) {
        LOCAL_DOMAIN = localDomain;
        USDC = IERC20(usdc);
        MESSAGE_TRANSMITTER = IMessageTransmitterV2(messageTransmitter);
        TOKEN_MESSENGER = ITokenMessengerV2(tokenMessenger);
    }

    modifier onlyKeeper() {
        address k = keeper;
        if (k != address(0) && msg.sender != k && msg.sender != owner()) revert NotKeeper();
        _;
    }

    // ── Receive + settle (atomic with the mint) ──────────────────────────────
    /// @notice Submit the attested CCTP message. This calls `receiveMessage`
    ///         (minting USDC to this contract), then pays the merchant (Path B)
    ///         or records the pending swap (Path C). NEVER reverts on a merchant
    ///         payout failure — the burned source funds must always land.
    function receiveAndSettle(bytes calldata message, bytes calldata attestation) external nonReentrant {
        message.validate();

        uint256 balBefore = USDC.balanceOf(address(this));
        bool ok = MESSAGE_TRANSMITTER.receiveMessage(message, attestation);
        if (!ok) revert ReceiveFailed();
        uint256 received = USDC.balanceOf(address(this)) - balBefore;

        // We must be the mintRecipient (sanity) and the burn must come from our
        // own escrow on the source domain (trustless authorization).
        if (message.mintRecipient() != _toBytes32(address(this))) revert NotMintRecipient();
        uint32 src = message.sourceDomain();
        bytes32 sender = message.messageSender();
        bytes32 trusted = trustedEscrow[src];
        if (trusted == bytes32(0) || sender != trusted) revert UntrustedSender(src, sender);

        (bytes32 escrowId, address merchant, uint8 payoutToken, uint256 minFloor, address payer) =
            abi.decode(message.hookData(), (bytes32, address, uint8, uint256, address));

        if (processed[escrowId]) revert AlreadyProcessed(escrowId);
        processed[escrowId] = true;

        if (payoutToken == uint8(PayoutToken.USDC)) {
            // Path B — pay the merchant now via a low-level transfer so a frozen
            // (blacklisted) merchant cannot brick the mint.
            if (_tryTransfer(address(USDC), merchant, received)) {
                emit Settled(escrowId, merchant, address(USDC), received);
            } else {
                failedPayout[escrowId] = FailedPayout({payer: payer, amount: received});
                parkedUSDC += received;
                emit PayoutFailed(escrowId, payer, received);
            }
        } else {
            // Path C — do NOT swap here (quote would be stale); record for settle.
            pending[escrowId] =
                Pending({merchant: merchant, payoutToken: PayoutToken(payoutToken), amount: received, minFloor: minFloor});
            parkedUSDC += received;
            emit PendingSettle(escrowId, merchant, payoutToken, received);
        }
    }

    // ── Path C deferred settle (fresh Li.Fi quote) ───────────────────────────
    /// @notice Swap the pending USDC into the merchant's token with a FRESH quote.
    ///         Pass empty `swapCalldata` to signal "no viable route" → USDC fallback.
    function settle(bytes32 escrowId, bytes calldata swapCalldata, uint256 minOut)
        external
        nonReentrant
        onlyKeeper
    {
        Pending memory p = pending[escrowId];
        if (p.amount == 0) revert NothingPending(escrowId);

        delete pending[escrowId]; // effect before interactions
        parkedUSDC -= p.amount;

        if (swapCalldata.length == 0) {
            // Fallback: thin token liquidity ⇒ pay the merchant in USDC.
            USDC.safeTransfer(p.merchant, p.amount);
            emit SettledFallbackUSDC(escrowId, p.merchant, p.amount);
            return;
        }

        uint256 floor = minOut > p.minFloor ? minOut : p.minFloor;
        address tokenOut = _localTokenAddr(p.payoutToken);
        uint256 out = _swap(address(USDC), tokenOut, p.amount, floor, swapCalldata);
        IERC20(tokenOut).safeTransfer(p.merchant, out);
        emit Settled(escrowId, p.merchant, tokenOut, out);
    }

    // ── Path B failure recovery (decision 9) ─────────────────────────────────
    /// @notice CCTP-burn a parked (failed) payout back to the buyer on the source
    ///         chain. The source domain is read from escrowId byte[1] — trustless.
    function recoverToBuyer(bytes32 escrowId, uint256 maxFee, uint32 minFinalityThreshold)
        external
        nonReentrant
        onlyKeeper
    {
        FailedPayout memory f = failedPayout[escrowId];
        if (f.amount == 0) revert NothingFailed(escrowId);

        delete failedPayout[escrowId]; // effect before interaction (rolls back on revert ⇒ retryable)
        parkedUSDC -= f.amount;

        uint32 srcDomain = uint8(uint256(escrowId) >> 240); // escrowId byte[1]

        USDC.forceApprove(address(TOKEN_MESSENGER), f.amount);
        TOKEN_MESSENGER.depositForBurn(
            f.amount,
            srcDomain,
            _toBytes32(f.payer), // mintRecipient = buyer on source chain
            address(USDC),
            bytes32(0), // anyone may relay the recovery mint
            maxFee,
            minFinalityThreshold
        );
        USDC.forceApprove(address(TOKEN_MESSENGER), 0);

        emit RecoveredToBuyer(escrowId, f.payer, srcDomain, f.amount);
    }

    // ── Internals ─────────────────────────────────────────────────────────────
    function _tryTransfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }

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

    function _toBytes32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _bubbleRevert(bytes memory ret) private pure {
        if (ret.length == 0) revert("swap failed");
        assembly {
            revert(add(ret, 0x20), mload(ret))
        }
    }

    // ── Owner config ─────────────────────────────────────────────────────────
    function setTrustedEscrow(uint32 domain, bytes32 escrow) external onlyOwner {
        trustedEscrow[domain] = escrow;
        emit TrustedEscrowSet(domain, escrow);
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

    /// @notice Rescue stray tokens. USDC only above `parkedUSDC`, so funds owed to
    ///         merchants/buyers can never be swept.
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(USDC)) {
            uint256 free = USDC.balanceOf(address(this)) - parkedUSDC;
            if (amount > free) revert CannotRescueOwedUSDC();
        }
        IERC20(token).safeTransfer(to, amount);
        emit Rescued(token, to, amount);
    }
}
