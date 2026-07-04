// Merchant payout-chain OUT-hop config parsing + validation (Phase 5).
// Pure helpers extracted from run.ts so the flag-gating logic is unit-tested
// (run.ts itself fetches the Vault key at module load and can't be imported in
// a test). Mirrors the gateway-allowlist.ts extraction pattern.
import type { ChainRegistry } from "@arcora/crosschain-core";

/** Parse the comma-separated CROSSCHAIN_ENABLED_PAYOUT_CHAINS flag into a set of
 *  target chain ids. Empty/unset → an empty set (the payout worker is DISABLED
 *  and the relayer loop is unchanged). Throws on a non-numeric/non-positive
 *  entry so a typo fails fast at boot instead of silently disabling a chain. */
export function parsePayoutChains(raw: string | undefined): ReadonlySet<number> {
  if (!raw || raw.trim() === "") return new Set();
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`invalid CROSSCHAIN_ENABLED_PAYOUT_CHAINS entry: ${s}`);
      }
      return n;
    });
  return new Set(ids);
}

/** Boot-time validation: every enabled payout chain must be a known, non-Arc
 *  chain present in the cross-chain registry (which itself requires
 *  CROSSCHAIN_ENABLED). Throws with a specific message on the first offender so
 *  a misconfigured payout chain never strands a payout at runtime. No-op when
 *  the set is empty (worker disabled).
 *
 *  `arcChainId` is the source chain (Arc) — the OUT hop must LEAVE Arc, so Arc
 *  itself can't be a payout target. */
export function assertEnabledPayoutChains(args: {
  enabled: ReadonlySet<number>;
  registry: ChainRegistry | null;
  arcChainId: number;
}): void {
  if (args.enabled.size === 0) return;
  if (!args.registry) {
    throw new Error(
      "CROSSCHAIN_ENABLED_PAYOUT_CHAINS set but the cross-chain registry is unavailable " +
      "(CROSSCHAIN_ENABLED must be true)",
    );
  }
  for (const chainId of args.enabled) {
    if (chainId === args.arcChainId) {
      throw new Error(`CROSSCHAIN_ENABLED_PAYOUT_CHAINS may not include Arc (${chainId}) — the OUT hop must leave Arc`);
    }
    const cfg = args.registry.get(chainId);
    if (!cfg) {
      throw new Error(`CROSSCHAIN_ENABLED_PAYOUT_CHAINS chain ${chainId} not in the cross-chain registry`);
    }
    if (cfg.key === "arc-testnet") {
      throw new Error(`CROSSCHAIN_ENABLED_PAYOUT_CHAINS may not include Arc (${chainId}) — the OUT hop must leave Arc`);
    }
  }
}
