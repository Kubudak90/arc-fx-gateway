// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PaymentEscrow} from "../src/PaymentEscrow.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {Config} from "./Config.sol";

/// @notice Deploy PaymentEscrow + SettlementReceiver on the current chain.
///         Run per chain (Phase 3 targets ≥3 CCTP V2 testnets), then wire them
///         together cross-chain with Wire.s.sol.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
///
/// Env:
///   DEPLOYER_PRIVATE_KEY   deployer/owner key (burner)
///   REFUND_WINDOW          seconds (default 300)
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 refundWindow = vm.envOr("REFUND_WINDOW", uint256(300));
        address owner = vm.addr(pk);
        Config.Chain memory c = Config.forChainId(block.chainid);

        console2.log("Deploying to", c.name);
        console2.log("  domain", c.domain);
        console2.log("  usdc", c.usdc);
        console2.log("  owner", owner);

        vm.startBroadcast(pk);

        PaymentEscrow escrow =
            new PaymentEscrow(c.domain, c.usdc, Config.TOKEN_MESSENGER_V2, refundWindow, owner);

        SettlementReceiver receiver = new SettlementReceiver(
            c.domain, c.usdc, Config.MESSAGE_TRANSMITTER_V2, Config.TOKEN_MESSENGER_V2, owner
        );

        vm.stopBroadcast();

        console2.log("PaymentEscrow    ", address(escrow));
        console2.log("SettlementReceiver", address(receiver));
        console2.log("");
        console2.log("Next: record these in chains.ts and run Wire.s.sol on each chain.");
    }
}
