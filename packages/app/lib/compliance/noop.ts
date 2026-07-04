import type { ComplianceProvider } from "./provider";
import type { ScreeningContext, ScreeningResult } from "./types";

// Audit M5 (2026-07-04): the noop provider allows every address, so a deploy
// running it has NO sanctions screening — and that was silent, which was the
// finding's core complaint ("no runtime signal that screening is off"). Emit one
// loud startup line so an operator can tell from logs alone that screening is
// disabled. The hard fail-closed posture for mainnet is still gated on
// COMPLIANCE_REQUIRED=true (forbids noop, see factory.ts); this warning covers
// the "forgot to set it" gap. Suppressed under NODE_ENV=test to keep suites quiet.
let noopWarned = false;

/**
 * Always returns `risk: "low"`. The default provider on testnet, in tests,
 * and any environment where `COMPLIANCE_PROVIDER` is unset. Mainnet Phase 0
 * runs this everywhere too — phase flips swap it for a real adapter via env.
 */
export class NoopProvider implements ComplianceProvider {
  readonly name = "noop" as const;

  constructor() {
    if (!noopWarned && process.env.NODE_ENV !== "test") {
      noopWarned = true;
      console.warn(
        "[compliance] WARNING: noop provider active — NO sanctions screening; every address is allowed. " +
          "Set COMPLIANCE_PROVIDER=elliptic|trmlabs and COMPLIANCE_REQUIRED=true to enforce.",
      );
    }
  }

  async screenAddress(
    address: string,
    context: ScreeningContext,
  ): Promise<ScreeningResult> {
    return {
      risk: "low",
      reasons: [],
      providerSnapshot: { provider: "noop", address, context },
      cachedAt: new Date(),
      ttlSeconds: 24 * 3600,
    };
  }
}
