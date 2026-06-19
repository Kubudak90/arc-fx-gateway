import { getTestnets, type ChainConfig } from "@arcora/router";

/** Pay-from chains for the v2 checkout: registry testnet chains that actually
 *  have a deployed PaymentEscrow (so a buyer can't pick a chain with no escrow). */
export function payFromChains(): ChainConfig[] {
  return getTestnets().filter((c) => !!c.contracts.paymentEscrow);
}

/** PayoutToken enum index used by PaymentEscrow.DepositParams (USDC=0, EURC=1, USDT=2). */
export const PAYOUT_TOKEN_INDEX: Record<"USDC" | "EURC" | "USDT", number> = {
  USDC: 0,
  EURC: 1,
  USDT: 2,
};
