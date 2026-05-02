import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveComplianceProvider } from "./factory";
import { NoopProvider } from "./noop";
import { EllipticProvider } from "./elliptic";
import { TRMLabsProvider } from "./trmlabs";

const ENV_KEYS = ["COMPLIANCE_PROVIDER", "COMPLIANCE_API_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveComplianceProvider", () => {
  it("defaults to Noop when env is unset", () => {
    expect(resolveComplianceProvider()).toBeInstanceOf(NoopProvider);
  });

  it("returns Noop when COMPLIANCE_PROVIDER=noop", () => {
    process.env.COMPLIANCE_PROVIDER = "noop";
    expect(resolveComplianceProvider()).toBeInstanceOf(NoopProvider);
  });

  it("returns Elliptic when configured with key", () => {
    process.env.COMPLIANCE_PROVIDER = "elliptic";
    process.env.COMPLIANCE_API_KEY = "k";
    expect(resolveComplianceProvider()).toBeInstanceOf(EllipticProvider);
  });

  it("returns TRM when configured with key", () => {
    process.env.COMPLIANCE_PROVIDER = "trmlabs";
    process.env.COMPLIANCE_API_KEY = "k";
    expect(resolveComplianceProvider()).toBeInstanceOf(TRMLabsProvider);
  });

  it("throws when a real provider is selected without an API key", () => {
    process.env.COMPLIANCE_PROVIDER = "elliptic";
    expect(() => resolveComplianceProvider()).toThrow(/config_required/i);
  });

  it("rejects unknown provider names", () => {
    process.env.COMPLIANCE_PROVIDER = "chainalysis";
    expect(() => resolveComplianceProvider()).toThrow(/unknown_provider/i);
  });
});
