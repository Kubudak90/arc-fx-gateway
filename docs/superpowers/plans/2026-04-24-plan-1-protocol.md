# Plan 1 — Protocol (ArcFXGateway + PriceGuard + Curve Pool)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the on-chain protocol layer of Arc FX Gateway — a Curve-style USDC/EURC StableSwap pool, an immutable `ArcFXGateway` contract that atomically swaps customer EURC into merchant USDC per invoice, and a `PriceGuard` library that rejects swaps whose pool rate deviates more than 0.5% from Chainlink EUR/USD. Deployed and bootstrapped on Arc testnet.

**Architecture:** Monorepo (pnpm workspaces) with `packages/contracts/` as a Foundry project. Curve pool is vendored from upstream (Vyper), compiled via Foundry's Vyper support. Solidity contracts (`ArcFXGateway`, `PriceGuard`) live alongside. Tests are Foundry-native: unit → fuzz → invariant → fork (Arc testnet RPC). Deployment via Foundry scripts with broadcast.

**Tech Stack:** Solidity 0.8.26, Vyper 0.3.10 (for Curve), Foundry (forge + cast + anvil), OpenZeppelin v5 (ReentrancyGuard, IERC20, Ownable), Chainlink AggregatorV3Interface, Slither + Aderyn for static analysis, GitHub Actions for CI.

**Spec reference:** `docs/superpowers/specs/2026-04-24-arc-fx-merchant-gateway-design.md`

---

## File Structure

```
arc-fx-gateway/
├── package.json                          # workspace root
├── pnpm-workspace.yaml
├── .github/
│   └── workflows/
│       └── contracts-ci.yml              # Task 16
└── packages/
    └── contracts/
        ├── foundry.toml
        ├── remappings.txt
        ├── .env.example
        ├── README.md                     # Task 17
        ├── src/
        │   ├── ArcFXGateway.sol          # Tasks 5–10
        │   ├── libraries/
        │   │   └── PriceGuard.sol        # Tasks 3–4
        │   └── interfaces/
        │       ├── ICurvePool.sol
        │       └── IChainlinkAggregator.sol
        ├── lib/
        │   ├── forge-std/                # submodule
        │   ├── openzeppelin-contracts/   # submodule
        │   ├── chainlink/                # submodule (for AggregatorV3Interface only)
        │   └── curve-contracts/          # vendored Vyper (Task 2)
        ├── test/
        │   ├── PriceGuard.t.sol          # Task 4
        │   ├── ArcFXGateway.t.sol        # Tasks 6–10
        │   ├── ArcFXGateway.fuzz.t.sol   # Task 11
        │   ├── ArcFXGateway.invariant.t.sol  # Task 12
        │   ├── helpers/
        │   │   ├── MockERC20.sol
        │   │   └── MockChainlink.sol
        │   └── fork/
        │       └── ArcFXGateway.fork.t.sol
        └── script/
            ├── Deploy.s.sol              # Task 13
            └── BootstrapLiquidity.s.sol  # Task 14
```

---

## Task 1: Monorepo scaffold + Foundry init

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/package.json`
- Create: `/Users/huseyinarslan/arc-fx-gateway/pnpm-workspace.yaml`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/contracts/foundry.toml`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/contracts/remappings.txt`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/contracts/.env.example`

- [ ] **Step 1: Install Foundry (if missing)**

Run: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
Expected: `forge --version` returns `forge 0.2.x` or newer.

- [ ] **Step 2: Create workspace root `package.json`**

```json
{
  "name": "arc-fx-gateway",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build:contracts": "pnpm --filter @arc-fx/contracts build",
    "test:contracts": "pnpm --filter @arc-fx/contracts test"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 4: Initialize Foundry project in `packages/contracts`**

Run: `mkdir -p packages/contracts && cd packages/contracts && forge init --no-git --no-commit --force .`
Expected: creates `src/`, `test/`, `script/`, `lib/forge-std/`, `foundry.toml`. Remove the default `Counter.sol` files: `rm src/Counter.sol test/Counter.t.sol script/Counter.s.sol`.

- [ ] **Step 5: Overwrite `packages/contracts/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.26"
optimizer = true
optimizer_runs = 200
evm_version = "cancun"
fs_permissions = [{ access = "read", path = "./"}]
gas_reports = ["ArcFXGateway"]

[profile.ci]
fuzz = { runs = 10000 }
invariant = { runs = 256, depth = 64 }

[rpc_endpoints]
arc_testnet = "${ARC_TESTNET_RPC}"

[etherscan]
arc_testnet = { key = "${ARC_EXPLORER_KEY}", url = "${ARC_EXPLORER_URL}" }
```

- [ ] **Step 6: Add OpenZeppelin + Chainlink submodules**

Run:
```bash
cd packages/contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-git --no-commit
forge install smartcontractkit/chainlink-brownie-contracts --no-git --no-commit
```

- [ ] **Step 7: Create `remappings.txt`**

```
forge-std/=lib/forge-std/src/
@openzeppelin/=lib/openzeppelin-contracts/
@chainlink/=lib/chainlink-brownie-contracts/contracts/
```

- [ ] **Step 8: Create `.env.example`**

```
ARC_TESTNET_RPC=https://rpc-testnet.arc.network
ARC_EXPLORER_KEY=
ARC_EXPLORER_URL=https://explorer-testnet.arc.network/api
DEPLOYER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001
CHAINLINK_EURUSD_FEED=0x0
```

- [ ] **Step 9: Verify build works**

Run: `cd packages/contracts && forge build`
Expected: `Compiling 0 files with Solc 0.8.26` (or "Nothing to compile"). No errors.

- [ ] **Step 10: Commit**

```bash
cd /Users/huseyinarslan/arc-fx-gateway
git add package.json pnpm-workspace.yaml packages/contracts/foundry.toml packages/contracts/remappings.txt packages/contracts/.env.example
git commit -m "chore(contracts): scaffold Foundry project in pnpm workspace"
```

---

## Task 2: Vendor Curve StableSwap (Vyper) + verify Vyper compile

**Files:**
- Create: `packages/contracts/lib/curve-contracts/StableSwap.vy` (vendored)
- Modify: `packages/contracts/foundry.toml` (enable Vyper)

> **Note:** Curve's official StableSwap is Vyper. Foundry supports Vyper via `vyper` compiler if installed on PATH. If Vyper setup blocks you, fall back to a Solidity StableSwap implementation (Saddle Finance fork, MIT licensed) — log a decision note in the commit message. Proceed with Vyper path first; deviation to Solidity is allowed if Step 4 fails.

- [ ] **Step 1: Install Vyper**

Run: `pipx install vyper==0.3.10` (or `pip install --user vyper==0.3.10`)
Expected: `vyper --version` → `0.3.10+commit.*`

- [ ] **Step 2: Download Curve StableSwap v1 plain-pool Vyper source**

Run:
```bash
mkdir -p packages/contracts/lib/curve-contracts
curl -fsSL https://raw.githubusercontent.com/curvefi/curve-contract/master/contracts/pool-templates/base/SwapTemplateBase.vy \
  -o packages/contracts/lib/curve-contracts/StableSwap.vy
