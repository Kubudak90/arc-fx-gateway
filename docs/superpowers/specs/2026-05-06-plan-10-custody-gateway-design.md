# Plan 10 — V10 custody gateway + audit residual closure + Vault HSM

**Status:** spec; closes the four V10-deferred audit items (H4, M3, M4, L2) plus the four operational gotchas tracked in `memory/audit_2026-05-05.md`. Single merchant on testnet → hard cutover, no backwards compatibility.
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-06
**Depends on:** Plan 7 (audit prep), Plan 9 (V9 deployed at `0xdf6233…ea21`)
**Blocks:** Plan 11 (pre-mainnet bars — multisig admin migration, Chainlink real feeds), Arc mainnet launch coupling

---

## Why this is required

The 2026-05-05 Pulse-AI audit closed 17 verified-true findings on V9 but deferred four to V10 because V9 is immutable on-chain:

| ID | Finding | V10 fix |
|----|---------|---------|
| H4 | `refundInvoice` requires open ERC20 allowance from `payoutSource` (off-chain workaround: hourly cron + onboarding banner) | Custody model — gateway holds settled funds, refund pulls from gateway escrow, allowance dependency disappears |
| M3 | `protocolFeeBps` has no on-chain upper bound | `require(protocolFeeBps <= 1000)` in constructor |
| M4 | Deactivated merchant can re-register, overwriting state silently | `reactivateMerchant(address)` admin-only; deactivation becomes one-way for merchant |
| L2 | `recordPayerRefund` lacks `nonReentrant` (defensive) | Modifier added |

Plus four operational gotchas worth carrying into the V10 cycle:

1. `/api/internal/cron/h4-allowance-check` returns merchant addresses + payout tokens + liabilities in plaintext JSON to anyone holding `CRON_SECRET`. **Naturally eliminated by custody** — the cron itself goes away.
2. Bootstrap allowance check goes stale on `updatePayoutAddress` rotation. **Naturally eliminated by custody** — the banner goes away.
3. M1 IIFE on `RELAYER_PRIVATE_KEY` is logging defense, not key erasure. **Closed by Vault HSM on the VPS** (this plan).
4. `vercel.json` location is fragile — hard-tied to `packages/app/` because that's the Vercel project root. **Closed by deploy runbook documentation.**

V10 ships as a clean break: one merchant on testnet (the developer), zero in-flight invoices that need preserving, V8 + V9 retired completely from indexer / relayer / app / DB.

---

## Decision space — settled

These were brainstormed and locked before this spec was written:

| Question | Choice | Reason |
|----------|--------|--------|
| Custody granularity | Per-invoice escrow | Refund safety guaranteed by math; no balance-ledger drain risk |
| Refund window | 7 days, constructor param | Industry-typical, simple; configurable per-deploy not per-merchant (audit surface minimal) |
| Refund window === claim delay | Yes | Refund allowed while escrow exists (i.e. `status == Paid`). The 7-day window is an upper bound only because after it any third party can call `claim`, which deletes the escrow. There is no time-based revert in `refundInvoice` — the spec relies on `claim` racing the merchant past the window. Off-chain dispute beyond. |
| Fee accrual timing | On claim, not on settle | Refunded invoices earn no fee (fair); avoids unwinding accrued fees on refund |
| Claim authorization | Permissionless | Funds always go to current `merchants[merchant].payoutAddress`; ops can batch on behalf of lazy merchants |
| Refund authorization | `merchant OR delegate-with-REFUND_RIGHT OR admin` | V9 delegate concept extended with bit-flag scope; multisig-identity merchants can delegate refund to hot wallet |
| Deactivated merchant + matured escrow | Merchant claim works for 7 days post-maturity; admin recovery available after | Fairness — earned funds belong to merchant; abandoned escrow has admin sweep at `claimableAt + 7 days` |
| Reactivation | `reactivateMerchant(address merchant)` admin-only; flag flip only, payout state preserved | Mainnet KYB alignment — suspended merchant un-suspension is an ops decision |
| HSM | HashiCorp Vault (or OpenBao) on the existing VPS, transit engine + AppRole + viem custom signer | Real key isolation; no AWS dependency; localhost API ~5 ms/sign |
| V8/V9 retirement | Hard cutover — wipe DB rows, drop indexer/app code paths, contract sources to `legacy/` | Single-merchant testnet — re-register on V10 in one TX, no migration UX needed |

---

## Architecture

### Custody model — per-invoice escrow

```solidity
struct Escrow {
    uint256 amount;        // = inv.amountOut at settle (full requested, fee not yet split)
    address payoutToken;   // copy from inv.payoutToken for cheap lookup
    uint64  claimableAt;   // settleTime + REFUND_WINDOW (7 days)
}
mapping(bytes32 globalId => Escrow) public escrows;
```

Lifecycle for a single invoice:

