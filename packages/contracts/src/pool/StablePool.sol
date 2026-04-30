// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable }           from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step }      from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IStablePool }           from "./IStablePool.sol";
import { IStablecoinRegistry }   from "../registry/IStablecoinRegistry.sol";

/// @title StablePool
/// @notice Singleton oracle-priced shared-vault stablecoin pool.
/// @dev No pairs, no curve. `reserves[token]` per-token; swap rate = price[in] / price[out].
contract StablePool is IStablePool, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 internal constant MAX_SWAP_FEE_BPS = 50;

    IStablecoinRegistry public immutable REGISTRY;

    mapping(address token => uint256) public override reserves;
    mapping(address token => uint256) public override protocolFeesAccrued;

    uint16 public override swapFeeBps;
    bool   public override paused;

    constructor(address registry, uint16 initialSwapFeeBps, address initialOwner) Ownable(initialOwner) {
        REGISTRY = IStablecoinRegistry(registry);
        if (initialSwapFeeBps > MAX_SWAP_FEE_BPS) revert InvalidFeeBps(initialSwapFeeBps);
        swapFeeBps = initialSwapFeeBps;
    }

    // ── modifiers ─────────────────────────────────────────────────────

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    // ── owner: liquidity ──────────────────────────────────────────────

    function deposit(address token, uint256 amount) external override onlyOwner whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!REGISTRY.isActive(token)) revert TokenNotActive(token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        reserves[token] += amount;
        emit LiquidityDeposited(token, amount, reserves[token]);
    }

    function withdraw(address token, uint256 amount, address to) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 r = reserves[token];
        if (amount > r) revert InsufficientLiquidity(token, amount, r);
        reserves[token] = r - amount;
        IERC20(token).safeTransfer(to, amount);
        emit LiquidityWithdrawn(token, amount, reserves[token]);
    }

    function withdrawProtocolFees(address token, uint256 amount, address to) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 accrued = protocolFeesAccrued[token];
        if (amount > accrued) revert InsufficientLiquidity(token, amount, accrued);
        protocolFeesAccrued[token] = accrued - amount;
        IERC20(token).safeTransfer(to, amount);
    }

    // ── owner: parameters ────────────────────────────────────────────

    function setSwapFeeBps(uint16 newBps) external override onlyOwner {
        if (newBps > MAX_SWAP_FEE_BPS) revert InvalidFeeBps(newBps);
        emit SwapFeeUpdated(swapFeeBps, newBps);
        swapFeeBps = newBps;
    }

    function pause() external override onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external override onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ── pricing helpers ──────────────────────────────────────────────

    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_STALE_SECONDS = 1 hours;

    /// @dev Reads `tokenInfo` and the oracle, returns 1e18-scaled USD price.
    function _readUsdPrice1e18(address token)
        internal
        view
        returns (uint256 price1e18, IStablecoinRegistry.TokenInfo memory info)
    {
        info = REGISTRY.tokenInfo(token);
        if (!info.isActive) revert TokenNotActive(token);
        (, int256 answer, , uint256 updatedAt, ) = info.usdOracle.latestRoundData();
        if (answer <= 0) revert PriceDeviation(token, 0, 0, info.maxOracleDeviationBps);
        if (block.timestamp - updatedAt > MAX_STALE_SECONDS) {
            revert PriceDeviation(token, uint256(answer), updatedAt, info.maxOracleDeviationBps);
        }
        uint8 dec = info.usdOracle.decimals();
        if (dec == 18)      price1e18 = uint256(answer);
        else if (dec < 18)  price1e18 = uint256(answer) * (10 ** (18 - dec));
        else                price1e18 = uint256(answer) / (10 ** (dec - 18));
    }

    /// @dev Pure conversion: amountIn * priceIn / priceOut, scaled across decimals.
    function _grossOut(
        uint256 amountIn,
        uint256 priceIn1e18,
        uint256 priceOut1e18,
        uint8   decimalsIn,
        uint8   decimalsOut
    ) internal pure returns (uint256) {
        uint256 usdValue1e18 = (amountIn * priceIn1e18) / (10 ** decimalsIn);
        return (usdValue1e18 * (10 ** decimalsOut)) / priceOut1e18;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        override
        returns (uint256 amountOut)
    {
        if (tokenIn == tokenOut) revert SameToken(tokenIn);
        if (amountIn == 0)       revert ZeroAmount();

        (uint256 pIn,  IStablecoinRegistry.TokenInfo memory iIn)  = _readUsdPrice1e18(tokenIn);
        (uint256 pOut, IStablecoinRegistry.TokenInfo memory iOut) = _readUsdPrice1e18(tokenOut);

        uint256 gross = _grossOut(amountIn, pIn, pOut, iIn.decimals, iOut.decimals);
        uint256 fee   = (gross * swapFeeBps) / BPS;
        amountOut     = gross - fee;
    }

    function swap(address, address, uint256, uint256, uint256, address) external override returns (uint256) {
        revert("not implemented");
    }
}