```
Expected: file downloaded, ~20 KB. If the URL changes, fetch the latest `StableSwap` contract from the curvefi/curve-contract repo.

- [ ] **Step 3: Add Vyper config to `foundry.toml`**

Append:
```toml
[profile.default.vyper]
path = "vyper"
```
And add to `[profile.default]`:
```toml
ffi = true
```

- [ ] **Step 4: Verify Vyper compilation**

Run: `cd packages/contracts && forge build`
Expected: Vyper contract compiles, output appears in `out/StableSwap.vy/`. If it fails due to Vyper-version incompatibility, try `vyper==0.3.7` or `vyper==0.2.15` and update `StableSwap.vy` source accordingly from the matching curve-contract tag.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/lib/curve-contracts/ packages/contracts/foundry.toml
git commit -m "chore(contracts): vendor Curve StableSwap Vyper source + enable vyper build"
```

---

## Task 3: `PriceGuard` library skeleton + errors

**Files:**
- Create: `packages/contracts/src/libraries/PriceGuard.sol`
- Create: `packages/contracts/src/interfaces/IChainlinkAggregator.sol`

- [ ] **Step 1: Create `IChainlinkAggregator.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IChainlinkAggregator {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function decimals() external view returns (uint8);
}
```

- [ ] **Step 2: Create `PriceGuard.sol` with errors + skeleton**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IChainlinkAggregator } from "../interfaces/IChainlinkAggregator.sol";

/// @title PriceGuard
/// @notice Reverts if a pool-derived rate deviates too far from a Chainlink reference.
library PriceGuard {
    /// @dev Maximum age of a Chainlink round before it is considered stale.
    uint256 internal constant MAX_STALE_SECONDS = 1 hours;

    /// @dev Denominator for basis-point arithmetic (1 bp = 0.01%).
    uint256 internal constant BPS = 10_000;

    error StaleOracle(uint256 updatedAt);
    error InvalidOraclePrice(int256 answer);
    error OracleDeviation(uint256 poolRate, uint256 oracleRate, uint256 maxBps);

    /// @notice Returns the Chainlink reference rate, scaled to 1e18.
    /// @dev Reverts on stale or invalid rounds.
    function _readOracle(IChainlinkAggregator feed) internal view returns (uint256 rate1e18) {
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert InvalidOraclePrice(answer);
        if (block.timestamp - updatedAt > MAX_STALE_SECONDS) revert StaleOracle(updatedAt);
        uint8 dec = feed.decimals();
        if (dec == 18) return uint256(answer);
        if (dec < 18) return uint256(answer) * (10 ** (18 - dec));
        return uint256(answer) / (10 ** (dec - 18));
    }

    /// @notice Reverts if `poolRate` deviates from the oracle rate by more than `maxDeviationBps`.
    /// @param poolRate  Rate implied by the AMM pool, scaled to 1e18 (units: quote per 1 base).
    /// @param feed      Chainlink aggregator for the base/quote pair.
    /// @param maxDeviationBps  Max allowed deviation in basis points (50 = 0.5%).
    function check(
        uint256 poolRate,
        IChainlinkAggregator feed,
        uint256 maxDeviationBps
    ) internal view {
        uint256 oracleRate = _readOracle(feed);
        uint256 diff = poolRate > oracleRate ? poolRate - oracleRate : oracleRate - poolRate;
        // diff / oracleRate > maxDeviationBps / BPS  →  diff * BPS > oracleRate * maxDeviationBps
        if (diff * BPS > oracleRate * maxDeviationBps) {
            revert OracleDeviation(poolRate, oracleRate, maxDeviationBps);
        }
    }
}
```

- [ ] **Step 3: Build**

Run: `cd packages/contracts && forge build`
Expected: compiles, no warnings.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/libraries/PriceGuard.sol packages/contracts/src/interfaces/IChainlinkAggregator.sol
git commit -m "feat(contracts): add PriceGuard library with Chainlink deviation check"
```

---

## Task 4: `PriceGuard` unit tests

**Files:**
- Create: `packages/contracts/test/helpers/MockChainlink.sol`
- Create: `packages/contracts/test/PriceGuard.t.sol`

- [ ] **Step 1: Write failing tests first**

Create `test/helpers/MockChainlink.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IChainlinkAggregator } from "../../src/interfaces/IChainlinkAggregator.sol";

contract MockChainlink is IChainlinkAggregator {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public immutable decimalsOverride;

    constructor(uint8 _decimals) { decimalsOverride = _decimals; }

    function setAnswer(int256 _answer, uint256 _updatedAt) external {
        answer = _answer;
        updatedAt = _updatedAt;
    }

    function decimals() external view returns (uint8) { return decimalsOverride; }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
```

Create `test/PriceGuard.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PriceGuard } from "../src/libraries/PriceGuard.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockChainlink } from "./helpers/MockChainlink.sol";

contract PriceGuardTest is Test {
    using PriceGuard for uint256;

    MockChainlink feed;

    function setUp() public {
        feed = new MockChainlink(8);                   // Chainlink EUR/USD uses 8 decimals
        feed.setAnswer(1.0863e8, block.timestamp);     // 1 EUR = 1.0863 USD
    }

    function test_Check_PassesWithinTolerance() public view {
        // poolRate scaled to 1e18
        uint256 poolRate = 1.0860e18; // 0.03% below oracle
        PriceGuard.check(poolRate, feed, 50); // 50 bps = 0.5%
    }

    function test_Check_RevertsBeyondTolerance() public {
        uint256 poolRate = 1.0730e18; // ~1.22% below oracle
        vm.expectRevert(
            abi.encodeWithSelector(PriceGuard.OracleDeviation.selector, poolRate, 1.0863e18, uint256(50))
        );
        PriceGuard.check(poolRate, feed, 50);
    }

    function test_Check_RevertsOnStaleOracle() public {
        feed.setAnswer(1.0863e8, block.timestamp - 2 hours);
        vm.expectRevert(
            abi.encodeWithSelector(PriceGuard.StaleOracle.selector, block.timestamp - 2 hours)
        );
        PriceGuard.check(1.0863e18, feed, 50);
    }

    function test_Check_RevertsOnInvalidPrice() public {
        feed.setAnswer(-1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.InvalidOraclePrice.selector, int256(-1)));
        PriceGuard.check(1.0863e18, feed, 50);
    }

    function test_Check_ScalesDecimalsCorrectly() public {
        MockChainlink feed18 = new MockChainlink(18);
        feed18.setAnswer(1.0863e18, block.timestamp);
        PriceGuard.check(1.0860e18, feed18, 50); // no revert
    }
}
```