```
None ──createInvoice──► Created ──settleInvoice──► Paid (escrow created)
                          │                          ├── refundInvoice (within 7d) ──► Refunded
                          │                          ├── claim (after 7d)            ──► Claimed
                          │                          └── adminRecoverEscrow (deactivated + 14d) ──► Recovered
                          └── recordPayerRefund ──► Failed
```

- **Custody invariant:** for every invoice in `Paid` state, `escrow[globalId].amount == inv.amountOut`. The gateway holds exactly that much of `payoutToken` for that invoice. Total custody for a token = sum of all `Paid`-state escrows + `protocolFeesAccrued[token]`.
- **Fee timing:** `protocolFeesAccrued[token]` accumulates only the slippage `excess` (gross − amountOut) at settle, plus the `fee` portion **at claim**. A refund that fires before claim drains the escrow without splitting fee — protocol earns nothing on refunded invoices, by design.

### State transitions

`InvoiceStatus` enum extended:
```solidity
enum InvoiceStatus { None, Created, Paid, Refunded, Failed, Claimed, Recovered }
```

- `Paid` ⇒ funds in custody, claim/refund/admin-recover all possible (gated by time + auth).
- `Claimed` ⇒ escrow drained to merchant payoutAddress; fee accrued. Terminal.
- `Refunded` ⇒ escrow drained to payer with full `amountOut`. Terminal. No fee accrued.
- `Recovered` ⇒ escrow drained to admin-specified address (only for deactivated merchants past `claimableAt + 7d`). Terminal.
- `Failed` ⇒ swap failed pre-settle, never had custody. Terminal.

### Delegate authorization with scope

V9's `delegateAuthorizations[merchant][delegate] = expiresAt` becomes a struct with bit-flag rights:

```solidity
uint8 constant RIGHT_CREATE_INVOICE = 1 << 0; // 0x01
uint8 constant RIGHT_REFUND         = 1 << 1; // 0x02

struct DelegateAuth {
    uint64 expiresAt;
    uint8  rights;
}
mapping(address merchant => mapping(address delegate => DelegateAuth)) public delegates;

function authorizeDelegate(address delegate, uint64 expiresAt, uint8 rights) external;
function revokeDelegate(address delegate) external; // sets expiresAt = 0, rights = 0
```

Both `createInvoiceFor` and `refundInvoice` consult this mapping; refund requires `(rights & RIGHT_REFUND) != 0`, invoice creation requires `(rights & RIGHT_CREATE_INVOICE) != 0`.

V9 has no in-flight delegate authorizations (single merchant, no delegate use), so this is a clean redesign — not a migration.

---

## Contract surface — `ArcFXGatewayV10.sol`

### Constants & immutables

```solidity
bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
uint8   public constant RIGHT_CREATE_INVOICE = 1 << 0;
uint8   public constant RIGHT_REFUND         = 1 << 1;

uint256 public immutable PROTOCOL_FEE_BPS;     // ≤ 1000 (10%) enforced in constructor
uint64  public immutable REFUND_WINDOW;        // seconds, set at deploy (7 days = 604_800)
uint64  public immutable ADMIN_RECOVERY_DELAY; // seconds beyond claimableAt before admin sweep (7 days)
```

### Storage

```solidity
mapping(address token => bool)                supportedTokens;
mapping(address merchant => Merchant)         merchants;
mapping(bytes32 globalId => Invoice)          invoices;
mapping(bytes32 globalId => Escrow)           escrows;
mapping(address token => uint256)             protocolFeesAccrued;
mapping(address => mapping(address => DelegateAuth)) delegates;

// Merchant struct unchanged from V9 (payoutAddress, payoutToken, active)
// Invoice struct: identical to V9 except `Invoice.payoutSource` is removed (gateway IS the source)
```

### External functions

| Function | Modifier(s) | Notes |
|----------|------------|-------|
| `setTokenSupport(address, bool)` | `onlyAdmin` | unchanged |
| `pause() / unpause()` | `onlyAdmin` | unchanged |
| `registerMerchant(address payoutAddress, address payoutToken)` | — | unchanged |
| `updatePayoutAddress(address)` | — | unchanged |
| `updatePayoutToken(address)` | — | unchanged |
| `deactivateMerchant()` | — | one-way for merchant; only `reactivateMerchant` reopens |
| `reactivateMerchant(address merchant)` | `onlyAdmin` | NEW — flag flip; preserves payoutAddress/payoutToken |
| `createInvoice(...)` | `whenNotPaused` | unchanged |
| `createInvoiceFor(...)` | `whenNotPaused` | now checks `RIGHT_CREATE_INVOICE` |
| `settleInvoice(...)` | `nonReentrant whenNotPaused onlyRelayer` | creates `escrow[globalId]`, **no on-settle transfer to merchant**, slippage `excess` → fees |
| `recordPayerRefund(...)` | `nonReentrant whenNotPaused onlyRelayer` | L2 — `nonReentrant` added |
| `refundInvoice(bytes32 globalId)` | `nonReentrant` | drains escrow → payer, status → Refunded; auth: merchant / delegate w/ REFUND / admin |
| `claim(bytes32[] globalIds)` | `nonReentrant` | NEW — permissionless; for each matured escrow, splits to payoutAddress + fee |
| `adminRecoverEscrow(bytes32[] globalIds, address to)` | `nonReentrant onlyAdmin` | NEW — only for `!active && now >= claimableAt + ADMIN_RECOVERY_DELAY` |
| `withdrawFees(address token, address to)` | `onlyAdmin` | unchanged from V9 |
| `authorizeDelegate(address delegate, uint64 expiresAt, uint8 rights)` | — | rights validated `(rights & ~(RIGHT_CREATE_INVOICE | RIGHT_REFUND)) == 0` |
| `revokeDelegate(address delegate)` | — | unchanged |

