// Pure webhook-retry decision (extracted from run.ts so it is unit-testable without a DB pool):
// either terminalize a delivery (stop retrying) or schedule the next backoff.

export interface RetryConfig {
  /** A 4xx that persists past this many attempts is a permanent client error. */
  terminal4xxAfter: number;
  /** Hard cap on total attempts, so 5xx/network/redirect failures don't retry forever. */
  maxAttempts: number;
  /** Upper bound on a single backoff interval. */
  maxBackoffHours: number;
}

export type RetryDecision =
  | { terminal: true; reason: string }
  | { terminal: false; backoffSec: number };

/**
 * `attempts` is the post-increment count (row.attempts + 1) for the failure being recorded.
 */
export function webhookRetryDecision(attempts: number, status: number, cfg: RetryConfig): RetryDecision {
  // A 4xx that survives a few tries won't fix itself — terminate early.
  if (status >= 400 && status < 500 && attempts >= cfg.terminal4xxAfter) {
    return { terminal: true, reason: `http_${status}` };
  }
  // Status-independent cap: without this, 5xx / network / redirect failures back off forever.
  // Matches the documented "5x over ~30 minutes, then stop" (KNOWN_ISSUES.md).
  if (attempts >= cfg.maxAttempts) {
    return { terminal: true, reason: "max_attempts" };
  }
  const backoffSec = Math.min(2 ** attempts * 30, cfg.maxBackoffHours * 3600);
  return { terminal: false, backoffSec };
}