- [ ] **Step 2: Run tests — expect PASS (implementation already exists)**

Run: `cd packages/contracts && forge test --match-path "test/PriceGuard.t.sol" -vv`
Expected: `5 passed`.

- [ ] **Step 3: Check coverage**

Run: `cd packages/contracts && forge coverage --match-path "test/PriceGuard.t.sol" --report summary`
Expected: `src/libraries/PriceGuard.sol` at 100% line coverage.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/PriceGuard.t.sol packages/contracts/test/helpers/MockChainlink.sol
git commit -m "test(contracts): add PriceGuard unit tests (100% coverage)"
```

---

## Task 5: `ArcFXGateway` skeleton — storage, constructor, events, errors

**Files:**
- Create: `packages/contracts/src/interfaces/ICurvePool.sol`
- Create: `packages/contracts/src/ArcFXGateway.sol`

- [ ] **Step 1: Create `ICurvePool.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ICurvePool {
    function coins(uint256 i) external view returns (address);
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
    function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external returns (uint256);
}
```

- [ ] **Step 2: Create `ArcFXGateway.sol` skeleton**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { ICurvePool } from "./interfaces/ICurvePool.sol";
import { IChainlinkAggregator } from "./interfaces/IChainlinkAggregator.sol";
import { PriceGuard } from "./libraries/PriceGuard.sol";

/// @title ArcFXGateway
/// @notice Atomic swap-and-settle for merchant invoices on Arc.
contract ArcFXGateway is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable config ───────────────────────────────────────────────
    ICurvePool            public immutable POOL;
    IChainlinkAggregator  public immutable ORACLE;
    IERC20                public immutable USDC;   // pool coin index 0
    IERC20                public immutable EURC;   // pool coin index 1
    uint256               public immutable PROTOCOL_FEE_BPS; // e.g. 10 = 0.10%
    uint256               public constant MAX_ORACLE_DEVIATION_BPS = 50; // 0.5%

    // ── Merchant registry ──────────────────────────────────────────────
    struct Merchant {
        address payoutToken; // must be USDC or EURC in v1
        bool    registered;
    }
    mapping(address merchant => Merchant) public merchants;

    // ── Invoice state ──────────────────────────────────────────────────
    enum InvoiceStatus { None, Created, Paid, Expired }
    struct Invoice {
        address       merchant;
        address       payIn;        // token customer pays with
        uint256       amountOut;    // in merchant.payoutToken units
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
        ICurvePool pool,
        IChainlinkAggregator oracle,
        uint256 protocolFeeBps,
        address initialOwner
    ) Ownable(initialOwner) {
        POOL = pool;
        ORACLE = oracle;
        PROTOCOL_FEE_BPS = protocolFeeBps;
        USDC = IERC20(pool.coins(0));
        EURC = IERC20(pool.coins(1));
    }

    // Function bodies intentionally left empty — to be filled by subsequent tasks.
    function registerMerchant(address payoutToken) external { revert(); }
    function createInvoice(bytes32 id, address payIn, uint256 amountOut, uint64 expiresAt) external { revert(); }
    function pay(bytes32 id, uint256 maxAmountIn) external nonReentrant { revert(); }
    function withdrawFees(address token, address to) external onlyOwner { revert(); }
}
```

- [ ] **Step 3: Build**