### Constructor

```solidity
constructor(
    uint256 protocolFeeBps,
    uint64  refundWindow,         // typically 7 days
    uint64  adminRecoveryDelay,   // typically 7 days
    address initialOwner,
    address initialRelayer
) {
    if (initialOwner   == address(0)) revert InvalidPayoutAddress();
    if (initialRelayer == address(0)) revert InvalidPayoutAddress();
    if (protocolFeeBps > 1_000)       revert ProtocolFeeTooHigh(protocolFeeBps); // M3
    if (refundWindow == 0)            revert InvalidWindow();
    if (adminRecoveryDelay == 0)      revert InvalidWindow();

    PROTOCOL_FEE_BPS     = protocolFeeBps;
    REFUND_WINDOW        = refundWindow;
    ADMIN_RECOVERY_DELAY = adminRecoveryDelay;

    _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
    _grantRole(RELAYER_ROLE,       initialRelayer);
}
```

### Settle (gateway holds funds)

```solidity
function settleInvoice(
    bytes32 globalId,
    address payer,
    address payInToken,
    uint256 amountIn,
    uint256 grossPayout,
    bytes32 swapTxHash
) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
    Invoice storage inv = invoices[globalId];
    if (inv.status == InvoiceStatus.None)              revert InvoiceNotFound(globalId);
    if (inv.status != InvoiceStatus.Created)           revert InvoiceAlreadyPaid(globalId);
    if (block.timestamp > inv.expiresAt)               revert InvoiceExpired(globalId);
    if (grossPayout < inv.amountOut)                   revert PayoutShortfall(grossPayout, inv.amountOut);

    address payoutToken = inv.payoutToken;
    IERC20(payoutToken).safeTransferFrom(msg.sender, address(this), grossPayout);

    uint256 excess = grossPayout - inv.amountOut;
    protocolFeesAccrued[payoutToken] += excess;  // slippage immediately accrued; fee NOT split here

    escrows[globalId] = Escrow({
        amount:      inv.amountOut,
        payoutToken: payoutToken,
        claimableAt: uint64(block.timestamp) + REFUND_WINDOW
    });

    inv.status = InvoiceStatus.Paid;
    inv.paidBy = payer;

    emit InvoicePaid(globalId, payer, amountIn, grossPayout, inv.amountOut, /*fee=*/0);
    emit SettlementContext(globalId, payInToken, swapTxHash);
    emit EscrowCreated(globalId, payoutToken, inv.amountOut, escrows[globalId].claimableAt);
}
```

Notes:
- `InvoicePaid.merchantPayout` field carries `inv.amountOut` (not `amountOut - fee` like V9). The fee is `0` at settle. Indexer/app needs to be aware of this rename of semantics; `EscrowCreated` is the V10-only event for clarity.
- `SettlementSource` event is removed (no source — gateway holds).

### Refund

```solidity
function refundInvoice(bytes32 globalId) external nonReentrant {
    Invoice storage inv = invoices[globalId];
    if (inv.status != InvoiceStatus.Paid) revert InvoiceNotRefundable(globalId);

    address merchant = inv.merchant;
    DelegateAuth memory d = delegates[merchant][msg.sender];
    bool isMerchant       = msg.sender == merchant;
    bool isAdmin          = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
    bool isRefundDelegate = d.expiresAt >= block.timestamp && (d.rights & RIGHT_REFUND) != 0;

    if (!isMerchant && !isAdmin && !isRefundDelegate) revert NotAuthorized();

    Escrow memory e = escrows[globalId];
    address refundTo = inv.paidBy;

    inv.status = InvoiceStatus.Refunded;
    delete escrows[globalId];

    IERC20(e.payoutToken).safeTransfer(refundTo, e.amount);

    emit InvoiceRefunded(globalId, refundTo, e.payoutToken, e.amount, /*protocolFeeReturned=*/0);
}
```

