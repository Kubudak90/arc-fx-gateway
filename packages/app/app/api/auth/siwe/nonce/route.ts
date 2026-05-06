import { NextRequest, NextResponse } from "next/server";
import { generateNonce } from "@/lib/auth/siwe";
import { takeToken } from "@/lib/rate/limiter";

/**
 * SIWE nonce issuance. Per-IP rate-limited (10/60s) so a malicious caller
 * can't flood the siwe_nonces table by hammering this unauthenticated
 * endpoint. Audit M9 (2026-05-06).
 */

const NONCE_LIMIT_PER_WINDOW = 10;
const NONCE_WINDOW_SECONDS = 60;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  // Vercel populates x-real-ip; fall back to it. As a last resort use
  // "unknown" so a missing header doesn't disable rate limiting entirely
  // (everyone shares the bucket — annoying for legitimate users behind
  // anonymising proxies, but not a security regression).
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`siwe-nonce:${ip}`, NONCE_LIMIT_PER_WINDOW, NONCE_WINDOW_SECONDS);
  } catch {
    // Limiter outage shouldn't lock everyone out — fail-open. The whole
    // endpoint is the second-line defence; the verify step still requires a
    // valid signed message + nonce, so an attacker who somehow bursts past
    // here still has to clear SIWE-verify.
    allowed = true;
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: NONCE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(NONCE_WINDOW_SECONDS) } },
    );
  }
  const nonce = await generateNonce();
  return NextResponse.json({ nonce });
}
