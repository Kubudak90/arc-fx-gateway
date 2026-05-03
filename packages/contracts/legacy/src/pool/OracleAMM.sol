// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IStableSwapPool } from "../interfaces/IStableSwapPool.sol";
import { IChainlinkAggregator } from "../interfaces/IChainlinkAggregator.sol";

/// @title OracleAMM
/// @notice Chainlink-priced two-token AMM. Trades execute at the oracle rate
///         minus a configurable swap fee. No invariant curve — capital
///         efficiency is bounded only by reserves and the oracle's freshness.
/// @dev Tokens are indexed [0] = USDC (base / quote currency for the oracle),
///      [1] = EURC (the asset whose price is given by the oracle in USD terms).
///      Oracle is interpreted as "USD per 1 EUR" (1e18-scaled by the library).
contract OracleAMM is IStableSwapPool, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_STALE_SECONDS = 1 hours;

    // Immutables
    IERC20[2]            internal _tokens;          // [0]=USDC, [1]=EURC
    IChainlinkAggregator public  immutable ORACLE;  // EUR/USD (USD per 1 EUR)
    uint256              public  immutable SWAP_FEE_BPS;
    uint8                public  immutable USDC_DECIMALS;
    uint8                public  immutable EURC_DECIMALS;

    // LP accounting (very simple — proportional shares, USDC-denominated)
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    // Reserves are tracked explicitly so we can detect external transfers.
    uint256 public reserve0; // USDC
    uint256 public reserve1; // EURC

    // Events
    event Swap(address indexed sender, uint8 from, uint8 to, uint256 amountIn, uint256 amountOut, uint256 fee);
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 lpBurned);

    // Errors
    error DeadlinePassed();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error InsufficientReserve(uint256 reserve, uint256 needed);
    error InvalidTokenIndex();
    error InvalidPath();
    error InvalidAmount();
    error InvalidOraclePrice(int256 answer);
    error StaleOracle(uint256 updatedAt);
    error ZeroLiquidity();

    constructor(
        IERC20 usdc,
        IERC20 eurc,
        IChainlinkAggregator oracle,
        uint256 swapFeeBps,
        uint8 usdcDecimals,
        uint8 eurcDecimals
    ) {
        _tokens[0] = usdc;
        _tokens[1] = eurc;
        ORACLE = oracle;
        SWAP_FEE_BPS = swapFeeBps;
        USDC_DECIMALS = usdcDecimals;
        EURC_DECIMALS = eurcDecimals;
    }

    // ── IStableSwapPool ────────────────────────────────────────────────

    function getToken(uint8 i) external view returns (IERC20) {
        if (i > 1) revert InvalidTokenIndex();
        return _tokens[i];
    }

    function getTokenIndex(address t) external view returns (uint8) {
        if (t == address(_tokens[0])) return 0;
        if (t == address(_tokens[1])) return 1;
        revert InvalidTokenIndex();
    }

    function calculateSwap(uint8 i, uint8 j, uint256 dx) public view returns (uint256) {
        return _quote(i, j, dx);
    }

    function swap(uint8 i, uint8 j, uint256 dx, uint256 minDy, uint256 deadline)
        external
        nonReentrant
        returns (uint256 dy)
    {
        if (block.timestamp > deadline) revert DeadlinePassed();
        if (dx == 0)                    revert InvalidAmount();
        if (i > 1 || j > 1 || i == j)   revert InvalidPath();

        dy = _quote(i, j, dx);
        if (dy < minDy) revert InsufficientOutput(dy, minDy);

        // Pull payIn, push payOut.
        _tokens[i].safeTransferFrom(msg.sender, address(this), dx);
        // Update reserves BEFORE transfer so reentrant queries see consistent state.
        if (i == 0) { reserve0 += dx; reserve1 -= dy; }
        else        { reserve1 += dx; reserve0 -= dy; }
        if (j == 0) {
            if (dy > _tokens[0].balanceOf(address(this))) revert InsufficientReserve(_tokens[0].balanceOf(address(this)), dy);
        } else {
            if (dy > _tokens[1].balanceOf(address(this))) revert InsufficientReserve(_tokens[1].balanceOf(address(this)), dy);
        }
        _tokens[j].safeTransfer(msg.sender, dy);

        // Compute fee in payIn units for event reporting.
        uint256 grossOut = _quoteRaw(i, j, dx);
        uint256 feeOut = grossOut > dy ? grossOut - dy : 0;
        emit Swap(msg.sender, i, j, dx, dy, feeOut);
    }

    // ── Liquidity ─────────────────────────────────────────────────────

    /// @notice Add liquidity. Tokens are pulled in the order [USDC, EURC].
    /// @dev Shares are minted proportional to the USDC-denominated value of
    ///      the deposit. First deposit sets the share-to-value ratio at 1:1.
    function addLiquidity(uint256[] calldata amounts, uint256 minLP, uint256 deadline)
        external
        nonReentrant
        returns (uint256 lpMinted)
    {
        if (block.timestamp > deadline) revert DeadlinePassed();
        if (amounts.length != 2)        revert InvalidAmount();
        if (amounts[0] == 0 && amounts[1] == 0) revert InvalidAmount();

        uint256 oracleRate = _readOracle1e18();

        // Deposited value in USDC equivalent.
        uint256 depositValue = amounts[0] + (amounts[1] * oracleRate) / 1e18;

        if (totalSupply == 0) {
            lpMinted = depositValue;
        } else {
            uint256 currentValue = reserve0 + (reserve1 * oracleRate) / 1e18;
            if (currentValue == 0) {
                lpMinted = depositValue;
            } else {
                lpMinted = (depositValue * totalSupply) / currentValue;
            }
        }
        if (lpMinted == 0)         revert ZeroLiquidity();
        if (lpMinted < minLP)      revert InsufficientOutput(lpMinted, minLP);

        if (amounts[0] > 0) _tokens[0].safeTransferFrom(msg.sender, address(this), amounts[0]);
        if (amounts[1] > 0) _tokens[1].safeTransferFrom(msg.sender, address(this), amounts[1]);
        reserve0 += amounts[0];
        reserve1 += amounts[1];

        balanceOf[msg.sender] += lpMinted;
        totalSupply += lpMinted;

        emit LiquidityAdded(msg.sender, amounts[0], amounts[1], lpMinted);
    }

    /// @notice Remove liquidity. Returns the proportional amount of each reserve.
    function removeLiquidity(uint256 lpAmount, uint256[] calldata minAmounts, uint256 deadline)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (block.timestamp > deadline) revert DeadlinePassed();
        if (lpAmount == 0)              revert InvalidAmount();
        if (minAmounts.length != 2)     revert InvalidAmount();
        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0)          revert ZeroLiquidity();

        amounts = new uint256[](2);
        amounts[0] = (reserve0 * lpAmount) / _totalSupply;
        amounts[1] = (reserve1 * lpAmount) / _totalSupply;
        if (amounts[0] < minAmounts[0]) revert InsufficientOutput(amounts[0], minAmounts[0]);
        if (amounts[1] < minAmounts[1]) revert InsufficientOutput(amounts[1], minAmounts[1]);

        balanceOf[msg.sender] -= lpAmount;
        totalSupply = _totalSupply - lpAmount;
        reserve0 -= amounts[0];
        reserve1 -= amounts[1];

        if (amounts[0] > 0) _tokens[0].safeTransfer(msg.sender, amounts[0]);
        if (amounts[1] > 0) _tokens[1].safeTransfer(msg.sender, amounts[1]);

        emit LiquidityRemoved(msg.sender, amounts[0], amounts[1], lpAmount);
    }

    // ── Internal pricing ─────────────────────────────────────────────

    /// @dev Returns 1e18-scaled "USD per 1 EUR" from the Chainlink feed.
    function _readOracle1e18() internal view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = ORACLE.latestRoundData();
        if (answer <= 0) revert InvalidOraclePrice(answer);
        if (block.timestamp - updatedAt > MAX_STALE_SECONDS) revert StaleOracle(updatedAt);
        uint8 dec = ORACLE.decimals();
        if (dec == 18) return uint256(answer);
        if (dec < 18)  return uint256(answer) * (10 ** (18 - dec));
        return uint256(answer) / (10 ** (dec - 18));
    }

    /// @dev Gross output (no fee). Used for event reporting only.
    function _quoteRaw(uint8 i, uint8 j, uint256 dx) internal view returns (uint256) {
        if (i == j || i > 1 || j > 1) revert InvalidPath();
        uint256 rate = _readOracle1e18();
        // EURC (i=1) → USDC (j=0): dx * rate / 1e18
        // USDC (i=0) → EURC (j=1): dx * 1e18 / rate
        if (i == 1 && j == 0) return (dx * rate) / 1e18;
        if (i == 0 && j == 1) return (dx * 1e18) / rate;
        revert InvalidPath();
    }

    /// @dev Net output after applying SWAP_FEE_BPS as a haircut on the gross output.
    function _quote(uint8 i, uint8 j, uint256 dx) internal view returns (uint256) {
        uint256 gross = _quoteRaw(i, j, dx);
        uint256 fee   = (gross * SWAP_FEE_BPS) / BPS;
        return gross - fee;
    }
}
