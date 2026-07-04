import { chainById, type ChainRegistry, type CctpChainConfig, type TokenConfig, type ChainKey } from "./chains";

/**
 * OUT hop (merchant payout-chain): the mirror of {@link planCrosschainRoute}.
 * The IN hop bridges any CCTP chain → Arc; this bridges Arc → the merchant's
 * chosen target chain. The relayer holds the merchant's settled USDC on Arc
 * (claimed from escrow into its sweep address), burns it on Arc's
 * TokenMessenger, and mints to the merchant's external address on the target.
 *
 * USDC-only (Plan 7): the burn token is always Arc USDC. EURC merchants stay
 * Arc-only for v1 — there is no payout-token routing here.
 */
export interface PlannedPayoutRoute {
  source: CctpChainConfig;
  destination: CctpChainConfig;
  sourceDomain: number;
  destinationDomain: number;
  /** Always Arc USDC — the relayer burns the merchant's bridged USDC on Arc. */
  burnToken: TokenConfig;
  /** The chain the minted USDC lands on (the merchant's payout chain). */
  mintRecipientChain: ChainKey;
  amount: bigint;
}

export function planPayoutRoute(args: {
  registry: ChainRegistry;
  sourceArc: number;
  destinationChainId: number;
  amount: bigint;
  enabledTargetChains: readonly number[];
}): PlannedPayoutRoute {
  const source = chainById(args.registry, args.sourceArc);
  if (source.key !== "arc-testnet") throw new Error(`source must be arc, got: ${args.sourceArc}`);
  if (args.destinationChainId === args.sourceArc) {
    throw new Error(`destination must not be arc (the OUT hop must leave Arc): ${args.destinationChainId}`);
  }
  if (!args.enabledTargetChains.includes(args.destinationChainId)) {
    throw new Error(`destination chain disabled: ${args.destinationChainId}`);
  }
  if (args.amount <= 0n) {
    throw new Error("amount must be positive");
  }

  const destination = chainById(args.registry, args.destinationChainId);
  if (destination.key === "arc-testnet") {
    throw new Error("destination must not be arc (the OUT hop must leave Arc)");
  }

  return {
    source,
    destination,
    sourceDomain: source.cctpDomain,
    destinationDomain: destination.cctpDomain,
    burnToken: source.tokens.USDC,
    mintRecipientChain: destination.key,
    amount: args.amount,
  };
}
