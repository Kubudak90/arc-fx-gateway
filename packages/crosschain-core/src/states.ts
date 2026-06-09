export const CROSSCHAIN_STATES = [
  "created",
  "authorized",
  "bridge_pending",
  "bridge_confirmed",
  "arc_swap_pending",
  "settle_pending",
  "paid",
  "bridge_failed",
  "arc_swap_failed",
  "settle_failed",
  "refunded",
  "expired",
] as const;

export type CrosschainState = typeof CROSSCHAIN_STATES[number];

const allowed: Record<CrosschainState, readonly CrosschainState[]> = {
  created: ["authorized", "expired"],
  authorized: ["bridge_pending", "expired"],
  bridge_pending: ["bridge_confirmed", "bridge_failed", "expired"],
  bridge_confirmed: ["arc_swap_pending", "settle_pending", "arc_swap_failed"],
  arc_swap_pending: ["settle_pending", "arc_swap_failed"],
  settle_pending: ["paid", "settle_failed"],
  paid: [],
  bridge_failed: ["refunded"],
  arc_swap_failed: ["refunded"],
  settle_failed: ["refunded"],
  refunded: [],
  expired: [],
};

export function assertTransition(from: CrosschainState, to: CrosschainState): void {
  if (!allowed[from].includes(to)) {
    throw new Error(`invalid crosschain transition: ${from} -> ${to}`);
  }
}

export function isTerminalCrosschainState(state: CrosschainState): boolean {
  return allowed[state].length === 0;
}