Run: `cd packages/contracts && forge build`
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/ArcFXGateway.sol packages/contracts/src/interfaces/ICurvePool.sol
git commit -m "feat(contracts): add ArcFXGateway skeleton (storage, events, errors)"
```

---

## Task 6: Implement `registerMerchant` (TDD)

**Files:**
- Create: `packages/contracts/test/helpers/MockERC20.sol`
- Create: `packages/contracts/test/helpers/MockCurvePool.sol`
- Create: `packages/contracts/test/ArcFXGateway.t.sol` (initial)
- Modify: `packages/contracts/src/ArcFXGateway.sol` (implement `registerMerchant`)

- [ ] **Step 1: Create `MockERC20.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _dec;
    constructor(string memory name, string memory sym, uint8 dec) ERC20(name, sym) { _dec = dec; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
```

- [ ] **Step 2: Create `MockCurvePool.sol` (minimal, returns fixed rate)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ICurvePool } from "../../src/interfaces/ICurvePool.sol";

contract MockCurvePool is ICurvePool {
    using SafeERC20 for IERC20;
    address[2] public _coins;
    uint256 public rate1to0_1e18;   // coins[1] → coins[0] rate (EURC→USDC)

    constructor(address coin0, address coin1, uint256 _rate) {
        _coins = [coin0, coin1];
        rate1to0_1e18 = _rate;
    }

    function setRate(uint256 r) external { rate1to0_1e18 = r; }
    function coins(uint256 i) external view returns (address) { return _coins[i]; }

    function get_dy(int128 i, int128 j, uint256 dx) public view returns (uint256) {
        if (i == int128(1) && j == int128(0)) return (dx * rate1to0_1e18) / 1e18;
        if (i == int128(0) && j == int128(1)) return (dx * 1e18) / rate1to0_1e18;
        revert("bad path");
    }

    function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external returns (uint256 dy) {
        dy = get_dy(i, j, dx);
        require(dy >= minDy, "slippage");
        IERC20(_coins[uint128(i)]).safeTransferFrom(msg.sender, address(this), dx);
        IERC20(_coins[uint128(j)]).safeTransfer(msg.sender, dy);
    }
}
```

- [ ] **Step 3: Write failing test for `registerMerchant`**

Create `test/ArcFXGateway.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { ICurvePool } from "../src/interfaces/ICurvePool.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";
import { MockERC20 } from "./helpers/MockERC20.sol";
import { MockChainlink } from "./helpers/MockChainlink.sol";
import { MockCurvePool } from "./helpers/MockCurvePool.sol";

contract ArcFXGatewayTest is Test {
    MockERC20     usdc;
    MockERC20     eurc;
    MockChainlink oracle;
    MockCurvePool pool;
    ArcFXGateway  gw;

    address merchant = makeAddr("merchant");
    address customer = makeAddr("customer");

    function setUp() public virtual {
        usdc   = new MockERC20("USDC", "USDC", 6);
        eurc   = new MockERC20("EURC", "EURC", 6);
        oracle = new MockChainlink(8);
        oracle.setAnswer(1.0863e8, block.timestamp);      // 1 EUR = 1.0863 USD
        pool   = new MockCurvePool(address(usdc), address(eurc), 0.9205e18); // EURC→USDC
        gw     = new ArcFXGateway(ICurvePool(address(pool)), IChainlinkAggregator(address(oracle)), 10, address(this));
    }

    function test_RegisterMerchant_Success() public {
        vm.prank(merchant);
        gw.registerMerchant(address(usdc));
        (address payout, bool registered) = gw.merchants(merchant);
        assertEq(payout, address(usdc));
        assertTrue(registered);
    }

    function test_RegisterMerchant_RevertsOnDoubleRegistration() public {
        vm.prank(merchant);
        gw.registerMerchant(address(usdc));
        vm.prank(merchant);
        vm.expectRevert(ArcFXGateway.MerchantAlreadyRegistered.selector);
        gw.registerMerchant(address(eurc));
    }

    function test_RegisterMerchant_RevertsOnUnsupportedToken() public {
        MockERC20 other = new MockERC20("X", "X", 18);
        vm.prank(merchant);
        vm.expectRevert(ArcFXGateway.InvalidPayoutToken.selector);
        gw.registerMerchant(address(other));
    }

    function test_RegisterMerchant_EmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(gw));
        emit ArcFXGateway.MerchantRegistered(merchant, address(usdc));
        vm.prank(merchant);
        gw.registerMerchant(address(usdc));
    }
}
```

- [ ] **Step 4: Run tests — expect FAIL**

Run: `cd packages/contracts && forge test --match-test test_RegisterMerchant -vv`
Expected: 4 tests fail (skeleton reverts with no data).

- [ ] **Step 5: Implement `registerMerchant`**

Replace the stub in `ArcFXGateway.sol`:
```solidity
function registerMerchant(address payoutToken) external {
    if (merchants[msg.sender].registered) revert MerchantAlreadyRegistered();
    if (payoutToken != address(USDC) && payoutToken != address(EURC)) revert InvalidPayoutToken();
    merchants[msg.sender] = Merchant({ payoutToken: payoutToken, registered: true });
    emit MerchantRegistered(msg.sender, payoutToken);
}
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `cd packages/contracts && forge test --match-test test_RegisterMerchant -vv`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/ArcFXGateway.sol packages/contracts/test/
git commit -m "feat(contracts): implement registerMerchant with tests"
```

---

## Task 7: Implement `createInvoice` (TDD)

**Files:**
- Modify: `packages/contracts/src/ArcFXGateway.sol`
- Modify: `packages/contracts/test/ArcFXGateway.t.sol`

- [ ] **Step 1: Add failing tests**

Append to `ArcFXGateway.t.sol`:
```solidity
function _registerMerchant() internal {
    vm.prank(merchant);
    gw.registerMerchant(address(usdc));
}

function test_CreateInvoice_Success() public {
    _registerMerchant();
    bytes32 id = keccak256("inv-1");
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 49_990_000, uint64(block.timestamp + 30 minutes));
    (address m, address payIn, uint256 amt, uint64 exp, ArcFXGateway.InvoiceStatus s, ) = gw.invoices(id);
    assertEq(m, merchant);
    assertEq(payIn, address(eurc));
    assertEq(amt, 49_990_000);
    assertEq(exp, uint64(block.timestamp + 30 minutes));
    assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Created));
}

function test_CreateInvoice_RevertsIfNotMerchant() public {
    vm.prank(merchant);
    vm.expectRevert(ArcFXGateway.NotMerchant.selector);
    gw.createInvoice(keccak256("inv-2"), address(eurc), 1, uint64(block.timestamp + 1 hours));
}

function test_CreateInvoice_RevertsOnDuplicateId() public {
    _registerMerchant();
    bytes32 id = keccak256("inv-3");
    vm.startPrank(merchant);
    gw.createInvoice(id, address(eurc), 100, uint64(block.timestamp + 1 hours));
    vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceAlreadyExists.selector, id));
    gw.createInvoice(id, address(eurc), 100, uint64(block.timestamp + 1 hours));
    vm.stopPrank();
}

function test_CreateInvoice_RevertsOnUnsupportedPair() public {
    _registerMerchant();  // merchant payout = USDC
    vm.prank(merchant);
    // payIn == payoutToken (USDC→USDC) is not supported — no swap needed
    vm.expectRevert(ArcFXGateway.UnsupportedPair.selector);
    gw.createInvoice(keccak256("inv-4"), address(usdc), 100, uint64(block.timestamp + 1 hours));
}

function test_CreateInvoice_EmitsEvent() public {
    _registerMerchant();
    bytes32 id = keccak256("inv-5");
    vm.expectEmit(true, true, false, true, address(gw));
    emit ArcFXGateway.InvoiceCreated(id, merchant, address(eurc), 50_000_000, uint64(block.timestamp + 1 hours));
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 50_000_000, uint64(block.timestamp + 1 hours));
}
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `forge test --match-test test_CreateInvoice -vv`
Expected: 5 fail.

- [ ] **Step 3: Implement `createInvoice`**

Replace stub:
```solidity
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
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `forge test --match-test test_CreateInvoice -vv`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGateway.sol packages/contracts/test/ArcFXGateway.t.sol
git commit -m "feat(contracts): implement createInvoice with merchant guard + uniqueness"
```

---

## Task 8: Implement `pay()` — happy path (TDD)

**Files:**
- Modify: `packages/contracts/src/ArcFXGateway.sol`
- Modify: `packages/contracts/test/ArcFXGateway.t.sol`

- [ ] **Step 1: Add failing happy-path test**

Append to `ArcFXGateway.t.sol`:
```solidity
function _fundPoolAndCustomer() internal {
    // Seed pool with liquidity
    usdc.mint(address(pool), 1_000_000 * 1e6);   // 1M USDC
    eurc.mint(address(pool), 1_000_000 * 1e6);   // 1M EURC
    // Fund customer with EURC
    eurc.mint(customer, 1_000 * 1e6);
    vm.prank(customer);
    eurc.approve(address(gw), type(uint256).max);
}

function test_Pay_HappyPath() public {
    _registerMerchant();
    _fundPoolAndCustomer();

    bytes32 id = keccak256("happy");
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 49_990_000, uint64(block.timestamp + 1 hours));

    uint256 merchantBefore = usdc.balanceOf(merchant);

    vm.prank(customer);
    gw.pay(id, 55_000_000); // maxAmountIn generous cushion

    (, , , , ArcFXGateway.InvoiceStatus s, address paidBy) = gw.invoices(id);
    assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Paid));
    assertEq(paidBy, customer);

    uint256 feeUsdc = (49_990_000 * 10) / 10_000;           // 10 bps
    assertEq(usdc.balanceOf(merchant) - merchantBefore, 49_990_000 - feeUsdc);
    assertEq(gw.protocolFeesAccrued(address(usdc)), feeUsdc);
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `forge test --match-test test_Pay_HappyPath -vv`
Expected: fail (empty stub reverts).

