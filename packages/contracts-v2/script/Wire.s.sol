// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PaymentEscrow} from "../src/PaymentEscrow.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {Config} from "./Config.sol";

/// @notice Cross-chain wiring, run on EACH chain AFTER all chains are deployed.
///         Tells this chain's PaymentEscrow where every peer SettlementReceiver
///         lives, and tells this chain's SettlementReceiver which peer escrow is
///         trusted to drive its payouts. Also sets local EURC / Li.Fi / keeper.
///
/// Env (this chain):
///   DEPLOYER_PRIVATE_KEY        owner key
///   PAYMENT_ESCROW              this chain's PaymentEscrow
///   SETTLEMENT_RECEIVER         this chain's SettlementReceiver
/// Env (peers, per CCTP domain d in {0,1,2,3,6}):
///   RECEIVER_<d>                peer SettlementReceiver on domain d
///   ESCROW_<d>                  peer PaymentEscrow on domain d
/// Env (optional):
///   EURC_LOCAL, LIFI_ROUTER, KEEPER
contract Wire is Script {
    uint32[6] internal DOMAINS = [uint32(0), 1, 2, 3, 6, 26];

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        PaymentEscrow escrow = PaymentEscrow(vm.envAddress("PAYMENT_ESCROW"));
        SettlementReceiver receiver = SettlementReceiver(vm.envAddress("SETTLEMENT_RECEIVER"));
        Config.Chain memory self = Config.forChainId(block.chainid);

        vm.startBroadcast(pk);

        for (uint256 i = 0; i < DOMAINS.length; i++) {
            uint32 d = DOMAINS[i];
            if (d == self.domain) continue;

            address peerReceiver = vm.envOr(string.concat("RECEIVER_", vm.toString(d)), address(0));
            address peerEscrow = vm.envOr(string.concat("ESCROW_", vm.toString(d)), address(0));

            if (peerReceiver != address(0)) {
                escrow.setSettlementReceiver(d, _b32(peerReceiver));
                console2.log("escrow.settlementReceiver[d] set", d, peerReceiver);
            }
            if (peerEscrow != address(0)) {
                receiver.setTrustedEscrow(d, _b32(peerEscrow));
                console2.log("receiver.trustedEscrow[d] set", d, peerEscrow);
            }
        }

        address eurc = vm.envOr("EURC_LOCAL", address(0));
        if (eurc != address(0)) {
            escrow.setLocalToken(PaymentEscrow.PayoutToken.EURC, eurc);
            receiver.setLocalToken(SettlementReceiver.PayoutToken.EURC, eurc);
        }
        address lifi = vm.envOr("LIFI_ROUTER", address(0));
        if (lifi != address(0)) {
            escrow.setLifiRouter(lifi);
            receiver.setLifiRouter(lifi);
        }
        address keeper = vm.envOr("KEEPER", address(0));
        if (keeper != address(0)) {
            escrow.setKeeper(keeper);
            receiver.setKeeper(keeper);
        }

        // Protocol fee: skimmed in USDC at settle on the escrow chain.
        address feeRecipient = vm.envOr("FEE_RECIPIENT", address(0));
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(0));
        if (feeRecipient != address(0)) {
            escrow.setFeeConfig(feeRecipient, uint16(feeBps));
            console2.log("escrow.feeConfig set", feeRecipient, feeBps);
        }

        vm.stopBroadcast();
        console2.log("Wiring complete on", self.name);
    }

    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }
}
