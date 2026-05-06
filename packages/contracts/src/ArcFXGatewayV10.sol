// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl }     from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable }          from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ArcFXGatewayV10
/// @notice Custody gateway. Settled funds are held in per-invoice escrow;
///         refunds within the 7-day window pull from escrow (no allowance);
///         after the window, anyone may call claim() to push the merchant
///         leg out (fee accrued at claim, NOT at settle); deactivated
///         merchants' escrow becomes admin-recoverable after a further
///         7 days. Closes audit residuals H4 (custody), M3 (fee bound),
///         M4 (reactivate semantics), L2 (nonReentrant on PayerRefund).
contract ArcFXGatewayV10 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    uint8   public constant RIGHT_CREATE_INVOICE = 1 << 0;
    uint8   public constant RIGHT_REFUND         = 1 << 1;

    uint256 public immutable PROTOCOL_FEE_BPS;
    uint64  public immutable REFUND_WINDOW;
    uint64  public immutable ADMIN_RECOVERY_DELAY;

    mapping(address token    => bool)     public supportedTokens;

    struct Merchant { address payoutAddress; address payoutToken; bool active; }
    mapping(address merchant => Merchant) public merchants;

    enum InvoiceStatus { None, Created, Paid, Refunded, Failed, Claimed, Recovered }
    struct Invoice {
        address       merchant;
        address       payIn;
        address       payoutToken;
        uint256       amountOut;
        uint64        expiresAt;
        InvoiceStatus status;
        address       paidBy;
    }
    mapping(bytes32 globalId => Invoice) public invoices;

    struct Escrow { uint256 amount; address payoutToken; uint64 claimableAt; }
    mapping(bytes32 globalId => Escrow) public escrows;

    mapping(address token    => uint256) public protocolFeesAccrued;

    struct DelegateAuth { uint64 expiresAt; uint8 rights; }
    mapping(address merchant => mapping(address delegate => DelegateAuth)) public delegates;

    // Events / errors / functions filled in by subsequent tasks.

    constructor(
        uint256 protocolFeeBps,
        uint64  refundWindow,
        uint64  adminRecoveryDelay,
        address initialOwner,
        address initialRelayer
    ) {
        PROTOCOL_FEE_BPS     = protocolFeeBps;
        REFUND_WINDOW        = refundWindow;
        ADMIN_RECOVERY_DELAY = adminRecoveryDelay;
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(RELAYER_ROLE,       initialRelayer);
    }
}