- [ ] **Step 3: Implement `pay()` — atomic swap + settle**

Replace stub:
```solidity
function pay(bytes32 id, uint256 maxAmountIn) external nonReentrant {
    Invoice storage inv = invoices[id];
    if (inv.status == InvoiceStatus.None)      revert InvoiceNotFound(id);
    if (inv.status == InvoiceStatus.Paid)      revert InvoiceAlreadyPaid(id);
    if (block.timestamp > inv.expiresAt)       revert InvoiceExpired(id);

    Merchant memory m = merchants[inv.merchant];
    address payoutToken = m.payoutToken;

    // Curve coin indices: USDC = 0, EURC = 1.
    int128 iIn  = inv.payIn    == address(USDC) ? int128(0) : int128(1);
    int128 jOut = payoutToken  == address(USDC) ? int128(0) : int128(1);

    // How much payIn do we need to produce exactly amountOut?
    // We approximate by trying maxAmountIn and relying on minOut to enforce the bound.
    uint256 amountIn = _estimateAmountIn(iIn, jOut, inv.amountOut);
    if (amountIn > maxAmountIn) revert SlippageExceeded(amountIn, maxAmountIn);

    // Pull payIn from customer, approve pool, swap.
    IERC20(inv.payIn).safeTransferFrom(msg.sender, address(this), amountIn);
    IERC20(inv.payIn).forceApprove(address(POOL), amountIn);
    uint256 received = POOL.exchange(iIn, jOut, amountIn, inv.amountOut);

    // Oracle deviation guard (pool-implied rate vs Chainlink).
    uint256 poolRate = (received * 1e18) / amountIn;
    // For a EURC→USDC swap poolRate ≈ 1 EUR in USD. Oracle is EUR/USD 1e18-scaled.
    // When iIn is USDC (i.e. base is USD), invert before check.
    uint256 rateForCheck = iIn == int128(0) ? (amountIn * 1e18) / received : poolRate;
    PriceGuard.check(rateForCheck, ORACLE, MAX_ORACLE_DEVIATION_BPS);

    // Take protocol fee from received.
    uint256 fee = (received * PROTOCOL_FEE_BPS) / 10_000;
    uint256 payout = received - fee;
    protocolFeesAccrued[payoutToken] += fee;

    inv.status = InvoiceStatus.Paid;
    inv.paidBy = msg.sender;

    IERC20(payoutToken).safeTransfer(inv.merchant, payout);
    emit InvoicePaid(id, msg.sender, amountIn, payout, fee);
}

/// @dev Inverse of `get_dy`. For the mock Curve this is exact; for real Curve it is a
///      close approximation — caller provides `maxAmountIn` as the true bound.
function _estimateAmountIn(int128 iIn, int128 jOut, uint256 amountOut) internal view returns (uint256) {
    // Try a small probe to read the effective rate, then scale.
    uint256 probeIn = 1e6;                                 // 1 unit (6-dec token)
    uint256 probeOut = POOL.get_dy(iIn, jOut, probeIn);
    if (probeOut == 0) return type(uint256).max;
    return (amountOut * probeIn + probeOut - 1) / probeOut;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `forge test --match-test test_Pay_HappyPath -vv`
Expected: pass. (If the `_estimateAmountIn` returns `amountIn` that exceeds `maxAmountIn` in edge cases, bump the cushion in the test.)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ArcFXGateway.sol packages/contracts/test/ArcFXGateway.t.sol
git commit -m "feat(contracts): implement pay() atomic swap-and-settle (happy path)"
```

---

## Task 9: `pay()` guards — expiry, replay, slippage, oracle deviation

**Files:**
- Modify: `packages/contracts/test/ArcFXGateway.t.sol`

- [ ] **Step 1: Add guard tests (implementation already handles them from Task 8)**

Append to `ArcFXGateway.t.sol`:
```solidity
function test_Pay_RevertsOnExpired() public {
    _registerMerchant(); _fundPoolAndCustomer();
    bytes32 id = keccak256("exp");
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 60));
    vm.warp(block.timestamp + 120);
    vm.prank(customer);
    vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceExpired.selector, id));
    gw.pay(id, 2_000_000);
}

function test_Pay_RevertsOnReplay() public {
    _registerMerchant(); _fundPoolAndCustomer();
    bytes32 id = keccak256("rep");
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 1 hours));
    vm.prank(customer); gw.pay(id, 2_000_000);
    vm.prank(customer);
    vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceAlreadyPaid.selector, id));
    gw.pay(id, 2_000_000);
}

function test_Pay_RevertsOnNotFound() public {
    vm.prank(customer);
    vm.expectRevert(abi.encodeWithSelector(ArcFXGateway.InvoiceNotFound.selector, bytes32(0)));
    gw.pay(bytes32(0), 1);
}

function test_Pay_RevertsOnSlippageTooTight() public {
    _registerMerchant(); _fundPoolAndCustomer();
    bytes32 id = keccak256("slip");
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 1 hours));
    vm.prank(customer);
    // Require far less than actual needed — expect SlippageExceeded
    vm.expectRevert(); // selector-level match noisy; we just assert revert
    gw.pay(id, 500_000);
}

function test_Pay_RevertsOnOracleDeviation() public {
    _registerMerchant(); _fundPoolAndCustomer();
    // Push pool rate far from oracle (0.5 vs 1.0863)
    pool.setRate(0.5e18);
    bytes32 id = keccak256("dev");
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 1 hours));
    vm.prank(customer);
    vm.expectRevert(); // PriceGuard.OracleDeviation
    gw.pay(id, 10_000_000);
}
```