Differences from V9:
- No `payoutSource` consultation (no allowance round-trip).
- Refund amount is `e.amount` (= `inv.amountOut`), not `merchantPayout`. **Customer is made whole** — the V9 "customer gets net, merchant gets fee back" oddity is gone.
- `protocolFeesAccrued` not touched. Fee was never split (still in escrow).
- `whenNotPaused` intentionally absent (refunds must work during pause; matches V9 design).

### Claim

```solidity
function claim(bytes32[] calldata globalIds) external nonReentrant {
    for (uint256 i = 0; i < globalIds.length; ++i) {
        bytes32 globalId = globalIds[i];
        Invoice storage inv = invoices[globalId];
        Escrow memory e = escrows[globalId];

        if (inv.status != InvoiceStatus.Paid)   revert InvoiceNotClaimable(globalId);
        if (block.timestamp < e.claimableAt)    revert ClaimTooEarly(globalId, e.claimableAt);

        address payoutAddress = merchants[inv.merchant].payoutAddress;
        if (payoutAddress == address(0))        revert PayoutAddressUnset(inv.merchant);

        uint256 fee        = (e.amount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 toMerchant = e.amount - fee;

        inv.status = InvoiceStatus.Claimed;
        delete escrows[globalId];
        protocolFeesAccrued[e.payoutToken] += fee;

        IERC20(e.payoutToken).safeTransfer(payoutAddress, toMerchant);

        emit InvoiceClaimed(globalId, inv.merchant, payoutAddress, e.payoutToken, toMerchant, fee);
    }
}
```

- Permissionless (anyone calls). Funds always route to current `merchants[inv.merchant].payoutAddress`. Rotation safe.
- Reverts the whole batch on any failure (atomic).
- `whenNotPaused` intentionally absent — claim of already-earned funds must be available during pause.

### Admin escrow recovery

```solidity
function adminRecoverEscrow(bytes32[] calldata globalIds, address to)
    external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE)
{
    if (to == address(0)) revert InvalidPayoutAddress();
    for (uint256 i = 0; i < globalIds.length; ++i) {
        bytes32 globalId = globalIds[i];
        Invoice storage inv = invoices[globalId];
        Escrow memory e = escrows[globalId];

        if (inv.status != InvoiceStatus.Paid) revert InvoiceNotRecoverable(globalId);
        if (merchants[inv.merchant].active)   revert MerchantStillActive(inv.merchant);
        if (block.timestamp < e.claimableAt + ADMIN_RECOVERY_DELAY)
            revert RecoveryTooEarly(globalId, e.claimableAt + ADMIN_RECOVERY_DELAY);

        inv.status = InvoiceStatus.Recovered;
        delete escrows[globalId];

        IERC20(e.payoutToken).safeTransfer(to, e.amount);

        emit EscrowRecovered(globalId, inv.merchant, e.payoutToken, e.amount, to);
    }
}
```

Auditable safety: cannot drain active merchants' escrow; 14-day total wait floor (refund window + recovery delay); admin role is the only caller; full audit trail via `EscrowRecovered`.

### Reactivate (M4)

```solidity
function reactivateMerchant(address merchant) external onlyRole(DEFAULT_ADMIN_ROLE) {
    Merchant storage m = merchants[merchant];
    if (m.payoutAddress == address(0)) revert NotMerchant();
    if (m.active)                       revert MerchantAlreadyActive();
    m.active = true;
    emit MerchantReactivated(merchant);
}
```

`registerMerchant` simultaneously hardened to reject already-existing-but-deactivated rows:

```solidity
function registerMerchant(address payoutAddress, address payoutToken) external {
    if (merchants[msg.sender].payoutAddress != address(0)) revert MerchantAlreadyRegistered();
    // ... rest unchanged
}
```

This closes the M4 gap — deactivated merchants can no longer silently overwrite via re-register; only admin can reactivate.

### Events (full list)

```solidity
event TokenSupportUpdated(address indexed token, bool active);
event MerchantRegistered(address indexed merchant, address payoutAddress, address payoutToken);
event MerchantPayoutAddressUpdated(address indexed merchant, address oldAddress, address newAddress);
event MerchantPayoutTokenUpdated(address indexed merchant, address oldToken, address newToken);
event MerchantDeactivated(address indexed merchant);
event MerchantReactivated(address indexed merchant);                                    // NEW
event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt);
event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee);
event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash);
event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt);          // NEW
event PayerRefunded(bytes32 indexed globalId, address indexed payer, address payInToken, uint256 amount, bytes32 reasonHash);
event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned);
event InvoiceClaimed(bytes32 indexed globalId, address indexed merchant, address payoutAddress, address payoutToken, uint256 toMerchant, uint256 fee);  // NEW
event EscrowRecovered(bytes32 indexed globalId, address indexed merchant, address payoutToken, uint256 amount, address to);  // NEW
event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);
event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt, uint8 rights); // rights ADDED
event DelegateRevoked(address indexed merchant, address indexed delegate);
```

