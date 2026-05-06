// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl }     from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable }          from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ArcFXGatewayV9
/// @notice v0.9 — refund source binding. Identical to v0.8 except that the
///         per-invoice `InvoicePayment` record snapshots the actual payout
///         wallet at settle time, and `refundInvoice` pulls funds back from
///         that snapshotted address rather than the merchant identity wallet.
///
///         v0.8 background: settle delivered funds to
///         `merchants[m].payoutAddress` but refund pulled from `inv.merchant`.
///         When those wallets differ (legitimate B2B model), refunds broke.
///         The audit dated 2026-05-03 flagged this as P1; Plan 9 specifies
///         the contract-level fix that V9 implements.
///
///         Off-chain surfaces (relayer, indexer, app, webhook) are
///         binary-compatible with V8 — same event signatures, same external
///         function shapes — so the only client-side change for v0.9 is
///         pointing at the new gateway address.
contract ArcFXGatewayV9 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Protocol fee on the gross payout, in basis points (1 = 0.01%).
    /// Locked at deploy; deploy a new contract to change.
    uint256 public immutable PROTOCOL_FEE_BPS;

    // ── Token whitelist ────────────────────────────────────────────────
    /// @notice Tokens accepted as pay-in or payout. Owner-managed.
    mapping(address token => bool) public supportedTokens;

    // ── Merchant registry ──────────────────────────────────────────────
    struct Merchant {
        address payoutAddress;
        address payoutToken;
        bool    active;
    }
    mapping(address merchant => Merchant) public merchants;

    // ── Invoice state ──────────────────────────────────────────────────
    enum InvoiceStatus { None, Created, Paid, Refunded, Failed }
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

    // ── Payment accounting (for refunds) ───────────────────────────────
    /// @dev v0.9 adds `payoutSource` — the actual address that received the
    /// merchant payout at settle time. `refundInvoice` pulls back from there.
    /// In v0.8 this was implicitly `inv.merchant`, which broke split-wallet
    /// merchants.
    struct InvoicePayment {
        uint256 merchantPayout;
        uint256 fee;
        address payoutSource;
    }
    mapping(bytes32 globalId => InvoicePayment) public payments;

    // ── Accounting ─────────────────────────────────────────────────────
    mapping(address token => uint256) public protocolFeesAccrued;

    // ── Delegate authorization ─────────────────────────────────────────
    mapping(address merchant => mapping(address delegate => uint64 expiresAt))
        public delegateAuthorizations;

    // ── Events ─────────────────────────────────────────────────────────
    event TokenSupportUpdated(address indexed token, bool active);
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
    /// @dev Same surface as v0.6/v0.7/v0.8 so indexer + webhook payloads stay binary-compatible.
    event InvoicePaid(
        bytes32 indexed globalId,
        address indexed payer,
        uint256 amountIn,
        uint256 grossReceived,
        uint256 merchantPayout,
        uint256 fee
    );
    /// @dev Carried over from v0.8: stitches the on-chain settle to the
    /// off-chain `kit.swap` tx for the indexer.
    event SettlementContext(
        bytes32 indexed globalId,
        address indexed payInToken,
        bytes32 swapTxHash
    );
    /// @dev v0.9-only: explicit record of the address that received the
    /// merchant payout. Indexer can index this for forensic clarity instead
    /// of having to read storage.
    event SettlementSource(
        bytes32 indexed globalId,
        address indexed payoutSource
    );
    /// @dev Carried over from v0.8: relayer reports it has refunded the
    /// customer off-chain after a failed swap.
    event PayerRefunded(
        bytes32 indexed globalId,
        address indexed payer,
        address payInToken,
        uint256 amount,
        bytes32 reasonHash
    );
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);
    event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt);
    event DelegateRevoked(address indexed merchant, address indexed delegate);
    event InvoiceRefunded(
        bytes32 indexed globalId,
        address indexed refundedTo,
        address indexed payoutToken,
        uint256 merchantPayout,
        uint256 protocolFeeReturned
    );

    // ── Errors ─────────────────────────────────────────────────────────
    error NotMerchant();
    error MerchantAlreadyRegistered();
    error MerchantInactive();
    error InvalidPayoutToken();
    error InvalidPayoutAddress();
    error InvalidPayInToken();
    error InvoiceAlreadyExists(bytes32 globalId);
    error InvoiceAlreadyPaid(bytes32 globalId);
    error InvoiceExpired(bytes32 globalId);
    error InvoiceNotFound(bytes32 globalId);
    error InvoiceNotInCreatedState(bytes32 globalId);
    error PayoutShortfall(uint256 supplied, uint256 required);
    error DelegateNotAuthorized();
    error InvoiceNotRefundable(bytes32 globalId);
    error InsufficientFeesForRefund(uint256 required, uint256 accrued);

    // ── Constructor ────────────────────────────────────────────────────

    /// @notice Deploy the gateway with an initial admin + relayer pair and a fixed protocol fee.
    /// @param protocolFeeBps fee in basis points (1 = 0.01%) charged on every settled invoice's gross payout
    /// @param initialOwner   address granted `DEFAULT_ADMIN_ROLE` (manages tokens, pause, withdraw fees, role rotation)
    /// @param initialRelayer address granted `RELAYER_ROLE` (calls `settleInvoice` and `recordPayerRefund`)
    ///
    /// @dev WARNING (audit M3, 2026-05-06): This constructor does NOT enforce an upper bound on
    ///      `protocolFeeBps`. A misconfigured deploy with feeBps > 10000 (100%) would allow the
    ///      fee to exceed or equal the gross payout, leading to a payout of zero or an underflow.
    ///      V9 is immutable on-chain; the in-constructor cap will be added to V10.
    ///      Off-chain mitigation: `DeployV9.s.sol` enforces `require(feeBps <= 1000)` before
    ///      `vm.startBroadcast`. Do NOT bypass this guard when deploying additional V9 instances.
    constructor(
        uint256 protocolFeeBps,
        address initialOwner,
        address initialRelayer
    ) {
        if (initialOwner == address(0))   revert InvalidPayoutAddress();
        if (initialRelayer == address(0)) revert InvalidPayoutAddress();
        PROTOCOL_FEE_BPS = protocolFeeBps;
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(RELAYER_ROLE,       initialRelayer);
    }

    // ── Token whitelist (admin) ────────────────────────────────────────

    /// @notice Add or remove a token from the supported set.
    function setTokenSupport(address token, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedTokens[token] = active;
        emit TokenSupportUpdated(token, active);
    }

    // ── Pause (admin) ──────────────────────────────────────────────────

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Merchant management ────────────────────────────────────────────

    function registerMerchant(address payoutAddress, address payoutToken) external {
        if (merchants[msg.sender].active) revert MerchantAlreadyRegistered();
        if (payoutAddress == address(0))  revert InvalidPayoutAddress();
        if (!supportedTokens[payoutToken]) revert InvalidPayoutToken();
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
        if (!supportedTokens[newPayoutToken]) revert InvalidPayoutToken();
        address old = m.payoutToken;
        m.payoutToken = newPayoutToken;
        emit MerchantPayoutTokenUpdated(msg.sender, old, newPayoutToken);
    }

    /// @notice Mark the caller's merchant account as inactive.
    /// @dev Audit M4 (2026-05-06): deactivation sets `active = false` but does
    ///      NOT permanently ban re-registration. A deactivated merchant may call
    ///      `registerMerchant` again, which checks only `merchants[msg.sender].active`
    ///      and will succeed, overwriting the previous Merchant struct with the new
    ///      payout address and token. If permanent offboarding is required, use an
    ///      admin-level blocklist (planned for V10's `reactivateMerchant` / explicit
    ///      re-register flow). Callers should NOT assume deactivation is irrevocable.
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
    ) internal whenNotPaused returns (bytes32 globalId) {
        Merchant memory m = merchants[merchant];
        if (!m.active)              revert MerchantInactive();
        if (!supportedTokens[payIn]) revert InvalidPayInToken();

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

    // ── Settlement (relayer-only) ──────────────────────────────────────

    /// @notice Called by the Arcora relayer once `kit.swap` has produced
    /// `grossPayout` of the invoice's `payoutToken`. The relayer must have
    /// approved this gateway to pull `grossPayout` of `payoutToken` first.
    /// The gateway then forwards `grossPayout - fee` to the merchant and
    /// accrues `fee` for later admin withdrawal.
    /// @dev v0.9: snapshots `payoutAddress` into `payments[globalId].payoutSource`
    /// so `refundInvoice` knows where the funds actually live. Emits an
    /// extra `SettlementSource` event for indexer-side auditability.
    function settleInvoice(
        bytes32 globalId,
        address payer,
        address payInToken,
        uint256 amountIn,
        uint256 grossPayout,
        bytes32 swapTxHash
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None) revert InvoiceNotFound(globalId);
        if (inv.status != InvoiceStatus.Created) revert InvoiceAlreadyPaid(globalId);
        if (block.timestamp > inv.expiresAt) revert InvoiceExpired(globalId);
        if (grossPayout < inv.amountOut)
            revert PayoutShortfall(grossPayout, inv.amountOut);

        address payoutToken    = inv.payoutToken;
        address payoutAddress  = merchants[inv.merchant].payoutAddress;

        IERC20(payoutToken).safeTransferFrom(msg.sender, address(this), grossPayout);

        uint256 fee        = (inv.amountOut * PROTOCOL_FEE_BPS) / 10_000;
        uint256 toMerchant = inv.amountOut - fee;
        uint256 excess     = grossPayout - inv.amountOut;
        protocolFeesAccrued[payoutToken] += fee + excess;

        inv.status = InvoiceStatus.Paid;
        inv.paidBy = payer;
        payments[globalId] = InvoicePayment({
            merchantPayout: toMerchant,
            fee:            fee,
            payoutSource:   payoutAddress
        });

        IERC20(payoutToken).safeTransfer(payoutAddress, toMerchant);

        emit InvoicePaid(globalId, payer, amountIn, grossPayout, toMerchant, fee);
        emit SettlementContext(globalId, payInToken, swapTxHash);
        emit SettlementSource(globalId, payoutAddress);
    }

    /// @notice Called by the relayer when `kit.swap` failed and the customer
    /// has been refunded their pay-in off-chain.
    /// @dev `nonReentrant` is defensive hardening (no external call inside this
    /// function body, so reentrancy is not currently exploitable). Adding it
    /// costs ~2 300 gas and prevents silent regressions if a future diff
    /// inadvertently introduces an external call. Audit L2 (2026-05-06).
    /// Note: V9 is already deployed on-chain as an immutable contract; this
    /// modifier addition applies to V10+ redeployments only.
    function recordPayerRefund(
        bytes32 globalId,
        address payer,
        address payInToken,
        uint256 amount,
        bytes32 reasonHash
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None) revert InvoiceNotFound(globalId);
        if (inv.status != InvoiceStatus.Created) revert InvoiceNotInCreatedState(globalId);

        inv.status = InvoiceStatus.Failed;
        emit PayerRefunded(globalId, payer, payInToken, amount, reasonHash);
    }

    // ── Refund (merchant-driven) ───────────────────────────────────────

    /// @notice Refund a paid invoice. v0.9 pulls the merchant payout back
    /// from the address that *actually* received it at settle time
    /// (`p.payoutSource`), not from the merchant identity wallet. This
    /// fixes the v0.8 bug where split-wallet merchants couldn't refund.
    ///
    /// Auth: any of the merchant identity, the payout source (the wallet
    /// that holds the funds), or admin can call. The expanded auth means
    /// merchants who use a slow multisig as their identity but a hot
    /// operational wallet as their payout can push refunds without round-
    /// tripping the multisig.
    ///
    /// The protocol fee leg returns to `inv.merchant` — preserving v0.8
    /// semantics where the merchant identity is the protocol-economics
    /// anchor regardless of where the operational payout lives.
    ///
    /// @dev Intentionally omits `whenNotPaused`. Refunds must remain
    /// callable even when the protocol is paused — a pause is an emergency
    /// measure to halt *new* payments, but it would be punitive to
    /// simultaneously freeze already-committed customer refunds. Audit L1
    /// reviewed and accepted this design on 2026-05-06.
    function refundInvoice(bytes32 globalId) external nonReentrant {
        Invoice storage inv = invoices[globalId];
        if (inv.status != InvoiceStatus.Paid) revert InvoiceNotRefundable(globalId);

        InvoicePayment memory p = payments[globalId];

        if (msg.sender != inv.merchant
            && msg.sender != p.payoutSource
            && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotMerchant();
        }

        address payoutToken = inv.payoutToken;
        address refundTo    = inv.paidBy;
        address merchant    = inv.merchant;

        if (protocolFeesAccrued[payoutToken] < p.fee) {
            revert InsufficientFeesForRefund(p.fee, protocolFeesAccrued[payoutToken]);
        }

        inv.status = InvoiceStatus.Refunded;
        protocolFeesAccrued[payoutToken] -= p.fee;
        delete payments[globalId];

        // v0.9 fix: pull from p.payoutSource (where settle deposited the
        // funds) rather than inv.merchant (which may not have them).
        IERC20(payoutToken).safeTransferFrom(p.payoutSource, refundTo, p.merchantPayout);
        if (p.fee > 0) {
            IERC20(payoutToken).safeTransfer(merchant, p.fee);
        }

        emit InvoiceRefunded(globalId, refundTo, payoutToken, p.merchantPayout, p.fee);
    }

    // ── Fees (admin) ───────────────────────────────────────────────────

    /// @notice Withdraw accrued protocol fees for `token` to address `to`.
    /// @dev Intentionally omits `whenNotPaused`. Admin fee withdrawal must
    /// remain callable during a pause so the ops team can respond to an
    /// emergency without being locked out of their own treasury. Audit L1
    /// reviewed and accepted this design on 2026-05-06.
    function withdrawFees(address token, address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