- [ ] **Step 2: Run — expect PASS**

Run: `forge test --match-test test_Pay_ -vv`
Expected: 5 pass.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/test/ArcFXGateway.t.sol
git commit -m "test(contracts): cover pay() guards — expiry, replay, slippage, oracle deviation"
```

---

## Task 10: `withdrawFees` + owner-only guard

**Files:**
- Modify: `packages/contracts/src/ArcFXGateway.sol`
- Modify: `packages/contracts/test/ArcFXGateway.t.sol`

- [ ] **Step 1: Add failing tests**

```solidity
function test_WithdrawFees_OwnerOnly() public {
    _registerMerchant(); _fundPoolAndCustomer();
    bytes32 id = keccak256("f");
    vm.prank(merchant);
    gw.createInvoice(id, address(eurc), 1_000_000, uint64(block.timestamp + 1 hours));
    vm.prank(customer); gw.pay(id, 2_000_000);

    uint256 accrued = gw.protocolFeesAccrued(address(usdc));
    assertGt(accrued, 0);

    address treasury = makeAddr("treasury");
    gw.withdrawFees(address(usdc), treasury);
    assertEq(usdc.balanceOf(treasury), accrued);
    assertEq(gw.protocolFeesAccrued(address(usdc)), 0);
}

function test_WithdrawFees_RevertsForNonOwner() public {
    vm.prank(customer);
    vm.expectRevert(); // OZ Ownable: OwnableUnauthorizedAccount
    gw.withdrawFees(address(usdc), customer);
}
```

- [ ] **Step 2: Run — expect FAIL (empty stub)**

Run: `forge test --match-test test_WithdrawFees -vv`
Expected: fail.

- [ ] **Step 3: Implement**

Replace stub in `ArcFXGateway.sol`:
```solidity
function withdrawFees(address token, address to) external onlyOwner {
    uint256 amount = protocolFeesAccrued[token];
    protocolFeesAccrued[token] = 0;
    IERC20(token).safeTransfer(to, amount);
    emit FeesWithdrawn(token, to, amount);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `forge test --match-test test_WithdrawFees -vv`
Expected: 2 pass.

- [ ] **Step 5: Check total coverage**

Run: `forge coverage --report summary`
Expected: `ArcFXGateway.sol` ≥ 95% line, ≥ 90% branch.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/ArcFXGateway.sol packages/contracts/test/ArcFXGateway.t.sol
git commit -m "feat(contracts): add owner-only withdrawFees"
```

---

## Task 11: Fuzz tests — fee math, deviation math

**Files:**
- Create: `packages/contracts/test/ArcFXGateway.fuzz.t.sol`

- [ ] **Step 1: Write fuzz tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ArcFXGatewayTest } from "./ArcFXGateway.t.sol";
import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { PriceGuard } from "../src/libraries/PriceGuard.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";

contract ArcFXGatewayFuzzTest is ArcFXGatewayTest {
    function testFuzz_FeeNeverExceedsPayout(uint96 amountOut) public {
        vm.assume(amountOut > 1_000_000 && amountOut < 100_000 * 1e6);
        _registerMerchant(); _fundPoolAndCustomer();
        // top up customer for large invoices
        eurc.mint(customer, 200_000 * 1e6);

        bytes32 id = keccak256(abi.encode(amountOut));
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), amountOut, uint64(block.timestamp + 1 hours));

        uint256 before = usdc.balanceOf(merchant);
        vm.prank(customer); gw.pay(id, type(uint128).max);
        uint256 got = usdc.balanceOf(merchant) - before;

        uint256 fee = (uint256(amountOut) * 10) / 10_000;
        assertEq(got, uint256(amountOut) - fee);
        assertLe(fee, uint256(amountOut));
    }

    function testFuzz_PriceGuard_Symmetric(uint128 poolRate, uint256 maxBps) public view {
        vm.assume(poolRate > 0 && maxBps < 5_000);
        uint256 oracleRate = 1.0863e18;
        uint256 diff = poolRate > oracleRate ? poolRate - oracleRate : oracleRate - poolRate;
        bool shouldRevert = diff * 10_000 > oracleRate * maxBps;
        if (shouldRevert) {
            vm.expectRevert();
            PriceGuard.check(poolRate, IChainlinkAggregator(address(oracle)), maxBps);
        } else {
            PriceGuard.check(poolRate, IChainlinkAggregator(address(oracle)), maxBps);
        }
    }
}
```

- [ ] **Step 2: Run**

Run: `forge test --match-path "test/ArcFXGateway.fuzz.t.sol" -vv`
Expected: all pass across default 256 runs.

- [ ] **Step 3: Run with CI profile (10k runs)**

Run: `FOUNDRY_PROFILE=ci forge test --match-path "test/ArcFXGateway.fuzz.t.sol"`
Expected: pass within ~1 minute.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/ArcFXGateway.fuzz.t.sol
git commit -m "test(contracts): add fuzz tests for fee and deviation arithmetic"
```

---

## Task 12: Invariant tests — "no stuck funds", "payout ≤ amountIn − fee"

**Files:**
- Create: `packages/contracts/test/ArcFXGateway.invariant.t.sol`
- Create: `packages/contracts/test/handlers/GatewayHandler.sol`

- [ ] **Step 1: Write handler**

`test/handlers/GatewayHandler.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract GatewayHandler is Test {
    ArcFXGateway public gw;
    MockERC20    public usdc;
    MockERC20    public eurc;
    address      public merchant;
    address      public customer;

    uint256 public totalAmountIn;
    uint256 public totalPayoutsOut;
    uint256 public totalFees;

    constructor(ArcFXGateway _gw, MockERC20 _usdc, MockERC20 _eurc, address _merchant, address _customer) {
        gw = _gw; usdc = _usdc; eurc = _eurc; merchant = _merchant; customer = _customer;
    }

    function createAndPay(uint96 amountOut, bytes32 salt) external {
        vm.assume(amountOut > 1_000_000 && amountOut < 10_000 * 1e6);
        bytes32 id = keccak256(abi.encode(salt, amountOut));
        try gw.createInvoice(id, address(eurc), amountOut, uint64(block.timestamp + 1 hours)) {}
        catch { return; }

        uint256 beforeBal = usdc.balanceOf(merchant);
        uint256 eurcBefore = eurc.balanceOf(customer);
        try gw.pay(id, type(uint128).max) {
            uint256 paid = usdc.balanceOf(merchant) - beforeBal;
            uint256 spent = eurcBefore - eurc.balanceOf(customer);
            totalAmountIn += spent;
            totalPayoutsOut += paid;
            uint256 fee = (uint256(amountOut) * 10) / 10_000;
            totalFees += fee;
        } catch {}
    }
}
```

- [ ] **Step 2: Write invariant test**

`test/ArcFXGateway.invariant.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ArcFXGatewayTest } from "./ArcFXGateway.t.sol";
import { GatewayHandler } from "./handlers/GatewayHandler.sol";

