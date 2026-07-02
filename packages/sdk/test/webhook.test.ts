import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../src/webhook";

// Audit 2026-06-11 H-2: ship a timing-safe verification helper so merchants
// stop hand-rolling (or skipping) signature checks. Format must match the
// webhook daemon's signV2 (ops/webhooks/run.ts): X-Arcora-Signature-V2 =
// "sha256=" + HMAC-SHA256_hex(secret, `${X-Arcora-Timestamp}.${body}`).
const secret = "whsec_test";
const body = '{"event":"invoice.paid"}';
const ts = String(Math.floor(Date.now() / 1000));
const v2sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

describe("verifyWebhook", () => {
  it("accepts a valid V2 signature within tolerance", () => {
    expect(verifyWebhook({ body, secret, signature: v2sig, timestamp: ts })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhook({ body: body + " ", secret, signature: v2sig, timestamp: ts })).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhook({ body, secret: "whsec_other", signature: v2sig, timestamp: ts })).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = "sha256=" + createHmac("sha256", secret).update(`${old}.${body}`).digest("hex");
    expect(verifyWebhook({ body, secret, signature: sig, timestamp: old })).toBe(false);
  });

  it("accepts a stale timestamp when toleranceSeconds allows it", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = "sha256=" + createHmac("sha256", secret).update(`${old}.${body}`).digest("hex");
    expect(verifyWebhook({ body, secret, signature: sig, timestamp: old, toleranceSeconds: 7200 })).toBe(true);
  });

  it("rejects malformed signatures without throwing", () => {
    expect(verifyWebhook({ body, secret, signature: "nope", timestamp: ts })).toBe(false);
  });

  it("rejects a non-numeric timestamp without throwing", () => {
    expect(verifyWebhook({ body, secret, signature: v2sig, timestamp: "not-a-number" })).toBe(false);
  });

  // Audit follow-up: the canonical malicious input is a webhook-shaped POST with NO signature
  // header. `req.headers.get("x-arcora-signature-v2")` returns null when absent, so verifyWebhook
  // must reject (return false), never throw — a throw crashes the merchant's handler (DoS).
  it("returns false (never throws) when the signature header is missing", () => {
    expect(verifyWebhook({ body, secret, signature: null as unknown as string, timestamp: ts })).toBe(false);
    expect(verifyWebhook({ body, secret, signature: undefined as unknown as string, timestamp: ts })).toBe(false);
  });

  it("returns false (never throws) for a missing body, timestamp, or secret", () => {
    expect(verifyWebhook({ body: null as unknown as string, secret, signature: v2sig, timestamp: ts })).toBe(false);
    expect(verifyWebhook({ body, secret, signature: v2sig, timestamp: null as unknown as string })).toBe(false);
    expect(verifyWebhook({ body, secret, signature: v2sig, timestamp: undefined as unknown as string })).toBe(false);
    expect(verifyWebhook({ body, secret: null as unknown as string, signature: v2sig, timestamp: ts })).toBe(false);
  });
});
