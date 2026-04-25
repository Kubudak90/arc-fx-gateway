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
    function createInvoice(bytes32 id, address payIn, uint256 amountOut, uint64 expiresAt) external { revert(); }
    function pay(bytes32 id, uint256 maxAmountIn) external nonReentrant { revert(); }
    function withdrawFees(address token, address to) external onlyOwner { revert(); }
}