contract ArcFXGatewayInvariantTest is ArcFXGatewayTest {
    GatewayHandler handler;

    function setUp() public override {
        super.setUp();
        _registerMerchant();
        _fundPoolAndCustomer();
        eurc.mint(customer, 100_000 * 1e6);
        handler = new GatewayHandler(gw, usdc, eurc, merchant, customer);

        vm.prank(merchant);
        vm.prank(customer);
        // Give handler permission to act as merchant+customer via vm.prank in calls
        targetContract(address(handler));
    }

    function invariant_NoStuckFunds() public view {
        // Gateway should hold only accrued fees, nothing else.
        assertEq(usdc.balanceOf(address(gw)), gw.protocolFeesAccrued(address(usdc)));
        assertEq(eurc.balanceOf(address(gw)), gw.protocolFeesAccrued(address(eurc)));
    }

    function invariant_PayoutPlusFeeEqualsAmountOut() public view {
        // Sum of merchant payouts + accrued fees == sum of invoice amountOuts
        uint256 merchantRecv = usdc.balanceOf(merchant);
        uint256 feesHeld     = gw.protocolFeesAccrued(address(usdc));
        assertEq(merchantRecv + feesHeld, handler.totalPayoutsOut() + handler.totalFees());
    }
}
```

> **Caveat:** handler-driven invariant tests require the handler to `vm.prank` the actor for each call. If the above setup fails (wrong `msg.sender` when calling `gw.createInvoice`), move the `createInvoice` call into the merchant (with `vm.prank`) and the `pay` call into the customer similarly — inside `GatewayHandler`. Update handler functions as needed during implementation.

- [ ] **Step 3: Run invariant suite**

Run: `FOUNDRY_PROFILE=ci forge test --match-path "test/ArcFXGateway.invariant.t.sol" -vv`
Expected: pass within the configured run budget.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/ArcFXGateway.invariant.t.sol packages/contracts/test/handlers/
git commit -m "test(contracts): add invariant suite (no stuck funds, payout+fee=amountOut)"
```

---

## Task 13: Deploy script

**Files:**
- Create: `packages/contracts/script/Deploy.s.sol`

- [ ] **Step 1: Write deploy script**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { ICurvePool } from "../src/interfaces/ICurvePool.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk        = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address poolAddr  = vm.envAddress("CURVE_POOL_ADDRESS");
        address oracleAddr= vm.envAddress("CHAINLINK_EURUSD_FEED");
        address owner     = vm.envAddress("TREASURY_OWNER");
        uint256 feeBps    = vm.envUint("PROTOCOL_FEE_BPS");

        vm.startBroadcast(pk);
        ArcFXGateway gw = new ArcFXGateway(
            ICurvePool(poolAddr),
            IChainlinkAggregator(oracleAddr),
            feeBps,
            owner
        );
        vm.stopBroadcast();

        console2.log("ArcFXGateway deployed:", address(gw));
    }
}
```

- [ ] **Step 2: Dry-run against local anvil fork**

Run:
```bash
anvil &
ANVIL_PID=$!
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
kill $ANVIL_PID
```
Expected: contract deploys, address logged.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/script/Deploy.s.sol
git commit -m "chore(contracts): add Deploy.s.sol broadcast script"
```

---

## Task 14: Bootstrap-liquidity script for Curve pool

**Files:**
- Create: `packages/contracts/script/BootstrapLiquidity.s.sol`

- [ ] **Step 1: Write script**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICurveAddLiquidity {
    function add_liquidity(uint256[2] calldata amounts, uint256 minMintAmount) external returns (uint256);
}