### Errors (full list)

```solidity
error NotMerchant();
error NotAuthorized();
error MerchantAlreadyRegistered();
error MerchantAlreadyActive();
error MerchantInactive();
error MerchantStillActive(address merchant);
error InvalidPayoutToken();
error InvalidPayoutAddress();
error InvalidPayInToken();
error InvalidWindow();
error InvalidDelegateRights(uint8 rights);
error InvoiceAlreadyExists(bytes32 globalId);
error InvoiceAlreadyPaid(bytes32 globalId);
error InvoiceExpired(bytes32 globalId);
error InvoiceNotFound(bytes32 globalId);
error InvoiceNotInCreatedState(bytes32 globalId);
error InvoiceNotRefundable(bytes32 globalId);
error InvoiceNotClaimable(bytes32 globalId);
error InvoiceNotRecoverable(bytes32 globalId);
error PayoutShortfall(uint256 supplied, uint256 required);
error PayoutAddressUnset(address merchant);
error ProtocolFeeTooHigh(uint256 supplied);
error ClaimTooEarly(bytes32 globalId, uint64 claimableAt);
error RecoveryTooEarly(bytes32 globalId, uint64 recoverableAt);
```

---

## Off-chain changes

### 1. Vault HSM on the VPS

**Layout:**
- Vault systemd unit on `194.163.136.1`, listening on `127.0.0.1:8200` (loopback only — never exposed to public).
- Storage: `file` backend at `/var/lib/vault/data/` (single-node OK for testnet; production prep can move to Raft).
- TLS: localhost-only → plaintext OK; if Vault ever moves off-box, switch to mTLS via Caddy reverse proxy.

**Init / unseal:**
- `vault operator init -key-shares=3 -key-threshold=2` → 3 unseal keys, root token. Keys held by user (1Password offline + paper backup); root token revoked after creating a permanent admin token.
- Unseal is **manual** on every VPS reboot. Acceptable trade-off — VPS reboots are rare; manual unseal preserves the key-isolation guarantee. Auto-unseal would defeat the purpose (the unseal key would have to live somewhere automated).

**Transit engine:**
```
vault secrets enable transit
vault write -f transit/keys/relayer-v10 type=ecdsa-p256 exportable=false derived=false
```
Key is `secp256k1`-incompatible by default; Vault transit signs with `ecdsa-p256` for native — for Ethereum, we use `transit/keys/relayer-v10` with `type=ecdsa-p256` + raw-message signing, then convert with viem helpers, OR (preferred) use the `secp256k1` plugin (`vault-plugin-secrets-secp256k1` — community plugin, not core).

**Decision:** use the community `vault-plugin-secrets-secp256k1` plugin. Native keccak256 + secp256k1 signatures, viem-compatible. Plugin source vetted in this plan's implementation phase before deployment.

**AppRole policy for relayer:**
```hcl
path "transit/sign/relayer-v10" {
  capabilities = ["update"]
}
path "transit/keys/relayer-v10" {
  capabilities = ["read"]   # to fetch public key for address derivation
}
```

**Relayer adapter (`ops/relayer/vault-signer.ts`):**
```ts
import { toAccount } from "viem/accounts";
import { hashMessage, hashTypedData, serializeTransaction } from "viem";

interface VaultSignerOpts {
  vaultUrl:  string;     // VAULT_URL (typ. http://127.0.0.1:8200)
  roleId:    string;     // VAULT_ROLE_ID
  secretId:  string;     // VAULT_SECRET_ID
  keyName:   string;     // VAULT_KEY_NAME (typ. relayer-v10)
}

export async function vaultSigner(opts: VaultSignerOpts) {
  // AppRole login → short-lived session token; renewed every (lease_ttl - margin)
  const session = await loginAppRole(opts);
  const address = await fetchEthAddressFromPubKey(opts.vaultUrl, session.token, opts.keyName);

  return toAccount({
    address,
    async signMessage({ message })  { return signRaw(hashMessage(message),       opts.vaultUrl, session.token, opts.keyName); },
    async signTransaction(tx)        { return signRawTx(serializeTransaction(tx), opts.vaultUrl, session.token, opts.keyName); },
    async signTypedData(typedData)   { return signRaw(hashTypedData(typedData),   opts.vaultUrl, session.token, opts.keyName); },
  });
}
```

**Token lifecycle:**
- AppRole `secret_id` rotated daily via cron on the VPS: `vault write auth/approle/role/relayer/secret-id`. New secret id written to `/etc/arcora/relayer.env`, then `systemctl reload arcora-relayer` (graceful — in-flight requests finish on the old session token, new ones perform a fresh AppRole login).
- Session token is renewed in-process every `lease_ttl - 5 min`; on failure, falls back to a fresh AppRole login using the current `secret_id`.

