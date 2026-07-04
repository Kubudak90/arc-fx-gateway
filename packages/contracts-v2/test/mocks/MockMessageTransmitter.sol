// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {CCTPMessageV2} from "../../src/libraries/CCTPMessageV2.sol";

/// Stand-in for MessageTransmitterV2. On `receiveMessage` it reads the
/// mintRecipient from the (correctly-formatted) message and mints `mintAmount`
/// USDC to it — simulating the canonical mint that lands in SettlementReceiver.
/// `mintAmount` is set per-test so the fee-adjusted (amount - fee) behaviour can
/// be exercised independently of the message's `amount` field.
contract MockMessageTransmitter {
    using CCTPMessageV2 for bytes;

    MockERC20 public immutable usdc;
    uint256 public mintAmount;
    bool public returnFalse;

    constructor(MockERC20 _usdc) {
        usdc = _usdc;
    }

    function setMintAmount(uint256 a) external {
        mintAmount = a;
    }

    function setReturnFalse(bool v) external {
        returnFalse = v;
    }

    function receiveMessage(bytes calldata message, bytes calldata) external returns (bool) {
        if (returnFalse) return false;
        address recipient = address(uint160(uint256(message.mintRecipient())));
        usdc.mint(recipient, mintAmount);
        return true;
    }

    function localDomain() external pure returns (uint32) {
        return 0;
    }
}
