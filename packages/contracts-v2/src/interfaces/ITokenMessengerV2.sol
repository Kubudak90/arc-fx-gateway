// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITokenMessengerV2 — burn side of Circle's CCTP V2.
/// @notice Signatures verified verbatim against
/// circlefin/evm-cctp-contracts `src/v2/TokenMessengerV2.sol` (master).
/// `mintRecipient` and `destinationCaller` are bytes32 (left-pad an EVM address).
/// `destinationCaller == bytes32(0)` lets anyone submit receiveMessage on the dest.
/// Neither burn function returns a value (V2 differs from V1's uint64 nonce).
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;

    /// @notice On-chain Fast-Transfer fee for `amount`. Pass `maxFee >=` this for Fast.
    function getMinFeeAmount(uint256 amount) external view returns (uint256);
}
