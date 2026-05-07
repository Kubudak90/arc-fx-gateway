// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl }     from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable }          from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ArcFXGatewayV8
/// @notice v0.8 — pool-free. The gateway no longer performs the FX swap itself;
///         that is delegated to Circle's App Kit Swap on Arc, executed by the
///         Arcora relayer service off-chain. Customer signs a single Permit2
///         message; the relayer pulls the pay-in token, runs `kit.swap`, then
///         calls `settleInvoice` here to deliver the payout to the merchant.
///         The gateway's job is now: invoice lifecycle, fee accrual, refunds,
///         and emitting the events our indexer + webhook flow already depends on.
contract ArcFXGatewayV8 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Protocol fee on the gross payout, in basis points (1 = 0.01%).
    /// Locked at deploy; deploy a new contract to change.
    uint256 public immutable PROTOCOL_FEE_BPS;

    // ── Token whitelist ────────────────────────────────────────────────
    /// @notice Tokens accepted as pay-in or payout. Owner-managed.
    /// Replaces the v0.7 `IStablecoinRegistry` dependency; the registry
    /// was tied to the in-house pool and is no longer needed.
    mapping(address token => bool) public supportedTokens;

    // ── Merchant registry ──────────────────────────────────────────────
    struct Merchant {
        address payoutAddress;
        address payoutToken;
        bool    active;
    }
    mapping(address merchant => Merchant) public merchants;

    // ── Invoice state ──────────────────────────────────────────────────
    /// @dev `Failed` is new in v0.8: marks an invoice the relayer could not
    /// settle (swap failed, slippage breach, etc) after the pay-in has been
    /// returned to the customer off-chain. Indexer and webhook payloads use
    /// it to surface a terminal "this won't pay" state instead of leaving
    /// the row in `Created` forever.
    enum InvoiceStatus { None, Created, Paid, Refunded, Failed }
    struct Invoice {
        address       merchant;
        address       payIn;          // advisory in v0.8 — actual pay-in is whatever the customer signed
        address       payoutToken;    // locked at creation; merchant changes don't reroute pending invoices
        uint256       amountOut;      // what the merchant expects to receive (gross, before our fee)
        uint64        expiresAt;
        InvoiceStatus status;
        address       paidBy;
    }
    mapping(bytes32 globalId => Invoice) public invoices;

    // ── Payment accounting (for refunds) ───────────────────────────────
    struct InvoicePayment {
        uint256 merchantPayout;  // amount delivered to merchant in payoutToken
        uint256 fee;             // protocol fee taken in payoutToken
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
    /// @dev Same surface as v0.6/v0.7 so indexer + webhook payloads stay binary-compatible.
    event InvoicePaid(
        bytes32 indexed globalId,
        address indexed payer,
        uint256 amountIn,
        uint256 grossReceived,
        uint256 merchantPayout,
        uint256 fee
    );
    /// @dev v0.8-only: extra context the relayer surfaces alongside settlement so
    /// the indexer can stitch the on-chain settle to the off-chain `kit.swap` tx.
    /// Kept separate from `InvoicePaid` to avoid breaking the existing decoder.
    event SettlementContext(
        bytes32 indexed globalId,
        address indexed payInToken,
        bytes32 swapTxHash
    );
    /// @dev v0.8-only: relayer reports it has refunded the customer off-chain
    /// after a failed swap. Indexer flips the invoice to `Failed`.
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
    /// @dev `protocolFeeBps` is locked for the life of the contract. To change it, deploy a new gateway.
    /// @param protocolFeeBps fee in basis points (1 = 0.01%) charged on every settled invoice's gross payout
    /// @param initialOwner   address granted `DEFAULT_ADMIN_ROLE` (manages tokens, pause, withdraw fees, role rotation)
    /// @param initialRelayer address granted `RELAYER_ROLE` (calls `settleInvoice` and `recordPayerRefund`)
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
    /// @dev Whitelist policy: only non-rebasing, non-fee-on-transfer tokens. The contract trusts admin to enforce this off-chain (see `docs/audit/threat-model.md` E1).
    /// @param token  ERC-20 contract address
    /// @param active true to allow as pay-in / payout, false to remove
    function setTokenSupport(address token, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedTokens[token] = active;
        emit TokenSupportUpdated(token, active);
    }

    // ── Pause (admin) ──────────────────────────────────────────────────

    /// @notice Halt every state-mutating entry point (merchant create, settle, refund). View calls stay live.
    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }

    /// @notice Resume normal operation after a `pause`.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Merchant management ────────────────────────────────────────────

    /// @notice One-time merchant registration. The caller is recorded as the merchant identity.
    /// @dev `payoutToken` must already be in `supportedTokens`. To change either field later, use
    ///       `updatePayoutAddress` / `updatePayoutToken` (those only affect future invoices).
    /// @param payoutAddress wallet that will receive the merchant's net payout from each settled invoice
    /// @param payoutToken   ERC-20 the merchant prefers to settle in
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

    /// @notice Rotate the merchant's payout wallet for future invoices.
    /// @dev Pending invoices keep the address in effect at create time — see `_createInvoice`.
    /// @param newPayoutAddress non-zero replacement wallet
    function updatePayoutAddress(address newPayoutAddress) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        if (newPayoutAddress == address(0)) revert InvalidPayoutAddress();
        address old = m.payoutAddress;
        m.payoutAddress = newPayoutAddress;
        emit MerchantPayoutAddressUpdated(msg.sender, old, newPayoutAddress);
    }

    /// @notice Change the merchant's preferred settle-in token for future invoices.
    /// @dev Pending invoices keep the token in effect at create time. New token must be whitelisted.
    /// @param newPayoutToken ERC-20 in `supportedTokens`
    function updatePayoutToken(address newPayoutToken) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        if (!supportedTokens[newPayoutToken]) revert InvalidPayoutToken();
        address old = m.payoutToken;
        m.payoutToken = newPayoutToken;
        emit MerchantPayoutTokenUpdated(msg.sender, old, newPayoutToken);
    }

    /// @notice Soft-disable the merchant. New invoice creation reverts; existing invoices still settle/refund.
    /// @dev There is no on-chain "reactivate"; a deactivated merchant must call `registerMerchant` again
    ///       which would revert because their state row already exists. Reactivation is therefore a deploy-new
    ///       or an admin migration concern, not a self-service flow today.
    function deactivateMerchant() external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        m.active = false;
        emit MerchantDeactivated(msg.sender);
    }

    // ── Invoice creation ───────────────────────────────────────────────

    /// @notice Create an invoice as the calling merchant.
    /// @dev `globalId = keccak256(abi.encode(merchant, merchantInvoiceId))`. Reuse of `merchantInvoiceId`
    ///       reverts with `InvoiceAlreadyExists`. Snapshots the merchant's current `payoutAddress` /
    ///       `payoutToken`; later merchant edits don't reroute this invoice.
    /// @param merchantInvoiceId merchant-supplied id (e.g. cart hash); only the merchant's own namespace
    /// @param payIn             token the customer is expected to pay in (advisory only in v0.8)
    /// @param amountOut         gross amount the merchant expects to receive in their `payoutToken`
    /// @param expiresAt         unix timestamp after which `settleInvoice` reverts
    /// @return globalId         deterministic invoice id used everywhere downstream
    function createInvoice(
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64 expiresAt
    ) external returns (bytes32 globalId) {
        return _createInvoice(msg.sender, merchantInvoiceId, payIn, amountOut, expiresAt);
    }

    /// @notice Create an invoice on behalf of a merchant when the caller is an authorized delegate.
    /// @dev The merchant must have called `authorizeDelegate(msg.sender, expiresAt)` first.
    ///       Used by the API server hot wallet so merchants don't have to sign every invoice manually.
    /// @param merchant          merchant whose namespace this invoice lives in
    /// @param merchantInvoiceId merchant-supplied id
    /// @param payIn             token the customer is expected to pay in
    /// @param amountOut         gross expected payout
    /// @param expiresAt         unix expiry
    /// @return globalId         deterministic invoice id
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
    /// @param payInToken  token the customer actually paid in (informational, for the indexer)
    /// @param amountIn    amount the customer paid in (informational)
    /// @param grossPayout amount of `payoutToken` the relayer just transferred in
    /// @param swapTxHash  transaction hash of the off-chain `kit.swap` call
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

        // Stripe-shaped economics: merchant always receives exactly amountOut
        // net of the protocol fee, regardless of how favourably the swap rate
        // moved. Any excess (grossPayout > amountOut) lands in the protocol
        // fee bucket — it offsets the unfavourable rate cases that revert
        // and trigger refunds (the relayer eats those losses today; this
        // bucket is what makes the math even out over time).
        uint256 fee        = (inv.amountOut * PROTOCOL_FEE_BPS) / 10_000;
        uint256 toMerchant = inv.amountOut - fee;
        uint256 excess     = grossPayout - inv.amountOut;
        protocolFeesAccrued[payoutToken] += fee + excess;

        inv.status = InvoiceStatus.Paid;
        inv.paidBy = payer;
        payments[globalId] = InvoicePayment({ merchantPayout: toMerchant, fee: fee });

        IERC20(payoutToken).safeTransfer(payoutAddress, toMerchant);

        emit InvoicePaid(globalId, payer, amountIn, grossPayout, toMerchant, fee);
        emit SettlementContext(globalId, payInToken, swapTxHash);
    }

    /// @notice Called by the relayer when `kit.swap` failed and the customer
    /// has been refunded their pay-in off-chain. Marks the invoice `Failed`
    /// so the indexer/webhook flow stops reporting it as pending.
    /// Pure event-and-state recording — no token movement happens here, the
    /// off-chain refund is what actually returns funds to the customer.
    function recordPayerRefund(
        bytes32 globalId,
        address payer,
        address payInToken,
        uint256 amount,
        bytes32 reasonHash
    ) external whenNotPaused onlyRole(RELAYER_ROLE) {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None) revert InvoiceNotFound(globalId);
        if (inv.status != InvoiceStatus.Created) revert InvoiceNotInCreatedState(globalId);

        inv.status = InvoiceStatus.Failed;
        emit PayerRefunded(globalId, payer, payInToken, amount, reasonHash);
    }

    // ── Refund (merchant-driven; preserved from v0.7) ──────────────────

    /// @notice Refund a paid invoice. Pulls `merchantPayout` from the merchant's
    /// wallet (requires payoutToken approve to gateway), forwards it to the
    /// original payer, and returns the protocol fee from `protocolFeesAccrued`
    /// to the merchant. The invoice is marked Refunded; second calls revert.
    /// Callable by the merchant or the contract admin.
    function refundInvoice(bytes32 globalId) external nonReentrant {
        Invoice storage inv = invoices[globalId];
        if (inv.status != InvoiceStatus.Paid) revert InvoiceNotRefundable(globalId);
        if (msg.sender != inv.merchant && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotMerchant();
        }

        InvoicePayment memory p = payments[globalId];
        address payoutToken = inv.payoutToken;
        address refundTo    = inv.paidBy;
        address merchant    = inv.merchant;

        if (protocolFeesAccrued[payoutToken] < p.fee) {
            revert InsufficientFeesForRefund(p.fee, protocolFeesAccrued[payoutToken]);
        }

        inv.status = InvoiceStatus.Refunded;
        protocolFeesAccrued[payoutToken] -= p.fee;
        delete payments[globalId];

        IERC20(payoutToken).safeTransferFrom(merchant, refundTo, p.merchantPayout);
        if (p.fee > 0) {
            IERC20(payoutToken).safeTransfer(merchant, p.fee);
        }

        emit InvoiceRefunded(globalId, refundTo, payoutToken, p.merchantPayout, p.fee);
    }

    // ── Fees (admin) ───────────────────────────────────────────────────

    /// @notice Sweep all accrued fees of a single token to a receiving address.
    /// @dev Sets `protocolFeesAccrued[token]` to zero before the transfer (CEI pattern).
    /// @param token ERC-20 to withdraw — does not have to currently be in `supportedTokens`
    ///              (e.g. a token that was de-listed but still has accrued fees on the books)
    /// @param to    recipient (admin-controlled treasury wallet)
    function withdrawFees(address token, address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 amount = protocolFeesAccrued[token];
        protocolFeesAccrued[token] = 0;
        IERC20(token).safeTransfer(to, amount);
        emit FeesWithdrawn(token, to, amount);
    }

    // ── Delegate authorization ─────────────────────────────────────────

    /// @notice Allow `delegate` to call `createInvoiceFor(msg.sender, ...)` until `expiresAt`.
    /// @dev Setting `expiresAt` to a past timestamp (or zero) effectively revokes; `revokeDelegate`
    ///       is the explicit-intent alias for that.
    /// @param delegate  address that will be allowed to create invoices on the merchant's behalf
    /// @param expiresAt unix timestamp at which the authorization expires
    function authorizeDelegate(address delegate, uint64 expiresAt) external {
        if (!merchants[msg.sender].active) revert NotMerchant();
        delegateAuthorizations[msg.sender][delegate] = expiresAt;
        emit DelegateAuthorized(msg.sender, delegate, expiresAt);
    }

    /// @notice Revoke a previously authorized delegate immediately.
    /// @param delegate address whose authorization is cleared
    function revokeDelegate(address delegate) external {
        delegateAuthorizations[msg.sender][delegate] = 0;
        emit DelegateRevoked(msg.sender, delegate);
    }
}
