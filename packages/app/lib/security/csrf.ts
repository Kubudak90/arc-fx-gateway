import type { NextRequest } from "next/server";

/**
 * CSRF defence for state-changing, cookie-authenticated routes (audit L-5,
 * 2026-05-31). `SameSite=Lax` already blocks cross-site *sends* of the session
 * cookie in modern browsers; this is the defence-in-depth Origin/Referer
 * allowlist — the same guard `auth/logout` carries, generalised so every
 * state-changing merchant POST/PATCH can reuse it.
 *
 * A browser-driven CSRF attack is a cross-site fetch/form submission, which the
 * browser ALWAYS stamps with an `Origin` header (and usually `Referer`) and
 * which page script cannot strip. So:
 *   - `Origin` present            → must equal our own origin, else reject.
 *   - `Origin` absent, `Referer`  → its origin must match.
 *   - neither present             → not a browser cross-site request (curl /
 *     server-to-server); there is no ambient cookie to forge, so allow.
 *
 * Our own origin is `PUBLIC_BASE_URL` (or `NEXT_PUBLIC_BASE_URL`). If that is
 * unset/malformed we fail closed in production and stay lenient elsewhere so
 * local dev / tests aren't blocked.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return true;

  const base = process.env.PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL;
  let expected: string | null = null;
  if (base) {
    try { expected = new URL(base).origin; } catch { expected = null; }
  }
  if (!expected) return process.env.NODE_ENV !== "production";

  if (origin) return origin === expected;
  try { return new URL(referer!).origin === expected; } catch { return false; }
}
