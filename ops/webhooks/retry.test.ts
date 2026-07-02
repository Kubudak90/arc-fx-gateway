import { describe, it, expect } from "vitest";
import { webhookRetryDecision } from "./retry";

const cfg = { terminal4xxAfter: 3, maxAttempts: 5, maxBackoffHours: 24 };

describe("webhookRetryDecision", () => {
  it("keeps retrying a 5xx below the attempt cap, with the 2^attempts*30 backoff", () => {
    expect(webhookRetryDecision(1, 503, cfg)).toEqual({ terminal: false, backoffSec: 60 });
    expect(webhookRetryDecision(2, 503, cfg)).toEqual({ terminal: false, backoffSec: 120 });
    expect(webhookRetryDecision(4, 500, cfg)).toEqual({ terminal: false, backoffSec: 480 });
  });

  it("STOPS retrying a 5xx/network failure once the attempt cap is reached (max_attempts)", () => {
    // this is the gap: previously 5xx/network retried forever
    expect(webhookRetryDecision(5, 503, cfg)).toEqual({ terminal: true, reason: "max_attempts" });
    expect(webhookRetryDecision(6, 0, cfg)).toEqual({ terminal: true, reason: "max_attempts" }); // network error, status 0
  });

  it("terminates a persistent 4xx after terminal4xxAfter attempts (before the cap)", () => {
    expect(webhookRetryDecision(3, 404, cfg)).toEqual({ terminal: true, reason: "http_404" });
    // a single early 4xx still backs off (not yet terminal)
    expect(webhookRetryDecision(1, 404, cfg)).toEqual({ terminal: false, backoffSec: 60 });
  });

  it("caps the backoff at maxBackoffHours", () => {
    expect(webhookRetryDecision(1, 503, { terminal4xxAfter: 3, maxAttempts: 100, maxBackoffHours: 0.01 }))
      .toEqual({ terminal: false, backoffSec: 36 }); // 0.01h*3600 = 36s cap beats 2^1*30=60
  });
});
