import type { ComplianceProvider } from "./provider";
import { NoopProvider } from "./noop";
import { EllipticProvider } from "./elliptic";
import { TRMLabsProvider } from "./trmlabs";

/**
 * Resolve the active compliance provider from env. Default `noop`. A real
 * provider selection without an API key throws `config_required` at startup
 * so a misconfigured deploy fails fast instead of allowing every screen.
 *
 * Env:
 *   COMPLIANCE_PROVIDER  noop | elliptic | trmlabs   (default: noop)
 *   COMPLIANCE_API_KEY   provider-specific secret    (required for non-noop)
 */
export function resolveComplianceProvider(): ComplianceProvider {
  const name = (process.env.COMPLIANCE_PROVIDER ?? "noop").toLowerCase();
  const apiKey = process.env.COMPLIANCE_API_KEY ?? "";

  switch (name) {
    case "noop":
      return new NoopProvider();
    case "elliptic":
      return new EllipticProvider({ apiKey, asset: process.env.ELLIPTIC_ASSET });
    case "trmlabs":
      return new TRMLabsProvider({ apiKey });
    default:
      throw new Error(`unknown_provider: ${name}`);
  }
}