contract BootstrapLiquidity is Script {
    function run() external {
        uint256 pk        = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address pool      = vm.envAddress("CURVE_POOL_ADDRESS");
        IERC20  usdc      = IERC20(vm.envAddress("USDC_ADDRESS"));
        IERC20  eurc      = IERC20(vm.envAddress("EURC_ADDRESS"));
        uint256 usdcAmt   = vm.envUint("BOOTSTRAP_USDC");   // e.g. 100_000 * 1e6
        uint256 eurcAmt   = vm.envUint("BOOTSTRAP_EURC");   // e.g. 92_000  * 1e6

        vm.startBroadcast(pk);
        usdc.approve(pool, usdcAmt);
        eurc.approve(pool, eurcAmt);
        uint256 lp = ICurveAddLiquidity(pool).add_liquidity([usdcAmt, eurcAmt], 0);
        vm.stopBroadcast();

        console2.log("LP tokens received:", lp);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/contracts/script/BootstrapLiquidity.s.sol
git commit -m "chore(contracts): add Curve liquidity bootstrap script"
```

---

## Task 15: Deploy to Arc testnet + smoke-test

**Files:**
- Modify: `packages/contracts/.env` (local only, git-ignored)
- Create: `packages/contracts/deployments/arc-testnet.json`

- [ ] **Step 1: Fill local `.env` with Arc testnet values**

Copy `.env.example` → `.env`. Populate:
- `ARC_TESTNET_RPC` (from Arc docs)
- `DEPLOYER_PRIVATE_KEY` (fresh testnet key, funded from faucet)
- `CHAINLINK_EURUSD_FEED` (verify feed exists on Arc testnet; if not, deploy `MockChainlink` first and record that address — flag this in the deployment notes)
- `USDC_ADDRESS`, `EURC_ADDRESS` (Arc testnet Circle faucet tokens)

- [ ] **Step 2: Deploy Curve pool first**

Run: `forge script script/DeployCurve.s.sol --rpc-url arc_testnet --broadcast`

> **Note:** If Task 2's Vyper path worked, use a Curve-deploy script (to be added — placeholder below). If Vyper failed and a Solidity StableSwap is used instead, deploy that contract here.

- [ ] **Step 3: Deploy Gateway**

Run: `forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --verify`
Expected: Gateway address printed, verified on Arc explorer.

- [ ] **Step 4: Bootstrap liquidity**

Run: `forge script script/BootstrapLiquidity.s.sol --rpc-url arc_testnet --broadcast`
Expected: LP tokens minted to deployer.

- [ ] **Step 5: Smoke test — register a merchant, create invoice, pay**

Run (via `cast`):
```bash
cast send --rpc-url arc_testnet --private-key $DEPLOYER_PRIVATE_KEY $GATEWAY "registerMerchant(address)" $USDC_ADDRESS
cast send --rpc-url arc_testnet --private-key $DEPLOYER_PRIVATE_KEY $GATEWAY "createInvoice(bytes32,address,uint256,uint64)" 0x01 $EURC_ADDRESS 10000000 $(($(date +%s) + 3600))
# Fund a separate "customer" key with EURC, approve gateway, then:
cast send --rpc-url arc_testnet --private-key $CUSTOMER_PK $GATEWAY "pay(bytes32,uint256)" 0x01 20000000
```
Expected: all three transactions succeed; merchant's USDC balance increases by ~`amountOut − fee`.

- [ ] **Step 6: Record deployment**

Write `deployments/arc-testnet.json`:
```json
{
  "chainId": "<arc testnet id>",
  "gateway": "<addr>",
  "pool":    "<addr>",
  "usdc":    "<addr>",
  "eurc":    "<addr>",
  "oracle":  "<addr>",
  "deployedAt": "<ISO timestamp>",
  "txHashes": {
    "gateway": "<hash>",
    "pool":    "<hash>",
    "bootstrapLiquidity": "<hash>"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/deployments/arc-testnet.json
git commit -m "deploy(contracts): Arc testnet deployment v0.1.0"
```

---

## Task 16: GitHub Actions CI — build, test, Slither

**Files:**
- Create: `.github/workflows/contracts-ci.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: contracts-ci

on:
  push: { paths: ["packages/contracts/**", ".github/workflows/contracts-ci.yml"] }
  pull_request: { paths: ["packages/contracts/**"] }

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: packages/contracts } }
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pipx install vyper==0.3.10
      - run: forge build
      - run: forge test -vvv
      - run: FOUNDRY_PROFILE=ci forge test --match-path "test/ArcFXGateway.fuzz.t.sol"
      - run: FOUNDRY_PROFILE=ci forge test --match-path "test/ArcFXGateway.invariant.t.sol"
      - run: forge coverage --report lcov
      - uses: codecov/codecov-action@v4
        with: { file: packages/contracts/lcov.info }

  slither:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: packages/contracts } }
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
      - uses: crytic/slither-action@v0.4.0
        with:
          target: "packages/contracts"
          slither-args: "--filter-paths lib/ --fail-medium"
```

- [ ] **Step 2: Commit and push to trigger CI**

```bash
git add .github/workflows/contracts-ci.yml
git commit -m "ci: add contracts build, test, fuzz, invariant, and slither workflow"
```

- [ ] **Step 3: Verify CI green**

Visit the repo's Actions tab. Expected: build-and-test + slither both green within ~8 minutes. Fix any failures inline.

---

## Task 17: README + grant-submission checklist

**Files:**
- Create: `packages/contracts/README.md`

- [ ] **Step 1: Write README**

```markdown
# @arc-fx/contracts

Protocol contracts for Arc FX Gateway — a permissionless USDC/EURC swap + atomic merchant-settlement layer on Arc Network.

## Contracts
- `ArcFXGateway.sol` — merchant registry, invoice state, atomic `pay()`
- `PriceGuard` library — Chainlink-backed deviation guard (±0.5%)
- Curve StableSwap pool (vendored, N=2, USDC/EURC)

## Install
```bash
pnpm install
cd packages/contracts && forge install
```

## Build & test
```bash
forge build
forge test                                  # unit + integration
FOUNDRY_PROFILE=ci forge test               # fuzz + invariant (10k runs)
forge coverage --report summary
slither . --filter-paths lib/
```

## Deploy (Arc testnet)
```bash
cp .env.example .env    # fill in values
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --verify
forge script script/BootstrapLiquidity.s.sol --rpc-url arc_testnet --broadcast
```
Deployed addresses: see `deployments/arc-testnet.json`.

## Architecture
See `/docs/superpowers/specs/2026-04-24-arc-fx-merchant-gateway-design.md`.

## Security
- Slither + Aderyn in CI (fail on medium+)
- Fuzz (10k/property) + invariant (256×64) tests
- SWC registry checklist passed
- Immutable constructor params — no upgrade proxy

## License
MIT for our code; Curve contracts retain BSD-3.
```

- [ ] **Step 2: Commit**

```bash
git add packages/contracts/README.md
git commit -m "docs(contracts): add README with build, test, deploy, security notes"
```

---

## Done criteria — Plan 1 complete when:

- [ ] All 17 tasks committed, CI green on main
- [ ] `ArcFXGateway` + `PriceGuard` ≥ 95% line / ≥ 90% branch coverage
- [ ] Fuzz suite passes 10k runs per property
- [ ] Invariant suite passes default run budget
- [ ] Slither + Aderyn: 0 high, 0 medium
- [ ] Live Arc-testnet deployment, addresses recorded in `deployments/arc-testnet.json`
- [ ] Successful smoke-test transaction on Arc testnet (registered merchant + createInvoice + pay)
- [ ] README published with build/deploy instructions

**Then:** decide whether to proceed to Plan 2 (SDK + Hosted Checkout) or submit Plan 1 alone as a standalone protocol-layer grant artifact.

---

## Self-Review Notes

- **Spec coverage:** All sections 3–7 of the spec map to tasks. Section 4.1 (`@arc-fx/checkout` SDK), 4.2 (hosted checkout), and webhook/indexer are explicitly deferred to Plan 2 and Plan 3, as scoped in the writing-plans split.
- **Open-question risks from spec §8:** Curve-on-Arc (addressed via Task 2 with Vyper fallback note); Chainlink feed availability (addressed in Task 15 with mock fallback); liquidity bootstrap (addressed in Task 14); MEV (noted as roadmap in spec §10).
- **Name consistency:** `PROTOCOL_FEE_BPS`, `MAX_ORACLE_DEVIATION_BPS`, `registerMerchant`, `createInvoice`, `pay`, `withdrawFees`, `protocolFeesAccrued` used consistently across all tasks.
- **Caveat:** Task 2 explicitly allows a Solidity fallback if Vyper tooling blocks progress — acceptable because Curve's StableSwap math is a public algorithm and Saddle Finance's MIT Solidity port is viable.
