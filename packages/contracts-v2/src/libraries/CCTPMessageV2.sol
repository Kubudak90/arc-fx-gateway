// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CCTPMessageV2 — calldata reader for Circle's CCTP V2 wire format.
/// @notice CCTP V2 messages are `abi.encodePacked` fixed-offset bytes (NOT
/// ABI-encoded), so fields are read by calldata slicing. All offsets below are
/// verified against circlefin/evm-cctp-contracts `src/messages/v2/MessageV2.sol`
/// and `BurnMessageV2.sol` (master):
///   header length (MESSAGE_BODY_INDEX) = 148
///   body offsets: mintRecipient 36, amount 68, messageSender 100, hookData 228
/// hookData is a raw dynamic tail (no length prefix) running to the end of the
/// message. `hookData` here is `abi.encode`d by our PaymentEscrow, so the caller
/// can `abi.decode` the slice this returns.
library CCTPMessageV2 {
    uint256 internal constant HEADER_LEN = 148;

    uint256 internal constant ABS_SOURCE_DOMAIN = 4; // header sourceDomain (uint32)
    uint256 internal constant ABS_MINT_RECIPIENT = 184; // 148 + 36
    uint256 internal constant ABS_AMOUNT = 216; // 148 + 68
    uint256 internal constant ABS_MSG_SENDER = 248; // 148 + 100
    uint256 internal constant ABS_HOOK_DATA = 376; // 148 + 228

    error MessageTooShort(uint256 length);

    /// @dev Guard before reading any field — a short/malformed message reverts
    ///      here rather than producing garbage from an out-of-range slice.
    function validate(bytes calldata message) internal pure {
        if (message.length < ABS_HOOK_DATA) revert MessageTooShort(message.length);
    }

    function sourceDomain(bytes calldata message) internal pure returns (uint32) {
        return uint32(bytes4(message[ABS_SOURCE_DOMAIN:ABS_SOURCE_DOMAIN + 4]));
    }

    function mintRecipient(bytes calldata message) internal pure returns (bytes32) {
        return bytes32(message[ABS_MINT_RECIPIENT:ABS_MINT_RECIPIENT + 32]);
    }

    function burnAmount(bytes calldata message) internal pure returns (uint256) {
        return uint256(bytes32(message[ABS_AMOUNT:ABS_AMOUNT + 32]));
    }

    function messageSender(bytes calldata message) internal pure returns (bytes32) {
        return bytes32(message[ABS_MSG_SENDER:ABS_MSG_SENDER + 32]);
    }

    /// @dev hookData runs from offset 376 to the end of the message (may be empty).
    function hookData(bytes calldata message) internal pure returns (bytes calldata) {
        return message[ABS_HOOK_DATA:];
    }
}