**Backup / DR:**
- Unseal keys → 3 holders (each gets one), 2-of-3 threshold. Documented in `docs/runbooks/vault-recovery.md`.
- Periodic `vault operator raft snapshot save` cron writes to encrypted off-box storage daily (only kicks in once we move to Raft for prod).
- **Lost majority of unseal keys = total loss of relayer key.** This is acceptable for testnet (re-deploy V10 with a new relayer); mainnet T-0 must add a multi-region Vault before it matters.

**Out of scope for V10:** auto-unseal, multi-region Vault HA, Vault Enterprise features. These belong to Plan 11 / mainnet bars.

### 2. Indexer / relayer / app retirement of V8 + V9

- **Indexer** (`ops/indexer/run.ts`, `ops/indexer/replay.ts`): drop V8 + V9 ABI imports, drop `GATEWAY_ADDRESS_V6/V8/V9` env handling, drop the parallel-watch logic from M6. Single gateway: V10. Add `EscrowCreated`, `InvoiceClaimed`, `EscrowRecovered`, `MerchantReactivated` event handlers.
- **Relayer** (`ops/relayer/run.ts`): point at V10 only. Replace `privateKeyToAccount` with `vaultSigner(...)`. Drop `RELAYER_PRIVATE_KEY` env; add `VAULT_URL`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`, `VAULT_KEY_NAME`. M1's IIFE deleted (no plaintext key in process anymore).
- **App** (`packages/app/lib/chain/`):
  - Drop V6/V8/V9 ABIs and address constants (move to `legacy/` or delete entirely).
  - V10 ABI + address.
  - Remove `app/api/internal/cron/h4-allowance-check/route.ts` and its `vercel.json` cron entry (gotcha #1).
  - Remove `readAllowance` calls in `app/api/merchant/bootstrap/route.ts` and the `warning: "approval_required"` response. Drop the matching banner UI in `/m/dashboard` and `/m/settings/AllowedOriginsCard.tsx` (gotcha #2).
  - Add claim flow:
    - `/api/merchant/escrows` — list of pending + matured + claimed escrows for the authed merchant
    - `/m/treasury` page gains a "Claim" tab with a "Claim all matured" button → batch `claim([...])`
    - Invoice list shows new `Claimed` and `Recovered` status pills (alongside existing `Paid`, `Refunded`, `Failed`).
  - Refund button gating: only available when `now < settledAt + 7 days` AND `status == 'paid'` (not yet claimed).

### 3. DB wipe + schema additions

- **Wipe `merchants`, `invoices`, `payments`, `compliance_screenings`, `webhook_attempts`, `webhook_endpoints`, `checkout_authorizations`, `rate_limit_counters` rows.** Single migration `0016_v10_wipe.sql` truncates with `TRUNCATE ... RESTART IDENTITY CASCADE`. Schema preserved.
- **Schema additions** (migration `0017_v10_escrow.sql`):
  - `invoices.status` enum extended with `claimed`, `recovered` values.
  - `invoices.claimable_at` timestamptz nullable — populated by indexer on `EscrowCreated`.
  - `invoices.claimed_at` timestamptz nullable — populated on `InvoiceClaimed`.
  - `invoices.claim_tx` text nullable — tx hash of the claim TX.
  - `invoices.recovered_at` timestamptz nullable — populated on `EscrowRecovered`.
  - `invoices.recovery_tx` text nullable.
  - `merchants.deactivated_at` timestamptz nullable — populated on `MerchantDeactivated`, cleared on `MerchantReactivated`. Helps the dashboard surface "deactivated since" copy.
- **Drop deprecated columns**: `invoices.amount_in`, `merchant_payout`, `protocol_fee` from V8 era stay (still useful for treasury aggregation), but `payments.payout_source` (V9 column) is dropped — gateway is the source.

### 4. Contract source layout

- `packages/contracts/src/ArcFXGatewayV8.sol` and `ArcFXGatewayV9.sol` → `packages/contracts/legacy/` (matches the Plan-7 pattern).
- New: `packages/contracts/src/ArcFXGatewayV10.sol`.
- New deploy script: `packages/contracts/script/DeployV10.s.sol`. Constructor enforces `protocolFeeBps <= 1000` already (M3 closed), so the off-chain `require` in V9's deploy script is no longer needed for V10 — script keeps it as belt-and-suspenders for legacy reference.
- Foundry test layout: `packages/contracts/test/V10/` with one file per behavior (Custody, Refund, Claim, AdminRecovery, Reactivate, Delegate, FeeBound, Pause). Target ≥95 / ≥90 line/branch coverage to clear the Plan-7 coverage gate.
- Slither triage: update `.slither-triage.md` scope to "V10 only" (V8/V9 in `legacy/` excluded from the gate).

### 5. Deploy runbook + vercel.json doc (gotcha #4)

- New runbook: `docs/runbooks/v10-deploy.md` — Foundry deploy commands, `cast receipt` + `cast code` verification, env vars to set on Vercel + VPS, Vault setup checklist, DB migration sequence (0016 then 0017).
- Add to `docs/runbooks/h4-refund-approval.md` a deprecation header pointing to `v10-deploy.md` ("V10 eliminates the H4 refund-allowance dependency entirely; this runbook is retained for historical reference only").
- Add to the existing `docs/audit/deploy-checklist.md` a top section: "**vercel.json lives at `packages/app/vercel.json`** because the Vercel project root is set to that subdirectory. Moving the project root to repo root will silently stop registering all crons. Don't move the project root without coordinating a `vercel.json` relocation."

---

## Migration / cutover sequence

1. **Pre-deploy** (off-chain prep)
   - PR `plan-10-v10-custody` opens off `plan-1-protocol@<HEAD>`, merges to `plan-1-protocol` after review.
   - Vault installed + initialized + transit key generated on VPS. Public key derived → relayer V10 address recorded.
   - V10 contract source committed; foundry suite green ≥ 95/90 coverage.
2. **Deploy V10** to Arc testnet
   - `forge script script/DeployV10.s.sol --broadcast --legacy --rpc-url $ARC_RPC`
   - `cast receipt <txHash>` status=1 + `cast code <V10Addr>` non-empty (Foundry-broadcast-lies caveat from `MEMORY.md`).
   - `setTokenSupport` for USDC + EURC.
3. **Off-chain rewire**
   - Vercel env: drop `GATEWAY_ADDRESS_V6/V8/V9`, set `GATEWAY_ADDRESS_V10`. Drop `H4_MIN_BOOTSTRAP_ALLOWANCE`. Add `REFUND_WINDOW_SECONDS` (display-only, app reads on-chain truth).
   - VPS env (relayer): drop `RELAYER_PRIVATE_KEY`. Add `VAULT_URL=http://127.0.0.1:8200`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`, `VAULT_KEY_NAME=relayer-v10`. Restart relayer systemd unit.
   - DB migrations 0016 (wipe) + 0017 (schema) applied to Neon prod via direct SQL exec (matching the Plan-5 / Plan-9 pattern).
   - Indexer systemd unit restarted; only V10 watched.
