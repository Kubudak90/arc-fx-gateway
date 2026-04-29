// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IStableSwapPool } from "./interfaces/IStableSwapPool.sol";
import { IChainlinkAggregator } from "./interfaces/IChainlinkAggregator.sol";
import { PriceGuard } from "./libraries/PriceGuard.sol";

/// @title ArcFXGateway
/// @notice Merchant checkout + atomic FX settlement on Arc.
contract ArcFXGateway is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable config ───────────────────────────────────────────────
    IStableSwapPool       public immutable POOL;
    IChainlinkAggregator  public immutable ORACLE;
    IERC20                public immutable USDC;          // pool token index 0
    IERC20                public immutable EURC;          // pool token index 1
    uint8                 public immutable USDC_INDEX;
    uint8                 public immutable EURC_INDEX;
    uint256               public immutable PROTOCOL_FEE_BPS;
    uint256               public constant  MAX_ORACLE_DEVIATION_BPS = 50;

    // ── Merchant registry ──────────────────────────────────────────────
    struct Merchant {
        address payoutAddress;
        address payoutToken;
        bool    active;
    }
    mapping(address merchant => Merchant) public merchants;

    // ── Invoice state ──────────────────────────────────────────────────
    enum InvoiceStatus { None, Created, Paid }
    struct Invoice {
        address       merchant;
        address       payIn;
        address       payoutToken;   // locked at creation; merchant changes don't reroute pending invoices
        uint256       amountOut;
        uint64        expiresAt;
        InvoiceStatus status;
        address       paidBy;
    }
    mapping(bytes32 globalId => Invoice) public invoices;

    // ── Accounting ─────────────────────────────────────────────────────
    mapping(address token => uint256) public protocolFeesAccrued;

    // ── Delegate authorization ─────────────────────────────────────────
    mapping(address merchant => mapping(address delegate => uint64 expiresAt))
        public delegateAuthorizations;

    // ── Events ─────────────────────────────────────────────────────────
    event MerchantRegistered(address indexed merchant, address payoutAddress, address payoutToken);
    event MerchantPayoutAddressUpdated(address indexed merchant, address oldAddress, address newAddress);
    event MerchantPayoutTokenUpdated(address indexed merchant, address oldToken, address newToken);
    event MerchantDeactivated(address indexed merchant);
    event InvoiceCreated(
        bytes32 indexed globalId,
        address indexed merchant,
        bytes32 indexed merchantInvoiceId,
        address payIn,
        address payoutToken,
        uint256 amountOut,
        uint64 expiresAt
    );
    event InvoicePaid(
        bytes32 indexed globalId,
        address indexed payer,
        uint256 amountIn,
        uint256 grossReceived,
        uint256 merchantPayout,
        uint256 fee
    );
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);
    event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt);
    event DelegateRevoked(address indexed merchant, address indexed delegate);

    // ── Errors ─────────────────────────────────────────────────────────
    error NotMerchant();
    error MerchantAlreadyRegistered();
    error MerchantInactive();
    error InvalidPayoutToken();
    error InvalidPayoutAddress();
    error InvoiceAlreadyExists(bytes32 globalId);
    error InvoiceAlreadyPaid(bytes32 globalId);
    error InvoiceExpired(bytes32 globalId);
    error InvoiceNotFound(bytes32 globalId);
    error UnsupportedPair();
    error SlippageExceeded(uint256 required, uint256 max);
    error DelegateNotAuthorized();

    // ── Constructor ────────────────────────────────────────────────────
    constructor(
        IStableSwapPool pool,
        IChainlinkAggregator oracle,
        uint256 protocolFeeBps,
        address initialOwner
    ) Ownable(initialOwner) {
        POOL = pool;
        ORACLE = oracle;
        PROTOCOL_FEE_BPS = protocolFeeBps;
        USDC = pool.getToken(0);
        EURC = pool.getToken(1);
        USDC_INDEX = 0;
        EURC_INDEX = 1;
    }

    // ── Merchant management ────────────────────────────────────────────

    function registerMerchant(address payoutAddress, address payoutToken) external {
        if (merchants[msg.sender].active) revert MerchantAlreadyRegistered();
        if (payoutAddress == address(0)) revert InvalidPayoutAddress();
        if (payoutToken != address(USDC) && payoutToken != address(EURC)) revert InvalidPayoutToken();
        merchants[msg.sender] = Merchant({
            payoutAddress: payoutAddress,
            payoutToken:   payoutToken,
            active:        true
        });
        emit MerchantRegistered(msg.sender, payoutAddress, payoutToken);
    }

    function updatePayoutAddress(address newPayoutAddress) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        if (newPayoutAddress == address(0)) revert InvalidPayoutAddress();
        address old = m.payoutAddress;
        m.payoutAddress = newPayoutAddress;
        emit MerchantPayoutAddressUpdated(msg.sender, old, newPayoutAddress);
    }

    function updatePayoutToken(address newPayoutToken) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        if (newPayoutToken != address(USDC) && newPayoutToken != address(EURC)) revert InvalidPayoutToken();
        address old = m.payoutToken;
        m.payoutToken = newPayoutToken;
        emit MerchantPayoutTokenUpdated(msg.sender, old, newPayoutToken);
    }

    function deactivateMerchant() external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        m.active = false;
        emit MerchantDeactivated(msg.sender);
    }

    // ── Invoice creation ───────────────────────────────────────────────

    function createInvoice(
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64 expiresAt
    ) external returns (bytes32 globalId) {
        return _createInvoice(msg.sender, merchantInvoiceId, payIn, amountOut, expiresAt);
    }

    function createInvoiceFor(
        address merchant,
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64 expiresAt
    ) external returns (bytes32 globalId) {
        uint64 authExpiry = delegateAuthorizations[merchant][msg.sender];
        if (authExpiry < block.timestamp) revert DelegateNotAuthorized();
        return _createInvoice(merchant, merchantInvoiceId, payIn, amountOut, expiresAt);
    }

    function _createInvoice(
        address merchant,
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64 expiresAt
    ) internal returns (bytes32 globalId) {
        Merchant memory m = merchants[merchant];
        if (!m.active) revert MerchantInactive();
        if (payIn != address(USDC) && payIn != address(EURC)) revert UnsupportedPair();

        globalId = keccak256(abi.encode(merchant, merchantInvoiceId));
        if (invoices[globalId].status != InvoiceStatus.None) revert InvoiceAlreadyExists(globalId);

        invoices[globalId] = Invoice({
            merchant:    merchant,
            payIn:       payIn,
            payoutToken: m.payoutToken,
            amountOut:   amountOut,
            expiresAt:   expiresAt,
            status:      InvoiceStatus.Created,
            paidBy:      address(0)
        });
        emit InvoiceCreated(globalId, merchant, merchantInvoiceId, payIn, m.payoutToken, amountOut, expiresAt);
    }

    // ── Pay ────────────────────────────────────────────────────────────

    function pay(bytes32 globalId, uint256 maxAmountIn) external nonReentrant {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None) revert InvoiceNotFound(globalId);
        if (inv.status == InvoiceStatus.Paid) revert InvoiceAlreadyPaid(globalId);
        if (block.timestamp > inv.expiresAt)  revert InvoiceExpired(globalId);

        address payoutToken    = inv.payoutToken;
        address payoutAddress  = merchants[inv.merchant].payoutAddress;

        // Same-token direct path: no swap, no oracle deviation check needed.
        if (inv.payIn == payoutToken) {
            if (inv.amountOut > maxAmountIn) revert SlippageExceeded(inv.amountOut, maxAmountIn);

            IERC20(inv.payIn).safeTransferFrom(msg.sender, address(this), inv.amountOut);

            uint256 directFee    = (inv.amountOut * PROTOCOL_FEE_BPS) / 10_000;
            uint256 directPayout = inv.amountOut - directFee;
            protocolFeesAccrued[payoutToken] += directFee;

            inv.status = InvoiceStatus.Paid;
            inv.paidBy = msg.sender;

            IERC20(payoutToken).safeTransfer(payoutAddress, directPayout);
            emit InvoicePaid(globalId, msg.sender, inv.amountOut, inv.amountOut, directPayout, directFee);
            return;
        }

        // Swap path
        uint8 iIn  = inv.payIn   == address(USDC) ? USDC_INDEX : EURC_INDEX;
        uint8 jOut = payoutToken == address(USDC) ? USDC_INDEX : EURC_INDEX;

        uint256 amountIn = _estimateAmountIn(iIn, jOut, inv.amountOut);
        if (amountIn > maxAmountIn) revert SlippageExceeded(amountIn, maxAmountIn);

        IERC20(inv.payIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(inv.payIn).forceApprove(address(POOL), amountIn);
        uint256 received = POOL.swap(iIn, jOut, amountIn, inv.amountOut, block.timestamp + 1);

        // Pool-implied rate (quote per 1 base, 1e18-scaled), for oracle deviation guard.
        uint256 rateForCheck;
        if (iIn == EURC_INDEX) {
            rateForCheck = (received * 1e18) / amountIn;
        } else {
            rateForCheck = (amountIn * 1e18) / received;
        }
        PriceGuard.check(rateForCheck, ORACLE, MAX_ORACLE_DEVIATION_BPS);

        uint256 swapFee    = (received * PROTOCOL_FEE_BPS) / 10_000;
        uint256 swapPayout = received - swapFee;
        protocolFeesAccrued[payoutToken] += swapFee;

        inv.status = InvoiceStatus.Paid;
        inv.paidBy = msg.sender;

        IERC20(payoutToken).safeTransfer(payoutAddress, swapPayout);
        emit InvoicePaid(globalId, msg.sender, amountIn, received, swapPayout, swapFee);
    }

    /// @dev Inverts the pool's forward swap quote to find the smallest input
    /// that produces at least `amountOut`. The pool's `calculateSwap` is
    /// monotone-non-decreasing but not strictly proportional under integer
    /// rounding, so a pure linear inverse can fall a wei or two short. We seed
    /// with the linear ceiling, then walk forward 1 wei at a time until the
    /// quoted output meets the target. Bounded so a degenerate pool can never
    /// freeze pay() — if the loop bails out, the swap call downstream reverts
    /// cleanly with `InsufficientOutput`.
    uint256 private constant ESTIMATE_MAX_STEPS = 8;

    function _estimateAmountIn(uint8 iIn, uint8 jOut, uint256 amountOut) internal view returns (uint256 amountIn) {
        uint256 probeIn  = 1e6;
        uint256 probeOut = POOL.calculateSwap(iIn, jOut, probeIn);
        if (probeOut == 0) return type(uint256).max;

        amountIn = (amountOut * probeIn + probeOut - 1) / probeOut;

        for (uint256 i = 0; i < ESTIMATE_MAX_STEPS; i++) {
            if (POOL.calculateSwap(iIn, jOut, amountIn) >= amountOut) return amountIn;
            unchecked { amountIn++; }
        }
    }

    function withdrawFees(address token, address to) external onlyOwner {
        uint256 amount = protocolFeesAccrued[token];
        protocolFeesAccrued[token] = 0;
        IERC20(token).safeTransfer(to, amount);
        emit FeesWithdrawn(token, to, amount);
    }

    // ── Delegate authorization ─────────────────────────────────────────

    function authorizeDelegate(address delegate, uint64 expiresAt) external {
        if (!merchants[msg.sender].active) revert NotMerchant();
        delegateAuthorizations[msg.sender][delegate] = expiresAt;
        emit DelegateAuthorized(msg.sender, delegate, expiresAt);
    }

    function revokeDelegate(address delegate) external {
        delegateAuthorizations[msg.sender][delegate] = 0;
        emit DelegateRevoked(msg.sender, delegate);
    }
}
