// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMessageTransmitterV2 — receive side of Circle's CCTP V2.
/// @notice `receiveMessage` verifies the attestation, then routes to the message
/// recipient (the canonical destination TokenMessengerV2) which mints USDC to the
/// `mintRecipient` encoded in the burn message. If the original burn set a
/// non-zero `destinationCaller`, `receiveMessage` requires `msg.sender` to equal
/// it — which is how SettlementReceiver restricts who can complete the transfer
/// (it calls `receiveMessage` itself). Signature verified against
/// circlefin/evm-cctp-contracts `src/v2/MessageTransmitterV2.sol` (master).
interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation)
        external
        returns (bool success);

    function localDomain() external view returns (uint32);
}
