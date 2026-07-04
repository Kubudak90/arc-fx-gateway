import { createHmac, timingSafeEqual } from "node:crypto";

// DEPRECATED / UNUSED — body-only signature (no timestamp). A captured
// (body, sig) pair is replayable forever. The LIVE webhook dispatcher does NOT
// use this module at all: `ops/webhooks/run.ts` defines its own `sign`/`signV2`
// and emits the timestamped scheme (`X-Arcora-Signature-V2` = HMAC over
// `<ts>.<body>` + `X-Arcora-Timestamp`), which the SDK's `verifyWebhook` checks
// against a replay window. This helper has no non-test callers — DO NOT wire
// its body-only signature into any signing path. (Audit LOW 2026-07-05: the
// timestamped scheme this finding asked for already ships via Ops-M2.)
export function signWebhook(body: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${mac}`;
}

export function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expected = signWebhook(body, secret);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
