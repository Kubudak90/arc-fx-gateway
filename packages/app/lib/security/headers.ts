/**
 * Canonical HTTP security headers for Arcora Next.js apps.
 *
 * Applied via next.config.ts `async headers()` on both the main app and shop.
 *
 * Audit M14 (2026-05-06): add defence-in-depth security headers that the
 * previous config omitted.
 *
 * CSP note: `script-src 'self' 'unsafe-inline'` is intentionally permissive
 * for the demo phase (wagmi/viem connectors inline scripts). This will be
 * tightened to nonce/hash-based CSP in a post-demo polish pass.
 */
export function securityHeaders(): { key: string; value: string }[] {
  // `next dev` serves its client bundles through eval-based source maps, so a
  // CSP without 'unsafe-eval' kills hydration on every client page in dev
  // (and with it the Playwright e2e suite, which runs against `pnpm dev`).
  // Production builds don't eval — the shipped CSP is unchanged.
  const isDev = process.env.NODE_ENV === "development";
  return [
    {
      key: "X-Frame-Options",
      value: "SAMEORIGIN",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    {
      key: "Content-Security-Policy",
      // 'unsafe-inline' intentionally kept for demo phase — see note above.
      value: [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https:",
        "frame-ancestors 'self'",
      ].join("; "),
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
}
