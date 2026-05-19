import type { NextRequest } from "next/server";

/**
 * First-hop client IP for per-IP rate limiting. Reads `x-forwarded-for`
 * (Vercel sets this), falls back to `x-real-ip`, then `"unknown"`.
 * `"unknown"` deliberately shares one bucket — abuse from spoofed/missing
 * headers is still capped, just collectively.
 */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