4. **App re-bootstrap**
   - Visit `arcorapay.xyz`, SIWE in, hit `/m/dashboard`, "Bootstrap as merchant" — single TX → V10 `registerMerchant`.
   - Smoke: create invoice, pay (USDC→USDC), refund within 7d, observe escrow drain → payer.
   - Smoke: create + pay invoice, fast-forward 7d via `cast rpc anvil_increaseTime` on a forked dev chain, run `claim([...])`, verify payout split.
   - Smoke: deactivate, fast-forward 14d, `adminRecoverEscrow` to ops address.
5. **V8/V9 retirement**
   - Old gateway addresses on testnet remain on-chain (they're immutable) but go unused. NatSpec on the Vercel `arc-fx-gateway-v9` project (if any aliases still point there) gets a redirect to V10.
   - `arcora-shop.vercel.app` (the dogfood storefront) re-bootstrapped against V10.

Total downtime estimate: ~30 min for migrations + restart + re-bootstrap. Acceptable since single merchant + zero in-flight customer payments.

---

## Testing strategy

### Foundry (contracts)

- `test/V10/Custody.t.sol` — settle creates correct escrow, `protocolFeesAccrued` only gets slippage excess, `EscrowCreated` event emitted.
- `test/V10/Refund.t.sol` — refund within window drains full `amountOut` to payer, fee not accrued, status → Refunded; merchant + delegate-with-RIGHT_REFUND + admin all succeed; rando reverts; expired window reverts.
- `test/V10/Claim.t.sol` — permissionless caller succeeds post-window, splits correctly, fee accrues, batch atomicity (one bad ID reverts whole batch), goes to current payoutAddress (rotation safe).
- `test/V10/AdminRecovery.t.sol` — only deactivated merchants past `claimableAt + ADMIN_RECOVERY_DELAY`; active merchant reverts; non-admin reverts.
- `test/V10/Reactivate.t.sol` — admin reactivates flag-flips correctly; non-admin reverts; double-reactivate reverts; `registerMerchant` rejects already-existing rows.
- `test/V10/Delegate.t.sol` — bit-flag rights enforced separately for invoice-create vs. refund; expired delegate reverts; revoke clears both.
- `test/V10/FeeBound.t.sol` — constructor with `feeBps > 1000` reverts with `ProtocolFeeTooHigh`.
- `test/V10/Pause.t.sol` — paused: settle/createInvoice revert; refund/claim/withdrawFees still work.
- `test/V10/Reentrancy.t.sol` — malicious ERC20 token attempts reentry into refund/claim/recover; all reverts.

Coverage gate: ≥ 95 / ≥ 90 (Plan-7 floor).

### Vitest (app)

- `app/api/checkout/quote/route.test.ts` — already passes; verify still green with V10 ABI.
- `app/api/merchant/escrows/route.test.ts` — NEW. Authed merchant gets pending + matured rollups; unauthed → 401.
- `app/api/merchant/treasury/route.test.ts` — extend with claimed + recovered aggregates.
- `lib/chain/v10-claim.test.ts` — NEW. Helper that gathers globalIds where `claimable_at <= now` and not yet claimed, used by the dashboard "Claim all matured" button.

### Vitest (sdk / sdk-react)

- `@arcora/sdk`: bump ABI snapshot; add `client.escrows()` method.
- `@arcora/sdk-react`: update `useCheckout` to surface refund-window deadline (`refundEndsAt`) so host apps can show countdowns.

### Vault integration test

- `ops/relayer/vault-signer.test.ts` — spins up Vault dev mode (`vault server -dev`), generates secp256k1 key, signs a known message, verifies signature recovery yields expected address. Skipped in CI by default (heavy); run manually on VPS rebuild.

### End-to-end smoke (manual, post-deploy)

Documented in `docs/runbooks/v10-deploy.md`. Browser-driven: SIWE → bootstrap → invoice create → pay → refund → re-create → pay → wait 7d → claim → deactivate → admin recover.

---

## Risks & open issues

1. **Vault community plugin (`vault-plugin-secrets-secp256k1`) trust.** Plugin is OSS but not core HashiCorp. Implementation phase must vet the plugin's source + recent activity before deployment. Fallback: write a thin native sign-and-verify wrapper using core Vault `transit` + secp256k1 derivation off Vault — more code, fewer external deps.
2. **Manual unseal on VPS reboot.** Acceptable for testnet (rare reboots). Mainnet T-0 needs auto-unseal via a separate KMS or TPM — out of scope here; carried into Plan 11.
3. **`InvoicePaid` event semantic shift.** V10 emits `merchantPayout = amountOut` and `fee = 0` at settle (vs. V9's already-split `merchantPayout = amountOut - fee`). Indexer must read fee from `InvoiceClaimed` instead. Documented; bug if missed.
4. **Permissionless claim cost.** If nobody calls `claim` for a merchant, escrow sits indefinitely until admin recovery (which only works for deactivated). Mitigation: app-side cron `/api/internal/cron/v10-claim-keeper` that batches claims for the dev-merchant. Out of contract scope; lives in app.
5. **Total custody pressure.** Gateway holds the sum of all matured-but-unclaimed escrows. If that ever grows large (high-volume mainnet), the gateway becomes a bigger target. Single point of failure mitigated by the 7-day window naturally draining custody, plus admin pause.
6. **Vault SECRET_ID rotation race.** Daily cron rotates AppRole secret id; relayer reload happens after env file rewrite. If cron runs mid-tx, the next sign call after env write uses new token. Mitigation: rotation cron writes new env then `systemctl reload arcora-relayer`; reload is graceful (in-flight requests finish on old token, new ones use new token).

---

## Out of scope (deferred to Plan 11 / mainnet bars)

- Multisig admin migration (single-EOA admin → 2-of-3 or 3-of-5 multisig).
- Real Chainlink price feeds (replacing `MockChainlinkFeed`).
- Vault auto-unseal / multi-region HA.
- Spearbit/Cantina/Sherlock external audit RFP (fires on mainnet trigger per `MEMORY.md`).
- Configurable refund window per merchant (V10 deploys with single `REFUND_WINDOW`).

---

## Acceptance checklist (for implementation phase)

- [ ] `ArcFXGatewayV10.sol` written, all foundry tests green, coverage ≥ 95/90.
- [ ] V8 + V9 sources moved to `packages/contracts/legacy/`.
- [ ] V10 deployed to Arc testnet, `cast receipt` status=1 + `cast code` non-empty.
- [ ] Vault running on VPS; transit key generated; relayer signing through Vault end-to-end.
- [ ] Indexer / relayer / app reference V10 only; V6/V8/V9 env vars + code paths deleted.
- [ ] Migrations 0016 (wipe) + 0017 (schema) applied to Neon prod.
- [ ] User re-bootstrapped as merchant on V10; full smoke (pay → refund → pay → claim → deactivate → admin recover) green.
- [ ] H4 cron + stale allowance banner deleted.
- [ ] `docs/runbooks/v10-deploy.md` written.
- [ ] `docs/audit/2026-05-05-residuals.md` "Deferred to V10" rows marked closed.
- [ ] Memory entries updated: `audit_2026-05-05.md` flips deferred items to closed; new memory `v10_custody.md` summarizing live state.
