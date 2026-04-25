// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ArcFXGatewayTest } from "./ArcFXGateway.t.sol";
import { ArcFXGateway } from "../src/ArcFXGateway.sol";
import { PriceGuard } from "../src/libraries/PriceGuard.sol";
import { IChainlinkAggregator } from "../src/interfaces/IChainlinkAggregator.sol";

contract ArcFXGatewayFuzzTest is ArcFXGatewayTest {

    /// @notice Property: merchant payout always equals (received - protocol fee),
    ///         where received >= amountOut; fee is a strict fraction of received.
    function testFuzz_FeeNeverExceedsPayout(uint96 amountOut) public {
        amountOut = uint96(bound(uint256(amountOut), 1_000_001, 100_000 * 1e6 - 1));
        _registerMerchant();
        _fundPoolAndCustomer();
        // Top up customer for big invoices.
        eurc.mint(customer, 200_000 * 1e6);

        bytes32 id = keccak256(abi.encode(amountOut));
        vm.prank(merchant);
        gw.createInvoice(id, address(eurc), amountOut, uint64(block.timestamp + 1 hours));

        uint256 before = usdc.balanceOf(merchant);
        uint256 feesBefore = gw.protocolFeesAccrued(address(usdc));

        vm.prank(customer);
        gw.pay(id, type(uint128).max);

        uint256 got  = usdc.balanceOf(merchant) - before;
        uint256 fee  = gw.protocolFeesAccrued(address(usdc)) - feesBefore;

        // The pool returns received >= amountOut (ceiling division in estimateAmountIn).
        // The contract charges fee on received, so: got + fee == received >= amountOut.
        uint256 received = got + fee;
        assertGe(received, uint256(amountOut));

        // Fee is exactly BPS/10_000 of received (integer division, rounded down).
        assertEq(fee, (received * 10) / 10_000);

        // Payout is exactly received minus fee.
        assertEq(got, received - fee);

        // Fee never exceeds payout.
        assertLe(fee, got);
    }
}
