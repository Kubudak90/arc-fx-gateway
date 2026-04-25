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
/// @notice Atomic swap-and-settle for merchant invoices on Arc.
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
        address payoutToken;
        bool    registered;
    }
    mapping(address merchant => Merchant) public merchants;

    // ── Invoice state ──────────────────────────────────────────────────
    enum InvoiceStatus { None, Created, Paid, Expired }
    struct Invoice {
        address       merchant;
        address       payIn;
        uint256       amountOut;
        uint64        expiresAt;
        InvoiceStatus status;
        address       paidBy;
    }
    mapping(bytes32 id => Invoice) public invoices;

    // ── Accounting ─────────────────────────────────────────────────────
    mapping(address token => uint256) public protocolFeesAccrued;

    // ── Events ─────────────────────────────────────────────────────────
    event MerchantRegistered(address indexed merchant, address payoutToken);
    event InvoiceCreated(bytes32 indexed id, address indexed merchant, address payIn, uint256 amountOut, uint64 expiresAt);
    event InvoicePaid(bytes32 indexed id, address indexed payer, uint256 amountIn, uint256 amountOut, uint256 fee);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

    // ── Errors ─────────────────────────────────────────────────────────
    error NotMerchant();
    error MerchantAlreadyRegistered();
    error InvalidPayoutToken();
    error InvoiceAlreadyExists(bytes32 id);
    error InvoiceAlreadyPaid(bytes32 id);
    error InvoiceExpired(bytes32 id);
    error InvoiceNotFound(bytes32 id);
    error UnsupportedPair();
    error SlippageExceeded(uint256 required, uint256 max);

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

    function registerMerchant(address payoutToken) external {
        if (merchants[msg.sender].registered) revert MerchantAlreadyRegistered();
        if (payoutToken != address(USDC) && payoutToken != address(EURC)) revert InvalidPayoutToken();
        merchants[msg.sender] = Merchant({ payoutToken: payoutToken, registered: true });
        emit MerchantRegistered(msg.sender, payoutToken);
    }
    function createInvoice(
        bytes32 id,
        address payIn,
        uint256 amountOut,
        uint64 expiresAt
    ) external {
        Merchant memory m = merchants[msg.sender];
        if (!m.registered) revert NotMerchant();
        if (payIn == m.payoutToken) revert UnsupportedPair();
        if (payIn != address(USDC) && payIn != address(EURC)) revert UnsupportedPair();
        if (invoices[id].status != InvoiceStatus.None) revert InvoiceAlreadyExists(id);

        invoices[id] = Invoice({
            merchant:  msg.sender,
            payIn:     payIn,
            amountOut: amountOut,
            expiresAt: expiresAt,
            status:    InvoiceStatus.Created,
            paidBy:    address(0)
        });
        emit InvoiceCreated(id, msg.sender, payIn, amountOut, expiresAt);
    }
    function pay(bytes32 id, uint256 maxAmountIn) external nonReentrant {
        Invoice storage inv = invoices[id];
        if (inv.status == InvoiceStatus.None)  revert InvoiceNotFound(id);
        if (inv.status == InvoiceStatus.Paid)  revert InvoiceAlreadyPaid(id);
        if (block.timestamp > inv.expiresAt)   revert InvoiceExpired(id);

        address payoutToken = merchants[inv.merchant].payoutToken;

        uint8 iIn  = inv.payIn   == address(USDC) ? USDC_INDEX : EURC_INDEX;
        uint8 jOut = payoutToken == address(USDC) ? USDC_INDEX : EURC_INDEX;

        uint256 amountIn = _estimateAmountIn(iIn, jOut, inv.amountOut);
        if (amountIn > maxAmountIn) revert SlippageExceeded(amountIn, maxAmountIn);

        IERC20(inv.payIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(inv.payIn).forceApprove(address(POOL), amountIn);
        uint256 received = POOL.swap(iIn, jOut, amountIn, inv.amountOut, block.timestamp + 1);

        // Pool-implied rate (quote per 1 base, 1e18-scaled), for oracle deviation guard.
        // EURC→USDC: poolRate = received_usdc/amountIn_eurc, expressed in 1e18.
        // USDC→EURC: invert to compare against EUR/USD oracle.
        uint256 rateForCheck;
        if (iIn == EURC_INDEX) {
            rateForCheck = (received * 1e18) / amountIn;
        } else {
            rateForCheck = (amountIn * 1e18) / received;
        }
        PriceGuard.check(rateForCheck, ORACLE, MAX_ORACLE_DEVIATION_BPS);

        uint256 fee = (received * PROTOCOL_FEE_BPS) / 10_000;
        uint256 payout = received - fee;
        protocolFeesAccrued[payoutToken] += fee;

        inv.status = InvoiceStatus.Paid;
        inv.paidBy = msg.sender;

        IERC20(payoutToken).safeTransfer(inv.merchant, payout);
        emit InvoicePaid(id, msg.sender, amountIn, payout, fee);
    }

    function _estimateAmountIn(uint8 iIn, uint8 jOut, uint256 amountOut) internal view returns (uint256) {
        uint256 probeIn = 1e6;
        uint256 probeOut = POOL.calculateSwap(iIn, jOut, probeIn);
        if (probeOut == 0) return type(uint256).max;
        return (amountOut * probeIn + probeOut - 1) / probeOut;
    }
    function withdrawFees(address token, address to) external onlyOwner { revert(); }
}
