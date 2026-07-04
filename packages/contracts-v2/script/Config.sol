// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Config — verified per-chain CCTP V2 + USDC addresses for deploy/wiring.
/// @notice Values match packages/router/src/chains.ts (Circle canonical sources).
///         CCTP V2 uses the SAME protocol addresses on every EVM testnet.
library Config {
    // CCTP V2 testnet protocol addresses (identical across EVM testnets).
    address internal constant TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address internal constant MESSAGE_TRANSMITTER_V2 = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    struct Chain {
        uint32 domain;
        address usdc;
        string name;
    }

    /// @dev Resolve chain config by `block.chainid`. Reverts on an unsupported chain.
    function forChainId(uint256 chainId) internal pure returns (Chain memory c) {
        // Arc: USDC is native gas, but the 6-dp ERC-20 at 0x3600…0000 is what CCTP
        // burns/mints and what the escrow holds — works unmodified.
        if (chainId == 5042002) return Chain(26, 0x3600000000000000000000000000000000000000, "Arc Testnet");
        if (chainId == 84532) return Chain(6, 0x036CbD53842c5426634e7929541eC2318f3dCF7e, "Base Sepolia");
        if (chainId == 421614) return Chain(3, 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d, "Arbitrum Sepolia");
        if (chainId == 11155420) return Chain(2, 0x5fd84259d66Cd46123540766Be93DFE6D43130D7, "OP Sepolia");
        if (chainId == 11155111) return Chain(0, 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238, "Ethereum Sepolia");
        if (chainId == 43113) return Chain(1, 0x5425890298aed601595a70AB815c96711a31Bc65, "Avalanche Fuji");
        revert("Config: unsupported chainId");
    }
}
